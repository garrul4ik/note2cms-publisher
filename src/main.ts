import { App, Modal, Notice, Plugin, TAbstractFile, TFile, requestUrl } from 'obsidian';
import { Note2CMSSettingTab, DEFAULT_SETTINGS, Note2CMSSettings } from './settings';
import { PublishQueueManager } from './queue';
import { Publisher } from './publisher';
import { PreviewModal } from './preview';
import { isMobileDevice, isWiFiConnected, hasPublishTag, isInPublishFolder } from './utils';

interface PostSummary {
  slug: string;
  title?: string;
  permalink?: string;
}

declare global {
  interface Window {
    note2cmsPlugin?: Note2CMSPublisher;
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default class Note2CMSPublisher extends Plugin {
  settings: Note2CMSSettings;
  settingTab: Note2CMSSettingTab;
  queueManager: PublishQueueManager;
  publisher: Publisher;
  private autoPublishTimers: Record<string, number> = {};

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
    this.addRibbonIcon('upload', 'Publish', () => { void this.publishCurrentNote(); });

    this.registerEvent(this.app.vault.on('modify', (file) => this.onFileModified(file)));

    window.note2cmsPlugin = this;
  }

  async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
  async saveSettings() { await this.saveData(this.settings); }

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
      return { success: false, error: errorMessage(e) };
    }
  }

  async publishCurrentNote(skipConfirmation: boolean = false, ignoreFilters: boolean = false) {
    const file = this.app.workspace.getActiveFile();
    if (!file) return new Notice('No active file');
    if (!ignoreFilters && !this.shouldPublish(file)) return new Notice('Not in publish folder or tag');

    if (this.settings.wifiOnly && !isWiFiConnected()) {
      const content = await this.app.vault.read(file);
      await this.queueManager.addToQueue(file, content, 'Wi-Fi only');
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
      await this.queueManager.addToQueue(file, content, 'Offline');
      return;
    }

    const result = await this.publisher.publish(content, file.path);
    if (result.success) {
      new Notice(`Published: ${file.basename}`);
      if (result.permalink) new PermalinkModal(this.app, result.permalink).open();
    } else {
      new Notice(`Failed: ${result.error}`);
      await this.queueManager.addToQueue(file, content, 'Error');
    }
  }

  async publishContent(content: string, filePath?: string) {
    const res = await this.publisher.publish(content, filePath);
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
        throw new Error(`API Error ${res.status}: ${errText}`);
      }
      return true;
    } catch (e: unknown) {
      new Notice(`Delete failed: ${errorMessage(e)}`);
      return false;
    }
  }

  async fetchPosts(): Promise<PostSummary[]> {
    const res = await requestUrl({ url: `${this.settings.apiUrl}/posts`, method: 'GET' });
    if (res.status < 200 || res.status >= 300) return [];
    return res.json as PostSummary[];
  }

  private onFileModified(file: TAbstractFile) {
    if (!this.settings.autoPublish) return;
    if (!(file instanceof TFile)) return;
    if (file.extension !== 'md') return;
    if (!this.shouldPublish(file)) return;

    const existing = this.autoPublishTimers[file.path];
    if (existing) window.clearTimeout(existing);

    this.autoPublishTimers[file.path] = window.setTimeout(() => {
      delete this.autoPublishTimers[file.path];
      if (isMobileDevice() && this.settings.confirmOnMobile) {
        new Notice('Auto publish is disabled on mobile while confirmation is enabled');
        return;
      }
      void this.doPublish(file);
    }, 500);
  }
}

class ConfirmModal extends Modal {
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

class PermalinkModal extends Modal {
  constructor(app: App, private permalink: string) { super(app); }
  onOpen() {
    const { contentEl } = this; contentEl.empty();
    contentEl.createEl('h2', { text: 'Published' });
    const linkEl = contentEl.createEl('p');
    linkEl.createEl('a', { text: this.permalink, href: this.permalink });
    const btn = contentEl.createEl('button', { text: 'Copy link' });
    btn.onclick = () => { void this.copyLink(); };
    contentEl.createEl('button', { text: 'Close' }).onclick = () => this.close();
  }
  onClose() { this.contentEl.empty(); }

  private async copyLink() {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(this.permalink);
      new Notice('Copied');
    } else {
      new Notice('Clipboard not available');
    }
  }
}

class BulkModal extends Modal {
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

  private async publishSelected(files: TFile[]) {
    for (const f of files) { await this.plugin.doPublish(f); }
    new Notice('Bulk publish complete');
  }
}

class ConfirmDeleteModal extends Modal {
  private resolved = false;
  constructor(app: App, private title: string, private onResult: (ok: boolean) => void) { super(app); }
  onOpen() {
    const { contentEl } = this; contentEl.empty();
    contentEl.createEl('h2', { text: 'Delete post' });
    contentEl.createEl('p', { text: `Delete "${this.title}"?` });
    contentEl.createEl('button', { text: 'Delete' }).onclick = () => {
      this.resolved = true;
      this.onResult(true);
      this.close();
    };
    contentEl.createEl('button', { text: 'Cancel' }).onclick = () => {
      this.resolved = true;
      this.onResult(false);
      this.close();
    };
  }
  onClose() {
    this.contentEl.empty();
    if (!this.resolved) this.onResult(false);
  }
}

class ManagePostsModal extends Modal {
  private posts: PostSummary[] = [];
  private filtered: PostSummary[] = [];
  private renderList?: () => void;
  constructor(app: App, private plugin: Note2CMSPublisher) { super(app); }
  async onOpen() {
    const { contentEl } = this; contentEl.empty();
    contentEl.createEl('h2', { text: 'Manage posts' });
    const search = contentEl.createEl('input');
    search.type = 'text';
    search.placeholder = 'Search by title or slug';
    search.addClass('note2cms-search-input');

    const list = contentEl.createEl('div');
    list.addClass('note2cms-scroll');

    list.createEl('p', { text: 'Loading...' });
    this.posts = await this.plugin.fetchPosts();
    this.filtered = this.posts;
    list.empty();

    const render = () => {
      list.empty();
      if (!this.filtered.length) {
        list.createEl('p', { text: 'No posts found' });
        return;
      }
      this.filtered.forEach(post => {
        const row = list.createEl('div');
        row.addClass('note2cms-row');
        const label = row.createEl('div');
        label.createEl('div', { text: post.title || post.slug || 'Untitled' });
        if (post.permalink) {
          const a = label.createEl('a', { text: post.permalink, href: post.permalink });
          a.addClass('note2cms-permalink');
        }
        const del = row.createEl('button', { text: 'Delete' });
        del.onclick = () => { void this.handleDelete(post); };
      });
    };

    this.renderList = render;
    render();

    search.oninput = () => {
      const q = search.value.trim().toLowerCase();
      if (!q) {
        this.filtered = this.posts;
      } else {
        this.filtered = this.posts.filter(p => {
          const title = (p.title || '').toLowerCase();
          const slug = (p.slug || '').toLowerCase();
          return title.includes(q) || slug.includes(q);
        });
      }
      render();
    };
    contentEl.createEl('button', { text: 'Close' }).onclick = () => this.close();
  }
  onClose() { this.contentEl.empty(); }

  private confirmDelete(title: string): Promise<boolean> {
    return new Promise((resolve) => {
      new ConfirmDeleteModal(this.app, title, resolve).open();
    });
  }

  private async handleDelete(post: PostSummary) {
    const title = post.title || post.slug || 'Untitled';
    const confirmed = await this.confirmDelete(title);
    if (!confirmed) return;
    const ok = await this.plugin.deletePost(post.slug);
    if (ok) {
      this.posts = this.posts.filter(p => p.slug !== post.slug);
      this.filtered = this.filtered.filter(p => p.slug !== post.slug);
      new Notice('Deleted');
      if (this.renderList) this.renderList();
    }
  }
}
