import { App, Modal, Notice } from 'obsidian';
import type Note2CMSPublisher from '../main';
import type { PostSummary } from '../main';
import { ConfirmDeleteModal } from './confirm-delete-modal';
import { EditPostModal } from './edit-post-modal';
import { formatError } from '../utils';

export class ManagePostsModal extends Modal {
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
      new Notice(`Load source failed: ${formatError(e)}`);
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
