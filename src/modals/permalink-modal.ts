import { App, Modal, Notice } from 'obsidian';

export class PermalinkModal extends Modal {
  constructor(app: App, private permalink: string) { super(app); }
  onOpen() {
    const { contentEl } = this; contentEl.empty();
    contentEl.createEl('h2', { text: 'Published' });
    const linkEl = contentEl.createEl('p');
    linkEl.createEl('a', { text: this.permalink, href: this.permalink });
    const btn = contentEl.createEl('button', { text: 'Copy link' });
    btn.onclick = () => { void this.copyLink(); };
    contentEl.createEl('button', { text: 'Close' }).onclick = () => this.close();
  }
  onClose() { this.contentEl.empty(); }

  private async copyLink() {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(this.permalink);
      new Notice('Copied');
    } else {
      new Notice('Clipboard not available');
    }
  }
}
