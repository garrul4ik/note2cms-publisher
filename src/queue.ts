import { Notice, Modal, App } from 'obsidian';
import Note2CMSPublisher from './main';

export interface QueueItem {
  id: string; filePath: string; content: string;
  timestamp: number; retries: number; status: string;
}

export class PublishQueueManager {
  private queue: QueueItem[] = [];
  constructor(private app: App, private plugin: Note2CMSPublisher) {}

  async initialize() { await this.loadQueue(); }

  async addToQueue(file: any, content: string, reason: string) {
    this.queue.push({
      id: `q_${Date.now()}`, filePath: file.path, content,
      timestamp: Date.now(), retries: 0, status: 'pending'
    });
    await this.saveQueue();
    new Notice(`📭 Queued: ${file.basename} (${reason})`, 4000);
  }

  async processQueue() {
    if (this.queue.length === 0) return;
    if (this.plugin.settings.wifiOnly && (navigator as any).connection?.type !== 'wifi') {
      new Notice('📶 Waiting for WiFi...', 3000); return;
    }

    for (const item of [...this.queue]) {
      try {
        await this.plugin.publishContent(item.content, item.filePath);
        item.status = 'success';
        new Notice(`✅ Published: ${item.filePath}`);
      } catch (e: any) {
        item.retries++;
        new Notice(`❌ Failed: ${e.message}`);
      }
      await this.saveQueue();
    }
    this.queue = this.queue.filter(i => i.status !== 'success');
  }

  getQueueLength(): number { return this.queue.filter(i => i.status === 'pending').length; }

  showQueueModal() { new QueueModal(this.app, this.plugin, this).open(); }

  async clearQueue() {
    this.queue = [];
    await this.saveQueue();
    new Notice('✅ Queue cleared');
  }

  private async loadQueue() {
    this.queue = this.plugin.settings.queue || [];
  }

  private async saveQueue() {
    this.plugin.settings.queue = this.queue;
    await this.plugin.saveSettings();
  }
}

export class QueueModal extends Modal {
  constructor(app: App, private plugin: Note2CMSPublisher, private qm: PublishQueueManager) {
    super(app);
  }
  onOpen() {
    const { contentEl } = this; contentEl.empty();
    contentEl.createEl('h2', { text: 'Publish Queue' });
    if (this.qm['queue'].length === 0) {
      contentEl.createEl('p', { text: 'Queue is empty 🎉' });
    } else {
      this.qm['queue'].forEach(item => {
        contentEl.createEl('div', { text: `${item.filePath} - ${item.status}` });
      });
    }
    contentEl.createEl('button', { text: 'Clear Queue' }).onclick = async () => {
      await this.qm.clearQueue();
      this.close();
    };
    contentEl.createEl('button', { text: 'Close' }).onclick = () => this.close();
  }
  onClose() { this.contentEl.empty(); }
}
