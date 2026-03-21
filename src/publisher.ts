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

    if (action === 'publish_and_save') {
      await this.writeNormalizedToFile(sourcePath, markdownToPublish);
    }

    return this.send(markdownToPublish);
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
      const response = await requestUrl({
        url: `${this.plugin.settings.apiUrl}/publish`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.plugin.settings.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ markdown }),
      });

      if (response.status < 200 || response.status >= 300) {
        const errText = typeof response.text === 'string' ? response.text : '';
        throw new Error(`API error ${response.status}: ${errText}`);
      }

      const result = response.json as { permalink?: string; url?: string };
      return { success: true, permalink: result.permalink || result.url };
    } catch (error: unknown) {
      console.error('Publish error:', error);
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
