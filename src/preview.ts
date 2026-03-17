import { Modal, App } from 'obsidian';
import { Publisher } from './publisher';
import Note2CMSPublisher from './main';

export class PreviewModal extends Modal {
  constructor(app: App, private plugin: Note2CMSPublisher, private publisher: Publisher, private content: string) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: '📄 Publish Preview' });
    
    const container = contentEl.createEl('div');
    container.addClass('note2cms-preview-container');
    this.publisher.getPreview(this.content).then(res => {
      if (res.html) container.innerHTML = res.html;
    });

    const btnContainer = contentEl.createEl('div');
    btnContainer.style.marginTop = '16px';
    btnContainer.createEl('button', { text: '✅ Publish' }).onclick = async () => {
      this.close();
      await this.plugin.publishCurrentNote(true, true);
    };
    btnContainer.createEl('button', { text: '❌ Cancel' }).onclick = () => this.close();
  }

  onClose() { this.contentEl.empty(); }
}
