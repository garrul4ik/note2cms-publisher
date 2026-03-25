import { App, Modal, Notice, TFile } from 'obsidian';
import type Note2CMSPublisher from '../main';

const BULK_PUBLISH_BATCH_SIZE = 5;
const BULK_PUBLISH_DELAY_MS = 100;

export class BulkModal extends Modal {
  constructor(app: App, private plugin: Note2CMSPublisher) { super(app); }
  onOpen() {
    const { contentEl } = this; contentEl.empty();
    contentEl.createEl('h2', { text: 'Bulk publish' });
    const files = this.app.vault.getMarkdownFiles().filter(f => this.plugin['shouldPublish'](f));
    if (!files.length) { contentEl.createEl('p', { text: 'No files found' }); return; }

    let selected: TFile[] = [];
    const container = contentEl.createEl('div');
    container.addClass('note2cms-scroll');

    files.forEach(file => {
      const row = container.createEl('div');
      row.addClass('note2cms-row');
      const cb = row.createEl('input');
      cb.type = 'checkbox';
      cb.addClass('note2cms-row-checkbox');
      cb.onchange = () => selected = cb.checked ? [...selected, file] : selected.filter(f => f !== file);
      row.createEl('span', { text: file.path });
    });

    contentEl.createEl('button', { text: `Publish (${selected.length})` }).onclick = () => {
      this.close();
      void this.publishSelected(selected);
    };
    contentEl.createEl('button', { text: 'Close' }).onclick = () => this.close();
  }
  onClose() { this.contentEl.empty(); }

  /**
   * Публикует выбранные файлы параллельными батчами без интерактивных модалов
   */
  private async publishSelected(files: TFile[]) {
    let successCount = 0;
    let failCount = 0;
    
    // Публикуем батчами для оптимизации
    for (let i = 0; i < files.length; i += BULK_PUBLISH_BATCH_SIZE) {
      const batch = files.slice(i, i + BULK_PUBLISH_BATCH_SIZE);
      
      const results = await Promise.allSettled(
        batch.map(f => this.plugin.doPublishSilent(f))
      );
      
      results.forEach(result => {
        if (result.status === 'fulfilled' && result.value.success) {
          successCount++;
        } else {
          failCount++;
        }
      });
      
      // Небольшая задержка между батчами
      if (i + BULK_PUBLISH_BATCH_SIZE < files.length) {
        await new Promise(resolve => setTimeout(resolve, BULK_PUBLISH_DELAY_MS));
      }
    }
    
    new Notice(`Bulk publish complete: ${successCount} success, ${failCount} failed`);
  }
}
