import { requestUrl } from 'obsidian';
import Note2CMSPublisher from './main';

function extractFrontmatter(markdown: string): { frontmatter: string | null; body: string } {
  if (!markdown.startsWith('---\n')) return { frontmatter: null, body: markdown };
  const end = markdown.indexOf('\n---', 4);
  if (end === -1) return { frontmatter: null, body: markdown };
  const fm = markdown.slice(4, end).trim();
  const body = markdown.slice(end + 4);
  return { frontmatter: fm, body };
}

function ensureTitle(markdown: string, title: string): string {
  const { frontmatter, body } = extractFrontmatter(markdown);
  if (frontmatter) {
    if (/^title:\s*.+/m.test(frontmatter)) return markdown;
    const withTitle = `title: ${title}\n${frontmatter}`;
    return `---\n${withTitle}\n---${body}`;
  }
  return `---\ntitle: ${title}\n---\n${markdown}`;
}

function titleFromPath(path?: string): string {
  if (!path) return 'Untitled';
  const parts = path.split('/');
  const name = parts[parts.length - 1] || 'Untitled';
  return name.replace(/\.md$/i, '');
}

export class Publisher {
  constructor(private plugin: Note2CMSPublisher) {}

  async publish(content: string, sourcePath?: string): Promise<{ success: boolean; permalink?: string; error?: string }> {
    const title = titleFromPath(sourcePath);
    const prepared = this.plugin.settings.includeFrontmatter
      ? ensureTitle(content, title)
      : ensureTitle(content.replace(/^---[\s\S]+?---\n/, ''), title);
    return this.send(prepared);
  }

  async publishRaw(markdown: string): Promise<{ success: boolean; permalink?: string; error?: string }> {
    return this.send(markdown);
  }

  private async send(markdown: string): Promise<{ success: boolean; permalink?: string; error?: string }> {
    try {
      const response = await requestUrl({
        url: `${this.plugin.settings.apiUrl}/publish`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.plugin.settings.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ markdown }),
      });

      if (response.status < 200 || response.status >= 300) {
        const errText = typeof response.text === 'string' ? response.text : '';
        throw new Error(`API Error ${response.status}: ${errText}`);
      }

      const result = response.json as { permalink?: string; url?: string };
      return { success: true, permalink: result.permalink || result.url };
    } catch (error: unknown) {
      console.error('Publish error:', error);
      const message = this.errorMessage(error);
      return { success: false, error: message };
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
