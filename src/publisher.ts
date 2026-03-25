import { Notice, TFile, requestUrl } from 'obsidian';
import Note2CMSPublisher from './main';
import { runFrontmatterPreflight, type PreflightResult } from './frontmatter-preflight';
import { showQuickFixModal, type QuickFixAction, type QuickFixResult } from './quick-fix-modal';

// Константы
const REQUEST_TIMEOUT_MS = 30000;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

interface PublishOptions {
  interactive?: boolean;
}

interface PublishResponse {
  success: boolean;
  permalink?: string;
  error?: string;
}

/**
 * Извлекает название из пути к файлу
 */
function titleFromPath(path?: string): string {
  if (!path) return 'Untitled';
  const parts = path.split('/');
  const name = parts[parts.length - 1] || 'Untitled';
  return name.replace(/\.md$/i, '');
}

/**
 * Маппинг действия по умолчанию
 */
function mapDefaultAction(value: 'ask' | 'publish_only' | 'publish_and_save'): QuickFixAction {
  if (value === 'publish_only') return 'publish_only';
  if (value === 'publish_and_save') return 'publish_and_save';
  return 'cancel';
}

/**
 * Класс для публикации заметок с автоматическим восстановлением после ошибок
 */
export class Publisher {
  constructor(private plugin: Note2CMSPublisher) {}

  /**
   * Публикует контент с предварительной проверкой frontmatter
   */

  async publish(content: string, sourcePath?: string, options?: PublishOptions): Promise<PublishResponse> {
    const interactive = options?.interactive ?? true;
    const preflight = runFrontmatterPreflight({
      app: this.plugin.app,
      markdown: content,
      sourcePath,
      includeFrontmatter: this.plugin.settings.includeFrontmatter,
    });

    if (!preflight.canPublish) {
      return { success: false, error: 'Title is required to publish.' };
    }

    const shouldReview = preflight.issues.length > 0;
    let action: QuickFixAction = 'publish_only';
    let markdownToPublish = preflight.normalizedMarkdown;
    if (shouldReview) {
      const quickFix = await this.resolveQuickFixAction(preflight, content, interactive);
      action = quickFix.action;
      if (action === 'cancel') {
        return { success: false, error: 'Publish cancelled.' };
      }
      if (quickFix.markdown && quickFix.markdown.trim().length > 0) {
        const reviewed = runFrontmatterPreflight({
          app: this.plugin.app,
          markdown: quickFix.markdown,
          sourcePath,
          includeFrontmatter: this.plugin.settings.includeFrontmatter,
        });
        if (!reviewed.canPublish) {
          return { success: false, error: 'Edited content is missing title.' };
        }
        markdownToPublish = reviewed.normalizedMarkdown;
      }
    }

    // Публикуем ПЕРЕД записью в файл
    const publishResult = await this.send(markdownToPublish);

    // Записываем в файл только после успешной публикации
    if (publishResult.success && action === 'publish_and_save') {
      await this.writeNormalizedToFile(sourcePath, markdownToPublish);
    }

    return publishResult;
  }

  /**
   * Публикует сырой markdown без предварительной обработки
   */
  async publishRaw(markdown: string): Promise<PublishResponse> {
    return this.send(markdown);
  }

  private async resolveQuickFixAction(
    preflight: PreflightResult,
    originalMarkdown: string,
    interactive: boolean,
  ): Promise<QuickFixResult> {
    const configured = this.plugin.settings.defaultWritebackAction;

    if (!interactive || !this.plugin.settings.showQuickFixModal) {
      const action = configured === 'ask' ? 'publish_only' : configured;
      return {
        action,
        markdown: preflight.normalizedMarkdown,
      };
    }

    return showQuickFixModal(this.plugin.app, {
      issues: preflight.issues,
      originalMarkdown,
      normalizedMarkdown: preflight.normalizedMarkdown,
      defaultAction: mapDefaultAction(configured),
    });
  }

  /**
   * Записывает нормализованный markdown в файл
   */
  private async writeNormalizedToFile(sourcePath: string | undefined, normalizedMarkdown: string): Promise<void> {
    if (!sourcePath) return;
    const abstractFile = this.plugin.app.vault.getAbstractFileByPath(sourcePath);
    if (!(abstractFile instanceof TFile)) return;
    await this.plugin.app.vault.modify(abstractFile, normalizedMarkdown);
    new Notice(`Updated note: ${titleFromPath(sourcePath)}`);
  }

  /**
   * Отправляет markdown на сервер с автоматическим восстановлением после ошибок
   */
  private async send(markdown: string): Promise<PublishResponse> {
    let lastError: unknown = null;
    
    // Попытки с экспоненциальной задержкой
    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Request timeout after ${REQUEST_TIMEOUT_MS / 1000} seconds`)), REQUEST_TIMEOUT_MS)
        );

        const requestPromise = requestUrl({
          url: `${this.plugin.settings.apiUrl}/publish`,
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.plugin.settings.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ markdown }),
        });

        const response = await Promise.race([requestPromise, timeoutPromise]);

        if (response.status < 200 || response.status >= 300) {
          throw new Error(`HTTP ${response.status}: ${response.text || 'Unknown error'}`);
        }

        // Валидация ответа
        const result = response.json as unknown;
        if (typeof result !== 'object' || result === null) {
          console.error('[note2cms] Invalid API response: not an object');
          throw new Error('Invalid response format from server');
        }

        const typedResult = result as Record<string, unknown>;
        
        // Проверка типов полей
        if (typedResult.permalink !== undefined && typeof typedResult.permalink !== 'string') {
          console.warn('[note2cms] Invalid permalink type in response');
        }
        if (typedResult.url !== undefined && typeof typedResult.url !== 'string') {
          console.warn('[note2cms] Invalid url type in response');
        }

        // Успешный ответ - возвращаем результат
        return {
          success: true,
          permalink: typeof typedResult.permalink === 'string' ? typedResult.permalink : (typeof typedResult.url === 'string' ? typedResult.url : undefined),
        };
      } catch (error: unknown) {
        lastError = error;
        console.error(`[note2cms] Publish attempt ${attempt}/${MAX_RETRY_ATTEMPTS} failed:`, error);
        
        // Если это последняя попытка, возвращаем ошибку
        if (attempt === MAX_RETRY_ATTEMPTS) {
          return { success: false, error: this.errorMessage(error) };
        }
        
        // Экспоненциальная задержка перед следующей попыткой
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    // Fallback (не должен достигаться)
    return { success: false, error: this.errorMessage(lastError) };
  }

  private errorMessage(e: unknown): string {
    if (e instanceof Error) return e.message;
    if (typeof e === 'string') return e;
    try {
      return JSON.stringify(e);
    } catch {
      return 'Unknown error';
    }
  }
}
