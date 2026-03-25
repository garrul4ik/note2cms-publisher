import { App, Modal, Notice } from 'obsidian';
import type Note2CMSPublisher from '../main';
import type { PostSummary } from '../main';
import { formatError } from '../utils';

export class EditPostModal extends Modal {
  private saveInProgress = false;

  constructor(
    app: App,
    private plugin: Note2CMSPublisher,
    private post: PostSummary,
    private sourceMarkdown: string,
    private onSaved: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: `Edit: ${this.post.title || this.post.slug || 'Untitled'}` });

    const editor = contentEl.createEl('textarea');
    editor.addClass('note2cms-editor');
    editor.value = this.sourceMarkdown;

    const buttons = contentEl.createEl('div');
    buttons.addClass('note2cms-button-row');

    const saveBtn = buttons.createEl('button', { text: 'Save' });
    saveBtn.onclick = () => { void this.handleSave(editor, saveBtn); };

    buttons.createEl('button', { text: 'Cancel' }).onclick = () => this.close();
  }

  onClose() { this.contentEl.empty(); }

  private async handleSave(editor: HTMLTextAreaElement, saveBtn: HTMLButtonElement) {
    if (this.saveInProgress) return;
    this.saveInProgress = true;
    saveBtn.disabled = true;
    try {
      await this.plugin.publishRawMarkdown(editor.value);
      new Notice('Post updated');
      this.plugin.invalidatePostsCache(); // Invalidate cache after update
      await this.onSaved();
      this.close();
    } catch (e: unknown) {
      new Notice(`Update failed: ${formatError(e)}`);
    } finally {
      this.saveInProgress = false;
      saveBtn.disabled = false;
    }
  }
}
