import { Notice, Modal, App, TFile } from 'obsidian';
import Note2CMSPublisher from './main';

export type QueueStatus = 'pending' | 'success' | 'failed';

export interface QueueItem {
  id: string;
  filePath: string;
  content: string;
  timestamp: number;
  retries: number;
  status: QueueStatus;
}

export class PublishQueueManager {
  private queue: QueueItem[] = [];
  constructor(private app: App, private plugin: Note2CMSPublisher) {}

  initialize() { this.loadQueue(); }

  async addToQueue(file: TFile, content: string, reason: string) {
    this.queue.push({
      id: `q_${Date.now()}`,
      filePath: file.path,
      content,
      timestamp: Date.now(),
      retries: 0,
      status: 'pending',
    });
    await this.saveQueue();
    new Notice(`Queued: ${file.basename} (${reason})`, 4000);
  }

  async processQueue() {
    if (this.queue.length === 0) return;
    const conn = (navigator as Navigator & { connection?: { type?: string } }).connection;
    if (this.plugin.settings.wifiOnly && conn?.type !== 'wifi') {
      new Notice('Waiting for wifi...', 3000);
      return;
    }

    for (const item of [...this.queue]) {
      try {
        await this.plugin.publishContent(item.content, item.filePath);
        item.status = 'success';
        new Notice(`Published: ${item.filePath}`);
      } catch (e: unknown) {
        item.retries++;
        const msg = this.errorMessage(e);
        new Notice(`Failed: ${msg}`);
      }
      await this.saveQueue();
    }
    this.queue = this.queue.filter(i => i.status !== 'success');
  }

  getQueueLength(): number { return this.queue.filter(i => i.status === 'pending').length; }
  getQueue(): QueueItem[] { return this.queue; }

  showQueueModal() { new QueueModal(this.app, this.plugin, this).open(); }

  async clearQueue() {
    this.queue = [];
    await this.saveQueue();
    new Notice('Queue cleared');
  }

  private loadQueue() {
    this.queue = this.plugin.settings.queue || [];
  }

  private async saveQueue() {
    this.plugin.settings.queue = this.queue;
    await this.plugin.saveSettings();
  }

  private errorMessage(e: unknown): string {
    if (e instanceof Error) return e.message;
    if (typeof e === 'string') return e;
    try {
      return JSON.stringify(e);
    } catch {
      return 'Unknown error';
    }
  }
}

export class QueueModal extends Modal {
  constructor(app: App, private plugin: Note2CMSPublisher, private qm: PublishQueueManager) {
    super(app);
  }
  onOpen() {
    const { contentEl } = this; contentEl.empty();
    contentEl.createEl('h2', { text: 'Publish queue' });
    if (this.qm.getQueue().length === 0) {
      contentEl.createEl('p', { text: 'Queue is empty' });
    } else {
      this.qm.getQueue().forEach((item: QueueItem) => {
        contentEl.createEl('div', { text: `${item.filePath} - ${item.status}` });
      });
    }
    contentEl.createEl('button', { text: 'Clear queue' }).onclick = () => {
      void this.qm.clearQueue();
      this.close();
    };
    contentEl.createEl('button', { text: 'Close' }).onclick = () => this.close();
  }
  onClose() { this.contentEl.empty(); }
}
