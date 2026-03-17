import { Plugin, Notice, TFile, Modal, App } from 'obsidian';
import { Note2CMSSettingTab, DEFAULT_SETTINGS, Note2CMSSettings } from './settings';
import { PublishQueueManager } from './queue';
import { Publisher } from './publisher';
import { PreviewModal } from './preview';
import { isMobileDevice, isWiFiConnected, hasPublishTag, isInPublishFolder } from './utils';

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
    await this.queueManager.initialize();

    this.settingTab = new Note2CMSSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

    this.addCommand({ id: 'publish-current-note', name: 'Publish current note', callback: () => this.publishCurrentNote() });
    this.addCommand({ id: 'publish-current-note-any', name: 'Publish current note (any)', callback: () => this.publishCurrentNote(true, true) });
    this.addCommand({ id: 'bulk-publish-notes', name: 'Bulk publish', callback: () => this.bulkPublishNotes() });
    this.addCommand({ id: 'preview-publish', name: 'Preview note', callback: () => this.previewCurrentNote() });
    this.addCommand({ id: 'manage-posts', name: 'Manage published posts', callback: () => new ManagePostsModal(this.app, this).open() });
    this.addRibbonIcon('upload', 'Publish', () => this.publishCurrentNote());

    this.registerEvent(this.app.vault.on('modify', (file) => this.onFileModified(file)));

    (window as any).note2cmsPlugin = this;
  }

  async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
  async saveSettings() { await this.saveData(this.settings); }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.settings.apiUrl}/posts`, { headers: { 'Authorization': `Bearer ${this.settings.apiToken}` } });
      return res.ok ? { success: true } : { success: false, error: `Status ${res.status}` };
    } catch (e: any) { return { success: false, error: e.message }; }
  }

  async publishCurrentNote(skipConfirmation: boolean = false, ignoreFilters: boolean = false) {
    const file = this.app.workspace.getActiveFile();
    if (!file) return new Notice('⚠️ No active file');
    if (!ignoreFilters && !this.shouldPublish(file)) return new Notice('⚠️ Not in publish folder/tag');

    if (this.settings.wifiOnly && !isWiFiConnected()) {
      const content = await this.app.vault.read(file);
      await this.queueManager.addToQueue(file, content, 'WiFi only'); return;
    }

    if (isMobileDevice() && this.settings.confirmOnMobile && !skipConfirmation) {
      new ConfirmModal(this.app, this, file).open(); return;
    }
    await this.doPublish(file);
  }

  async doPublish(file: TFile) {
    const content = await this.app.vault.read(file);
    if (!navigator.onLine) { await this.queueManager.addToQueue(file, content, 'offline'); return; }
    
    const result = await this.publisher.publish(content, file.path);
    if (result.success) {
      new Notice(`✅ Published: ${file.basename}`);
      if (result.permalink) new PermalinkModal(this.app, result.permalink).open();
    } else {
      new Notice(`❌ Failed: ${result.error}`);
      await this.queueManager.addToQueue(file, content, 'error');
    }
  }

  async publishContent(content: string, filePath?: string) {
    const res = await this.publisher.publish(content, filePath);
    if (!res.success) throw new Error(res.error);
  }

  async previewCurrentNote() {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;
    const content = await this.app.vault.read(file);
    new PreviewModal(this.app, this, this.publisher, content).open();
  }

  async bulkPublishNotes() { new BulkModal(this.app, this).open(); }

  private shouldPublish(file: TFile): boolean {
    if (isInPublishFolder(file.path, this.settings.publishFolder)) return true;
    if (this.settings.supportPublishTag && hasPublishTag(file, this.app, this.settings.publishTagName)) return true;
    return false;
  }

  async deletePost(slug: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.settings.apiUrl}/posts/${slug}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${this.settings.apiToken}` },
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`API Error ${res.status}: ${errText}`);
      }
      return true;
    } catch (e: any) {
      new Notice(`❌ Delete failed: ${e.message}`);
      return false;
    }
  }

  async fetchPosts(): Promise<any[]> {
    const res = await fetch(`${this.settings.apiUrl}/posts`);
    if (!res.ok) return [];
    return await res.json();
  }

  private onFileModified(file: any) {
    if (!this.settings.autoPublish) return;
    if (!(file instanceof TFile)) return;
    if (file.extension !== 'md') return;
    if (!this.shouldPublish(file)) return;

    const existing = this.autoPublishTimers[file.path];
    if (existing) window.clearTimeout(existing);

    this.autoPublishTimers[file.path] = window.setTimeout(async () => {
      delete this.autoPublishTimers[file.path];
      if (isMobileDevice() && this.settings.confirmOnMobile) {
        new Notice('Auto publish is disabled on mobile while confirmation is enabled');
        return;
      }
      await this.doPublish(file);
    }, 500);
  }
}

class ConfirmModal extends Modal {
  constructor(app: App, private plugin: Note2CMSPublisher, private file: TFile) { super(app); }
  onOpen() {
    const { contentEl } = this; contentEl.empty();
    contentEl.createEl('h2', { text: 'Confirm Publish' });
    contentEl.createEl('p', { text: `Publish "${this.file.basename}"?` });
    contentEl.createEl('button', { text: '✅ Yes' }).onclick = async () => { this.close(); await this.plugin.doPublish(this.file); };
    contentEl.createEl('button', { text: '❌ No' }).onclick = () => this.close();
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
    const btn = contentEl.createEl('button', { text: 'Copy Link' });
    btn.onclick = async () => {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(this.permalink);
        new Notice('✅ Copied');
      } else {
        new Notice('⚠️ Clipboard not available');
      }
    };
    contentEl.createEl('button', { text: 'Close' }).onclick = () => this.close();
  }
  onClose() { this.contentEl.empty(); }
}

class BulkModal extends Modal {
  constructor(app: App, private plugin: Note2CMSPublisher) { super(app); }
  onOpen() {
    const { contentEl } = this; contentEl.empty();
    contentEl.createEl('h2', { text: 'Bulk Publish' });
    const files = this.app.vault.getMarkdownFiles().filter(f => this.plugin['shouldPublish'](f));
    if (!files.length) { contentEl.createEl('p', { text: 'No files found' }); return; }
    
    let selected: TFile[] = [];
    const container = contentEl.createEl('div');
    container.style.maxHeight = '300px'; container.style.overflowY = 'auto';
    
    files.forEach(file => {
      const row = container.createEl('div'); row.style.display = 'flex'; row.style.alignItems = 'center';
      const cb = row.createEl('input'); cb.type = 'checkbox'; cb.style.marginRight = '10px';
      cb.onchange = () => selected = cb.checked ? [...selected, file] : selected.filter(f => f !== file);
      row.createEl('span', { text: file.path });
    });

    contentEl.createEl('button', { text: `Publish (${selected.length})` }).onclick = async () => {
      this.close();
      for (const f of selected) { await this.plugin.doPublish(f); }
      new Notice('✅ Bulk complete');
    };
    contentEl.createEl('button', { text: 'Close' }).onclick = () => this.close();
  }
  onClose() { this.contentEl.empty(); }
}

class ManagePostsModal extends Modal {
  private posts: any[] = [];
  private filtered: any[] = [];
  constructor(app: App, private plugin: Note2CMSPublisher) { super(app); }
  async onOpen() {
    const { contentEl } = this; contentEl.empty();
    contentEl.createEl('h2', { text: 'Manage Posts' });
    const search = contentEl.createEl('input');
    search.type = 'text';
    search.placeholder = 'Search by title or slug';
    search.setAttr('style', 'width: 100%; margin: 8px 0 12px;');

    const list = contentEl.createEl('div');
    list.setAttr('style', 'max-height: 350px; overflow-y: auto;');

    list.createEl('p', { text: 'Loading…' });
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
        row.setAttr('style', 'display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 0;');
        const label = row.createEl('div');
        label.createEl('div', { text: post.title || post.slug || 'Untitled' });
        if (post.permalink) {
          const a = label.createEl('a', { text: post.permalink, href: post.permalink });
          a.setAttr('style', 'font-size: 12px;');
        }
        const del = row.createEl('button', { text: 'Delete' });
        del.onclick = async () => {
          const confirmed = window.confirm(`Delete "${post.title || post.slug}"?`);
          if (!confirmed) return;
          const ok = await this.plugin.deletePost(post.slug);
          if (ok) {
            this.posts = this.posts.filter(p => p.slug !== post.slug);
            this.filtered = this.filtered.filter(p => p.slug !== post.slug);
            render();
            new Notice('✅ Deleted');
          }
        };
      });
    };

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
}
