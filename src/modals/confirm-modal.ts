import { App, Modal, TFile } from 'obsidian';
import type Note2CMSPublisher from '../main';

export class ConfirmModal extends Modal {
  constructor(app: App, private plugin: Note2CMSPublisher, private file: TFile) { super(app); }
  onOpen() {
    const { contentEl } = this; contentEl.empty();
    contentEl.createEl('h2', { text: 'Confirm publish' });
    contentEl.createEl('p', { text: `Publish "${this.file.basename}"?` });
    contentEl.createEl('button', { text: 'Yes' }).onclick = () => { this.close(); void this.plugin.doPublish(this.file); };
    contentEl.createEl('button', { text: 'No' }).onclick = () => this.close();
  }
  onClose() { this.contentEl.empty(); }
}
