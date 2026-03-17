import { Notice } from 'obsidian';
import Note2CMSPublisher from './main';

export class Publisher {
  constructor(private plugin: Note2CMSPublisher) {}

  async publish(content: string, sourcePath?: string): Promise<{ success: boolean; permalink?: string; error?: string }> {
    try {
      const response = await fetch(`${this.plugin.settings.apiUrl}/publish`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.plugin.settings.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          markdown: this.plugin.settings.includeFrontmatter ? content : content.replace(/^---[\s\S]+?---\n/, ''),
          source_path: sourcePath,
        }),
      });

      if (!response.ok) throw new Error(`API Error ${response.status}`);
      const result = await response.json();
      return { success: true, permalink: result.permalink };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async getPreview(content: string): Promise<{ success: boolean; html?: string }> {
    // Fallback local preview
    const html = content.replace(/^---[\s\S]+?---\n/, '').replace(/\n/gim, '<br>');
    return { success: true, html: `<div class="note2cms-preview">${html}</div>` };
  }
}
