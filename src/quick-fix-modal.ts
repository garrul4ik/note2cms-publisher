import { App, Modal } from 'obsidian';
import type { FrontmatterIssue } from './frontmatter-preflight';

export type QuickFixAction = 'publish_only' | 'publish_and_save' | 'cancel';

export interface QuickFixResult {
  action: QuickFixAction;
  markdown?: string;
}

interface QuickFixModalProps {
  issues: FrontmatterIssue[];
  originalMarkdown: string;
  normalizedMarkdown: string;
  defaultAction: QuickFixAction;
}

export class QuickFixModal extends Modal {
  private resolved = false;
  private editableAfter?: HTMLTextAreaElement;

  constructor(
    app: App,
    private props: QuickFixModalProps,
    private onResult: (result: QuickFixResult) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: 'Frontmatter quick fix' });
    contentEl.createEl('p', {
      text: 'The note has frontmatter issues. Review fixes before publishing.',
    });

    const issueList = contentEl.createEl('ul');
    issueList.addClass('note2cms-issues-list');
    this.props.issues.forEach((issue) => {
      issueList.createEl('li', { text: issue.message });
    });

    const compare = contentEl.createEl('div');
    compare.addClass('note2cms-compare-grid');

    const beforeWrap = compare.createEl('div');
    beforeWrap.createEl('h3', { text: 'Before' });
    const beforeText = beforeWrap.createEl('textarea');
    beforeText.addClass('note2cms-editor');
    beforeText.addClass('note2cms-readonly');
    beforeText.value = this.props.originalMarkdown;
    beforeText.readOnly = true;

    const afterWrap = compare.createEl('div');
    afterWrap.createEl('h3', { text: 'After' });
    const afterText = afterWrap.createEl('textarea');
    afterText.addClass('note2cms-editor');
    afterText.value = this.props.normalizedMarkdown;
    this.editableAfter = afterText;

    const buttons = contentEl.createEl('div');
    buttons.addClass('note2cms-button-row');

    const publishOnly = buttons.createEl('button', { text: 'Publish only' });
    publishOnly.onclick = () => this.resolveWithCurrent('publish_only');

    const publishAndSave = buttons.createEl('button', { text: 'Publish and save' });
    publishAndSave.onclick = () => this.resolveWithCurrent('publish_and_save');

    const cancel = buttons.createEl('button', { text: 'Cancel' });
    cancel.onclick = () => this.resolve({ action: 'cancel' });

    if (this.props.defaultAction === 'publish_and_save') {
      publishAndSave.addClass('mod-cta');
    } else if (this.props.defaultAction === 'publish_only') {
      publishOnly.addClass('mod-cta');
    } else {
      cancel.addClass('mod-muted');
    }
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.onResult({ action: 'cancel' });
    }
  }

  private resolve(result: QuickFixResult): void {
    if (this.resolved) return;
    this.resolved = true;
    this.onResult(result);
    this.close();
  }

  private resolveWithCurrent(action: QuickFixAction): void {
    this.resolve({
      action,
      markdown: this.editableAfter?.value ?? this.props.normalizedMarkdown,
    });
  }
}

export function showQuickFixModal(app: App, props: QuickFixModalProps): Promise<QuickFixResult> {
  return new Promise((resolve) => {
    new QuickFixModal(app, props, resolve).open();
  });
}
