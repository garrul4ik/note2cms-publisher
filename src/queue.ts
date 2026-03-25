import { Notice, Modal, App, TFile } from 'obsidian';
import Note2CMSPublisher from './main';
import { formatError } from './utils';

// Queue management constants
const MAX_RETRY_COUNT = 3;
const NOTICE_DURATION_MS = 4000;
const WIFI_CHECK_NOTICE_DURATION_MS = 3000;

export type QueueStatus = 'pending' | 'success' | 'failed';

export interface QueueItem {
  id: string;
  filePath: string;
  content: string;
  timestamp: number;
  retries: number;
  status: QueueStatus;
}

/**
 * Type guard to validate QueueStatus
 */
function isQueueStatus(value: unknown): value is QueueStatus {
  return value === 'pending' || value === 'success' || value === 'failed';
}

/**
 * Type guard to validate QueueItem
 */
function isQueueItem(value: unknown): value is QueueItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.filePath === 'string' &&
    typeof item.content === 'string' &&
    typeof item.timestamp === 'number' &&
    typeof item.retries === 'number' &&
    isQueueStatus(item.status)
  );
}

/**
 * Type guard to validate QueueItem array
 */
function isQueueItemArray(value: unknown): value is QueueItem[] {
  return Array.isArray(value) && value.every(isQueueItem);
}

/**
 * Publish queue manager with infinite retry protection
 * and optimized state persistence.
 */
export class PublishQueueManager {
  private queue: QueueItem[] = [];
  private saveScheduled = false;
  private lastSavedState = '';
  
  constructor(private app: App, private plugin: Note2CMSPublisher) {}

  initialize() { this.loadQueue(); }

  async addToQueue(file: TFile, reason: string) {
    this.queue.push({
      id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      filePath: file.path,
      content: '', // Don't save content, will read on publish
      timestamp: Date.now(),
      retries: 0,
      status: 'pending',
    });
    await this.saveQueue();
    new Notice(`Queued: ${file.basename} (${reason})`, NOTICE_DURATION_MS);
  }

  async processQueue() {
    if (this.queue.length === 0) return;
    
    const conn = (navigator as Navigator & { connection?: { type?: string } }).connection;
    if (this.plugin.settings.wifiOnly && conn?.type !== 'wifi') {
      new Notice('Waiting for wifi...', WIFI_CHECK_NOTICE_DURATION_MS);
      return;
    }

    let queueModified = false;
    
    for (const item of [...this.queue]) {
      // Type guard validation
      if (!isQueueItem(item)) {
        console.warn('[note2cms] Invalid queue item, skipping:', item);
        continue;
      }

      // Check retry limit
      if (item.retries >= MAX_RETRY_COUNT) {
        item.status = 'failed';
        new Notice(`Max retries exceeded for: ${item.filePath}`, NOTICE_DURATION_MS);
        queueModified = true;
        continue;
      }
      
      try {
        // Read current file content
        const file = this.app.vault.getAbstractFileByPath(item.filePath);
        if (!(file instanceof TFile)) {
          throw new Error('File not found');
        }
        const content = await this.app.vault.read(file);
        
        await this.plugin.publishContent(content, item.filePath);
        item.status = 'success';
        new Notice(`Published: ${item.filePath}`);
        queueModified = true;
      } catch (e: unknown) {
        item.retries++;
        const msg = formatError(e);
        new Notice(`Failed (retry ${item.retries}/${MAX_RETRY_COUNT}): ${msg}`);
        queueModified = true;
      }
    }
    
    // Remove successful and failed items
    const beforeLength = this.queue.length;
    this.queue = this.queue.filter((i) => i.status === 'pending');
    
    if (queueModified || this.queue.length !== beforeLength) {
      await this.saveQueue();
    }
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
    const rawQueue = this.plugin.settings.queue || [];
    // Validate loaded queue with type guard
    if (isQueueItemArray(rawQueue)) {
      this.queue = rawQueue;
      this.lastSavedState = JSON.stringify(this.queue);
    } else {
      console.warn('[note2cms] Invalid queue data, resetting to empty');
      this.queue = [];
      this.lastSavedState = '[]';
    }
  }

  /**
   * Optimized queue save with debounce and change detection
   */
  private async saveQueue() {
    if (this.saveScheduled) return;
    
    this.saveScheduled = true;
    await Promise.resolve(); // Microtask for batching
    
    // Check for changes before saving
    const currentState = JSON.stringify(this.queue);
    if (currentState === this.lastSavedState) {
      this.saveScheduled = false;
      return;
    }
    
    this.plugin.settings.queue = this.queue;
    await this.plugin.saveSettings();
    this.lastSavedState = currentState;
    this.saveScheduled = false;
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
