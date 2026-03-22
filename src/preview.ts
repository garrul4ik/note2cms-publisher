import { Modal, App, MarkdownRenderer } from 'obsidian';
import Note2CMSPublisher from './main';

export class PreviewModal extends Modal {
  constructor(app: App, private plugin: Note2CMSPublisher, private content: string) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Publish preview' });

    const container = contentEl.createEl('div');
    container.addClass('note2cms-preview-container');
    void this.renderPreview(container);

    const btnContainer = contentEl.createEl('div');
    btnContainer.addClass('note2cms-button-row');
    btnContainer.createEl('button', { text: 'Publish' }).onclick = () => {
      this.close();
      void this.plugin.publishCurrentNote(true, true);
    };
    btnContainer.createEl('button', { text: 'Cancel' }).onclick = () => this.close();
  }

  onClose() { this.contentEl.empty(); }

  private async renderPreview(container: HTMLElement) {
    const md = this.content.replace(/^---[\s\S]+?---\n/, '');
    await MarkdownRenderer.render(this.app, md, container, '', this);
  }
}
