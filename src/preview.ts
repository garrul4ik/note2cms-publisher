import { Modal, App, MarkdownRenderer, Component } from 'obsidian';
import Note2CMSPublisher from './main';

/**
 * Модальное окно предпросмотра с правильной очисткой компонентов
 */
export class PreviewModal extends Modal {
  private previewComponent?: Component;

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

  onClose() {
    // Очистка компонента рендеринга
    if (this.previewComponent) {
      this.previewComponent.unload();
      this.previewComponent = undefined;
    }
    this.contentEl.empty();
  }

  private async renderPreview(container: HTMLElement) {
    const md = this.content.replace(/^---[\s\S]+?---\n/, '');
    this.previewComponent = new Component();
    this.previewComponent.load();
    await MarkdownRenderer.render(this.app, md, container, '', this.previewComponent);
  }
}
