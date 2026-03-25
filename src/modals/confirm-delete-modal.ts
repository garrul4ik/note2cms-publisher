import { App, Modal } from 'obsidian';

export class ConfirmDeleteModal extends Modal {
  private resolved = false;
  constructor(app: App, private title: string, private onResult: (ok: boolean) => void) { super(app); }
  onOpen() {
    const { contentEl } = this; contentEl.empty();
    contentEl.createEl('h2', { text: 'Delete post' });
    contentEl.createEl('p', { text: `Delete "${this.title}"?` });
    contentEl.createEl('button', { text: 'Delete' }).onclick = () => {
      this.resolved = true;
      this.onResult(true);
      this.close();
    };
    contentEl.createEl('button', { text: 'Cancel' }).onclick = () => {
      this.resolved = true;
      this.onResult(false);
      this.close();
    };
  }
  onClose() {
    this.contentEl.empty();
    if (!this.resolved) this.onResult(false);
  }
}
