import { Notice, TFile, requestUrl } from 'obsidian';
import Note2CMSPublisher from './main';
import { runFrontmatterPreflight, type PreflightResult } from './frontmatter-preflight';
import { showQuickFixModal, type QuickFixAction, type QuickFixResult } from './quick-fix-modal';

interface PublishOptions {
  interactive?: boolean;
}

interface PublishResponse {
  success: boolean;
  permalink?: string;
  error?: string;
}

function titleFromPath(path?: string): string {
  if (!path) return 'Untitled';
  const parts = path.split('/');
  const name = parts[parts.length - 1] || 'Untitled';
  return name.replace(/\.md$/i, '');
}

function mapDefaultAction(value: 'ask' | 'publish_only' | 'publish_and_save'): QuickFixAction {
  if (value === 'publish_only') return 'publish_only';
  if (value === 'publish_and_save') return 'publish_and_save';
  return 'cancel';
}

export class Publisher {
  constructor(private plugin: Note2CMSPublisher) {}

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

  private async writeNormalizedToFile(sourcePath: string | undefined, normalizedMarkdown: string): Promise<void> {
    if (!sourcePath) return;
    const abstractFile = this.plugin.app.vault.getAbstractFileByPath(sourcePath);
    if (!(abstractFile instanceof TFile)) return;
    await this.plugin.app.vault.modify(abstractFile, normalizedMarkdown);
    new Notice(`Updated note: ${titleFromPath(sourcePath)}`);
  }

  private async send(markdown: string): Promise<PublishResponse> {
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout after 30 seconds')), 30000)
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
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.text || 'Unknown error'}`,
        };
      }

      // Валидация ответа
      const result = response.json;
      if (typeof result !== 'object' || result === null) {
        console.error('[note2cms] Invalid API response: not an object');
        return {
          success: false,
          error: 'Invalid response format from server',
        };
      }

      const typedResult = result as Record<string, unknown>;
      
      // Проверка типов полей
      if (typedResult.permalink !== undefined && typeof typedResult.permalink !== 'string') {
        console.warn('[note2cms] Invalid permalink type in response');
      }
      if (typedResult.url !== undefined && typeof typedResult.url !== 'string') {
        console.warn('[note2cms] Invalid url type in response');
      }

      return {
        success: true,
        permalink: typeof typedResult.permalink === 'string' ? typedResult.permalink : (typeof typedResult.url === 'string' ? typedResult.url : undefined),
      };
    } catch (error: unknown) {
      console.error('[note2cms] Publish error:', error);
      return { success: false, error: this.errorMessage(error) };
    }
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
