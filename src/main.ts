import { App, Modal, Notice, Plugin, TAbstractFile, TFile, requestUrl } from 'obsidian';
import { Note2CMSSettingTab, DEFAULT_SETTINGS, Note2CMSSettings } from './settings';
import { PublishQueueManager } from './queue';
import { Publisher } from './publisher';
import { PreviewModal } from './preview';
import { isMobileDevice, isWiFiConnected, hasPublishTag, isInPublishFolder } from './utils';

// Константы
const AUTO_PUBLISH_DEBOUNCE_MS = 500;
const POSTS_CACHE_TTL_MS = 60000; // 1 минута
const BULK_PUBLISH_BATCH_SIZE = 5;
const BULK_PUBLISH_DELAY_MS = 100;

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

/**
 * Преобразует ошибку в читаемое сообщение
 */
function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return 'Unknown error';
  }
}

/**
 * Главный класс плагина для публикации заметок в CMS
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

  async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<Note2CMSSettings>); }
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
      new Notice(`Delete failed: ${errorMessage(e)}`);
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
   * Получает список постов с кешированием
   */
  async fetchPosts(): Promise<PostSummary[]> {
    // Проверка кеша
    if (this.postsCache && Date.now() - this.postsCache.timestamp < POSTS_CACHE_TTL_MS) {
      return this.postsCache.data;
    }
    
    const res = await requestUrl({ url: `${this.settings.apiUrl}/posts`, method: 'GET' });
    if (res.status < 200 || res.status >= 300) return [];
    
    const posts = res.json as PostSummary[];
    this.postsCache = { data: posts, timestamp: Date.now() };
    return posts;
  }
  
  /**
   * Инвалидирует кеш постов
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
    
    const shouldPublish = this.settings.publishFolder
      ? isInPublishFolder(file.path, this.settings.publishFolder)
      : this.settings.supportPublishTag
      ? hasPublishTag(file, this.app, this.settings.publishTagName)
      : false;
    
    if (!shouldPublish) return;
    
    // Отменить предыдущий таймер для этого файла
    if (this.autoPublishTimers[file.path]) {
      window.clearTimeout(this.autoPublishTimers[file.path]);
    }
    
    this.autoPublishTimers[file.path] = window.setTimeout(() => {
      delete this.autoPublishTimers[file.path];
      
      // Проверить, не идёт ли уже публикация этого файла
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

  /**
   * Публикует выбранные файлы параллельными батчами
   */
  private async publishSelected(files: TFile[]) {
    let successCount = 0;
    let failCount = 0;
    
    // Публикуем батчами для оптимизации
    for (let i = 0; i < files.length; i += BULK_PUBLISH_BATCH_SIZE) {
      const batch = files.slice(i, i + BULK_PUBLISH_BATCH_SIZE);
      
      const results = await Promise.allSettled(
        batch.map(f => this.plugin.doPublish(f))
      );
      
      results.forEach(result => {
        if (result.status === 'fulfilled') {
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

class EditPostModal extends Modal {
  private saveInProgress = false;

  constructor(
    app: App,
    private plugin: Note2CMSPublisher,
    private post: PostSummary,
    private sourceMarkdown: string,
    private onSaved: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: `Edit: ${this.post.title || this.post.slug || 'Untitled'}` });

    const editor = contentEl.createEl('textarea');
    editor.addClass('note2cms-editor');
    editor.value = this.sourceMarkdown;

    const buttons = contentEl.createEl('div');
    buttons.addClass('note2cms-button-row');

    const saveBtn = buttons.createEl('button', { text: 'Save' });
    saveBtn.onclick = () => { void this.handleSave(editor, saveBtn); };

    buttons.createEl('button', { text: 'Cancel' }).onclick = () => this.close();
  }

  onClose() { this.contentEl.empty(); }

  private async handleSave(editor: HTMLTextAreaElement, saveBtn: HTMLButtonElement) {
    if (this.saveInProgress) return;
    this.saveInProgress = true;
    saveBtn.disabled = true;
    try {
      await this.plugin.publishRawMarkdown(editor.value);
      new Notice('Post updated');
      this.plugin.invalidatePostsCache(); // Инвалидация кеша после обновления
      await this.onSaved();
      this.close();
    } catch (e: unknown) {
      new Notice(`Update failed: ${errorMessage(e)}`);
    } finally {
      this.saveInProgress = false;
      saveBtn.disabled = false;
    }
  }
}

class ManagePostsModal extends Modal {
  private posts: PostSummary[] = [];
  private filtered: PostSummary[] = [];
  private renderList?: () => void;
  private currentSearch = '';
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
        const actions = row.createEl('div');
        actions.addClass('note2cms-row-actions');

        const edit = actions.createEl('button', { text: 'Edit' });
        edit.addClass('note2cms-edit-button');
        edit.onclick = () => { void this.handleEdit(post); };

        const del = actions.createEl('button', { text: 'Delete' });
        del.addClass('note2cms-delete-button');
        del.onclick = () => { void this.handleDelete(post); };
      });
    };

    this.renderList = render;
    render();

    search.oninput = () => this.applyFilter(search.value);
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
      this.plugin.invalidatePostsCache(); // Инвалидация кеша после удаления
      this.posts = this.posts.filter(p => p.slug !== post.slug);
      this.filtered = this.filtered.filter(p => p.slug !== post.slug);
      new Notice('Deleted');
      if (this.renderList) this.renderList();
    }
  }

  private async handleEdit(post: PostSummary) {
    try {
      const source = await this.plugin.fetchPostSource(post.slug);
      new EditPostModal(this.app, this.plugin, post, source, async () => {
        this.posts = await this.plugin.fetchPosts();
        this.applyFilter(this.currentSearch);
      }).open();
    } catch (e: unknown) {
      new Notice(`Load source failed: ${errorMessage(e)}`);
    }
  }

  private applyFilter(searchValue: string) {
    this.currentSearch = searchValue.trim().toLowerCase();
    if (!this.currentSearch) {
      this.filtered = this.posts;
    } else {
      this.filtered = this.posts.filter((p) => {
        const title = (p.title || '').toLowerCase();
        const slug = (p.slug || '').toLowerCase();
        return title.includes(this.currentSearch) || slug.includes(this.currentSearch);
      });
    }
    if (this.renderList) this.renderList();
  }
}
