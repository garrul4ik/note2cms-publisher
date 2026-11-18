import { Notice, TFile, arrayBufferToBase64, parseYaml, requestUrl } from 'obsidian';
import Note2CMSPublisher from './main';
import { runFrontmatterPreflight, type PreflightResult } from './frontmatter-preflight';
import { showQuickFixModal, type QuickFixAction, type QuickFixResult } from './quick-fix-modal';
import { formatError } from './utils';
import { RateLimiter } from './rate-limiter';

// Constants
const REQUEST_TIMEOUT_MS = 30000;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;
const RATE_LIMIT_MAX_CONCURRENT = 3;
const RATE_LIMIT_DELAY_MS = 100;
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const MD_IMAGE_RE = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const WIKI_IMAGE_RE = /!\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]/g;

interface PublishOptions {
  interactive?: boolean;
}

interface PublishResponse {
  success: boolean;
  permalink?: string;
  error?: string;
}

/**
 * Type guard для проверки API ответа
 */
interface PublishApiResponse {
  permalink?: string;
  url?: string;
  error?: string;
}

function isPublishApiResponse(value: unknown): value is PublishApiResponse {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    (obj.permalink === undefined || typeof obj.permalink === 'string') &&
    (obj.url === undefined || typeof obj.url === 'string') &&
    (obj.error === undefined || typeof obj.error === 'string')
  );
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
  private rateLimiter: RateLimiter;

  constructor(private plugin: Note2CMSPublisher) {
    this.rateLimiter = new RateLimiter(RATE_LIMIT_MAX_CONCURRENT, RATE_LIMIT_DELAY_MS);
  }

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

    const assets = await this.collectAssets(markdownToPublish, sourcePath);

    // Publish BEFORE writing normalized frontmatter back to the local note
    const publishResult = await this.send(markdownToPublish, assets);

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

  private extractAssetRefs(markdown: string): string[] {
    const refs = new Set<string>();
    for (const match of markdown.matchAll(MD_IMAGE_RE)) {
      refs.add(match[1].trim());
    }
    for (const match of markdown.matchAll(WIKI_IMAGE_RE)) {
      refs.add(match[1].trim());
    }
    const fmMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fmMatch) {
      try {
        const parsed = parseYaml(fmMatch[1]) as unknown;
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          const cover = (parsed as Record<string, unknown>).cover;
          if (typeof cover === 'string' && cover.trim().length > 0) {
            refs.add(cover.trim());
          }
        }
      } catch {
        // Ignore non-standard frontmatter when scanning cover refs
      }
    }
    return Array.from(refs);
  }

  private async collectAssets(markdown: string, sourcePath?: string): Promise<Record<string, string>> {
    const assets: Record<string, string> = {};
    if (!this.plugin.settings.uploadImages || !sourcePath) {
      return assets;
    }

    for (const ref of this.extractAssetRefs(markdown)) {
      if (/^(https?:|data:|\/posts\/)/i.test(ref)) {
        continue;
      }
      let cleanRef = ref.replace(/^\.\//, '');
      try {
        cleanRef = decodeURIComponent(cleanRef);
      } catch {
        // Keep literal reference if percent-decoding fails
      }
      const linked = this.plugin.app.metadataCache.getFirstLinkpathDest(cleanRef, sourcePath);
      if (linked instanceof TFile && IMAGE_EXTENSIONS.has(linked.extension.toLowerCase())) {
        const binary = await this.plugin.app.vault.readBinary(linked);
        assets[ref] = arrayBufferToBase64(binary);
      }
    }
    return assets;
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
   * Отправляет markdown на сервер с автоматическим восстановлением после ошибок и rate limiting
   */
  private async send(markdown: string, assets?: Record<string, string>): Promise<PublishResponse> {
    return this.rateLimiter.execute(async () => {
      let lastError: unknown = null;
      const payload: Record<string, unknown> = { markdown };
      if (assets && Object.keys(assets).length > 0) {
        payload.assets = assets;
      }
      
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
            body: JSON.stringify(payload),
          });

          const response = await Promise.race([requestPromise, timeoutPromise]);

          if (response.status < 200 || response.status >= 300) {
            throw new Error(`HTTP ${response.status}: ${response.text || 'Unknown error'}`);
          }

          // Validate response with type guard
          const result = response.json as unknown;
          if (!isPublishApiResponse(result)) {
            console.error('[note2cms] Invalid API response format');
            throw new Error('Invalid response format from server');
          }

          // Successful response - return result
          return {
            success: true,
            permalink: result.permalink || result.url,
          };
        } catch (error: unknown) {
          lastError = error;
          console.error(`[note2cms] Publish attempt ${attempt}/${MAX_RETRY_ATTEMPTS} failed:`, error);
          
          // Если это последняя попытка, возвращаем ошибку
          if (attempt === MAX_RETRY_ATTEMPTS) {
            return { success: false, error: formatError(error) };
          }
          
          // Экспоненциальная задержка перед следующей попыткой
          const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      // Fallback (не должен достигаться)
      return { success: false, error: formatError(lastError) };
    });
  }
}
