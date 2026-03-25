import { Notice, Plugin, TAbstractFile, TFile, requestUrl } from 'obsidian';
import { Note2CMSSettingTab, DEFAULT_SETTINGS, Note2CMSSettings } from './settings';
import { PublishQueueManager } from './queue';
import { Publisher } from './publisher';
import { PreviewModal } from './preview';
import { isMobileDevice, isWiFiConnected, hasPublishTag, isInPublishFolder, formatError } from './utils';
import { ConfirmModal } from './modals/confirm-modal';
import { PermalinkModal } from './modals/permalink-modal';
import { BulkModal } from './modals/bulk-modal';
import { ManagePostsModal } from './modals/manage-posts-modal';

// Constants
const AUTO_PUBLISH_DEBOUNCE_MS = 500;
const POSTS_CACHE_TTL_MS = 60000; // 1 minute

export interface PostSummary {
  slug: string;
  title?: string;
  permalink?: string;
}

declare global {
  interface Window {
    note2cmsPlugin?: Note2CMSPublisher;
  }
}

/**
 * Main plugin class for publishing notes to CMS
 */
export default class Note2CMSPublisher extends Plugin {
  settings!: Note2CMSSettings;
  settingTab!: Note2CMSSettingTab;
  queueManager!: PublishQueueManager;
  publisher!: Publisher;
  private autoPublishTimers: Record<string, number> = {};
  private publishInProgress = new Set<string>();
  private postsCache: { data: PostSummary[]; timestamp: number } | null = null;
  private fileModifyHandler?: (file: TAbstractFile) => void;

  async onload() {
    await this.loadSettings();
    this.publisher = new Publisher(this);
    this.queueManager = new PublishQueueManager(this.app, this);
    this.queueManager.initialize();

    this.settingTab = new Note2CMSSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

    this.addCommand({ id: 'publish-current-note', name: 'Publish current note', callback: () => { void this.publishCurrentNote(); } });
    this.addCommand({ id: 'publish-current-note-any', name: 'Publish current note (any)', callback: () => { void this.publishCurrentNote(true, true); } });
    this.addCommand({ id: 'bulk-publish-notes', name: 'Bulk publish', callback: () => this.bulkPublishNotes() });
    this.addCommand({ id: 'preview-publish', name: 'Preview note', callback: () => this.previewCurrentNote() });
    this.addCommand({ id: 'manage-posts', name: 'Manage published posts', callback: () => new ManagePostsModal(this.app, this).open() });
    this.addCommand({ id: 'note2cms:view-queue', name: 'View queue', callback: () => this.queueManager.showQueueModal() });
    this.addRibbonIcon('upload', 'Publish', () => { void this.publishCurrentNote(); });

    // Сохраняем обработчик для правильной очистки
    this.fileModifyHandler = (file: TAbstractFile) => this.onFileModified(file);
    this.registerEvent(this.app.vault.on('modify', this.fileModifyHandler));

    window.note2cmsPlugin = this;
  }

  onunload() {
    // Очистить все активные таймеры автопубликации
    Object.values(this.autoPublishTimers).forEach(timer => window.clearTimeout(timer));
    this.autoPublishTimers = {};
    
    // Очистить кеш
    this.postsCache = null;
    
    // Очистить глобальную ссылку
    delete window.note2cmsPlugin;
  }

  async loadSettings() { 
    const data = await this.loadData() as Partial<Note2CMSSettings>;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    
    // Decrypt API token if stored encoded
    if (data?.apiTokenEncoded && !data?.apiToken) {
      try {
        this.settings.apiToken = atob(data.apiTokenEncoded);
      } catch {
        this.settings.apiToken = '';
      }
    }
  }
  
  async saveSettings() { 
    // Encrypt API token before saving
    const toSave = {
      ...this.settings,
      apiTokenEncoded: this.settings.apiToken ? btoa(this.settings.apiToken) : '',
      apiToken: '', // Don't save plaintext token
    };
    await this.saveData(toSave);
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await requestUrl({
        url: `${this.settings.apiUrl}/posts`,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.settings.apiToken}` },
      });
      return res.status >= 200 && res.status < 300
        ? { success: true }
        : { success: false, error: `Status ${res.status}` };
    } catch (e: unknown) {
      return { success: false, error: formatError(e) };
    }
  }

  async publishCurrentNote(skipConfirmation: boolean = false, ignoreFilters: boolean = false) {
    const file = this.app.workspace.getActiveFile();
    if (!file) return new Notice('No active file');
    if (!ignoreFilters && !this.shouldPublish(file)) return new Notice('Not in publish folder or tag');

    if (this.settings.wifiOnly && !isWiFiConnected()) {
      await this.queueManager.addToQueue(file, 'Wi-Fi only');
      return;
    }

    if (isMobileDevice() && this.settings.confirmOnMobile && !skipConfirmation) {
      new ConfirmModal(this.app, this, file).open();
      return;
    }
    await this.doPublish(file);
  }

  async doPublish(file: TFile) {
    const content = await this.app.vault.read(file);
    if (!navigator.onLine) {
      await this.queueManager.addToQueue(file, 'Offline');
      return;
    }

    const result = await this.publisher.publish(content, file.path, { interactive: true });
    if (result.success) {
      new Notice(`Published: ${file.basename}`);
      if (result.permalink) new PermalinkModal(this.app, result.permalink).open();
    } else {
      new Notice(`Failed: ${result.error}`);
      await this.queueManager.addToQueue(file, 'Error');
    }
  }

  async doPublishSilent(file: TFile): Promise<{ success: boolean; error?: string }> {
    const content = await this.app.vault.read(file);
    if (!navigator.onLine) {
      await this.queueManager.addToQueue(file, 'Offline');
      return { success: false, error: 'Offline' };
    }

    const result = await this.publisher.publish(content, file.path, { interactive: false });
    return result;
  }

  async publishContent(content: string, filePath?: string) {
    const res = await this.publisher.publish(content, filePath, { interactive: false });
    if (!res.success) throw new Error(res.error);
  }

  previewCurrentNote() {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;
    void this.app.vault.read(file).then((content) => {
      new PreviewModal(this.app, this, content).open();
    });
  }

  bulkPublishNotes() { new BulkModal(this.app, this).open(); }

  private shouldPublish(file: TFile): boolean {
    if (isInPublishFolder(file.path, this.settings.publishFolder)) return true;
    if (this.settings.supportPublishTag && hasPublishTag(file, this.app, this.settings.publishTagName)) return true;
    return false;
  }

  async deletePost(slug: string): Promise<boolean> {
    try {
      const res = await requestUrl({
        url: `${this.settings.apiUrl}/posts/${slug}`,
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${this.settings.apiToken}` },
      });
      if (res.status < 200 || res.status >= 300) {
        const errText = typeof res.text === 'string' ? res.text : '';
        throw new Error(`API error ${res.status}: ${errText}`);
      }
      return true;
    } catch (e: unknown) {
      new Notice(`Delete failed: ${formatError(e)}`);
      return false;
    }
  }

  async fetchPostSource(slug: string): Promise<string> {
    const res = await requestUrl({
      url: `${this.settings.apiUrl}/posts/${slug}/source`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${this.settings.apiToken}` },
    });
    if (res.status < 200 || res.status >= 300) {
      const errText = typeof res.text === 'string' ? res.text : '';
      throw new Error(`API error ${res.status}: ${errText}`);
    }
    if (typeof res.text === 'string') return res.text;
    throw new Error('Empty source response');
  }

  /**
   * Fetches posts list with caching
   */
  async fetchPosts(): Promise<PostSummary[]> {
    // Check cache
    if (this.postsCache && Date.now() - this.postsCache.timestamp < POSTS_CACHE_TTL_MS) {
      return this.postsCache.data;
    }
    
    const res = await requestUrl({ url: `${this.settings.apiUrl}/posts`, method: 'GET' });
    if (res.status < 200 || res.status >= 300) return [];
    
    const posts = Array.isArray(res.json) ? res.json as PostSummary[] : [];
    this.postsCache = { data: posts, timestamp: Date.now() };
    return posts;
  }
  
  /**
   * Invalidates posts cache
   */
  invalidatePostsCache(): void {
    this.postsCache = null;
  }

  async publishRawMarkdown(markdown: string): Promise<{ permalink?: string }> {
    const result = await this.publisher.publishRaw(markdown);
    if (!result.success) throw new Error(result.error || 'Unknown publish error');
    return { permalink: result.permalink };
  }

  private onFileModified(file: TAbstractFile) {
    if (!(file instanceof TFile)) return;
    if (!this.settings.autoPublish) return;
    
    // Check if file is already being published (BEFORE setting timer)
    if (this.publishInProgress.has(file.path)) {
      return;
    }
    
    const shouldPublish = this.settings.publishFolder
      ? isInPublishFolder(file.path, this.settings.publishFolder)
      : this.settings.supportPublishTag
      ? hasPublishTag(file, this.app, this.settings.publishTagName)
      : false;
    
    if (!shouldPublish) return;
    
    // Cancel previous timer for this file
    if (this.autoPublishTimers[file.path]) {
      window.clearTimeout(this.autoPublishTimers[file.path]);
    }
    
    this.autoPublishTimers[file.path] = window.setTimeout(() => {
      delete this.autoPublishTimers[file.path];
      
      // Double check before publishing
      if (this.publishInProgress.has(file.path)) {
        return;
      }
      
      this.publishInProgress.add(file.path);
      void this.doPublish(file).finally(() => {
        this.publishInProgress.delete(file.path);
      });
    }, AUTO_PUBLISH_DEBOUNCE_MS);
  }
}
