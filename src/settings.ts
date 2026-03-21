import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type { QueueItem } from './queue';
import Note2CMSPublisher from './main';

export interface Note2CMSSettings {
  apiUrl: string;
  apiToken: string;
  publishFolder: string;
  autoPublish: boolean;
  includeFrontmatter: boolean;
  confirmOnMobile: boolean;
  wifiOnly: boolean;
  supportPublishTag: boolean;
  publishTagName: string;
  queueRetryCount: number;
  queueRetryDelay: number;
  queue?: QueueItem[];
}

export const DEFAULT_SETTINGS: Note2CMSSettings = {
  apiUrl: 'http://localhost:8000',
  apiToken: '',
  publishFolder: 'Publish',
  autoPublish: false,
  includeFrontmatter: true,
  confirmOnMobile: true,
  wifiOnly: false,
  supportPublishTag: true,
  publishTagName: 'publish',
  queueRetryCount: 3,
  queueRetryDelay: 60000,
  queue: [],
};

export class Note2CMSSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: Note2CMSPublisher) { super(app, plugin); }

  display(): void {
    const { containerEl } = this; containerEl.empty();
    const heading = new Setting(containerEl)
      .setName('Own what you publish')
      .setHeading();
    heading.settingEl.addClass('note2cms-settings-header');
    const githubLink = heading.controlEl.createEl('a', {
      text: 'Link to GitHub',
      href: 'https://github.com/garrul4ik/note2cms-publisher',
    });
    githubLink.addClass('note2cms-settings-link');
    githubLink.setAttr('target', '_blank');
    githubLink.setAttr('rel', 'noopener noreferrer');

    new Setting(containerEl).setName('API URL').addText(t => t
      .setValue(this.plugin.settings.apiUrl)
      .onChange((v) => { void this.updateSetting('apiUrl', v); }));

    new Setting(containerEl).setName('API token').addText(t => t
      .setValue(this.plugin.settings.apiToken)
      .onChange((v) => { void this.updateSetting('apiToken', v); })
      .inputEl.setAttribute('type', 'password'));

    new Setting(containerEl).setName('Test connection').addButton(b => b
      .setButtonText('Test').onClick(() => { void this.handleTestConnection(); }));

    new Setting(containerEl).setName('Publish folder').addText(t => t
      .setValue(this.plugin.settings.publishFolder)
      .onChange((v) => { void this.updateSetting('publishFolder', v); }));

    new Setting(containerEl).setName('Auto publish on change').addToggle(t => t
      .setValue(this.plugin.settings.autoPublish)
      .onChange((v) => { void this.updateSetting('autoPublish', v); }));

    new Setting(containerEl).setName('Confirm on mobile').addToggle(t => t
      .setValue(this.plugin.settings.confirmOnMobile)
      .onChange((v) => { void this.updateSetting('confirmOnMobile', v); }));

    new Setting(containerEl).setName('Wifi only').addToggle(t => t
      .setValue(this.plugin.settings.wifiOnly)
      .onChange((v) => { void this.updateSetting('wifiOnly', v); }));

    new Setting(containerEl).setName('Support #publish tag').addToggle(t => t
      .setValue(this.plugin.settings.supportPublishTag)
      .onChange((v) => { void this.updateSetting('supportPublishTag', v); }));

    new Setting(containerEl).setName('View queue').addButton(b => b
      .setButtonText('View').onClick(() => { this.plugin.queueManager.showQueueModal(); }));

    new Setting(containerEl).setName('Clear queue').addButton(b => b
      .setButtonText('Clear').onClick(() => { void this.plugin.queueManager.clearQueue(); }));
  }

  private async updateSetting<K extends keyof Note2CMSSettings>(key: K, value: Note2CMSSettings[K]) {
    this.plugin.settings[key] = value;
    await this.plugin.saveSettings();
  }

  private async handleTestConnection() {
    const res = await this.plugin.testConnection();
    new Notice(res.success ? 'Success' : `Failed: ${res.error}`);
  }
}
