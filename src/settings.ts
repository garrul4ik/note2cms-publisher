import { App, PluginSettingTab, Setting } from 'obsidian';
import Note2CMSPublisher from './main';

export interface Note2CMSSettings {
  apiUrl: string; apiToken: string; publishFolder: string;
  autoPublish: boolean; includeFrontmatter: boolean;
  confirmOnMobile: boolean; wifiOnly: boolean;
  supportPublishTag: boolean; publishTagName: string;
  queueRetryCount: number; queueRetryDelay: number;
  queue?: any[];
}

export const DEFAULT_SETTINGS: Note2CMSSettings = {
  apiUrl: 'http://localhost:8000', apiToken: '', publishFolder: '📤 Publish',
  autoPublish: false, includeFrontmatter: true, confirmOnMobile: true,
  wifiOnly: false, supportPublishTag: true, publishTagName: 'publish',
  queueRetryCount: 3, queueRetryDelay: 60000,
  queue: [],
};

export class Note2CMSSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: Note2CMSPublisher) { super(app, plugin); }

  display(): void {
    const { containerEl } = this; containerEl.empty();

    new Setting(containerEl).setName('API URL').addText(t => t
      .setValue(this.plugin.settings.apiUrl)
      .onChange(async v => { this.plugin.settings.apiUrl = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName('API Token').addText(t => t
      .setValue(this.plugin.settings.apiToken)
      .onChange(async v => { this.plugin.settings.apiToken = v; await this.plugin.saveSettings(); })
      .inputEl.setAttribute('type', 'password'));

    new Setting(containerEl).setName('Test Connection').addButton(b => b
      .setButtonText('Test').onClick(async () => {
        const res = await this.plugin.testConnection();
        alert(res.success ? '✅ Success' : '❌ Failed: ' + res.error);
      }));

    new Setting(containerEl).setName('Publish Folder').addText(t => t
      .setValue(this.plugin.settings.publishFolder)
      .onChange(async v => { this.plugin.settings.publishFolder = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName('Auto publish on change').addToggle(t => t
      .setValue(this.plugin.settings.autoPublish)
      .onChange(async v => { this.plugin.settings.autoPublish = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName('Confirm on Mobile').addToggle(t => t
      .setValue(this.plugin.settings.confirmOnMobile)
      .onChange(async v => { this.plugin.settings.confirmOnMobile = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName('WiFi Only').addToggle(t => t
      .setValue(this.plugin.settings.wifiOnly)
      .onChange(async v => { this.plugin.settings.wifiOnly = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName('Support #publish Tag').addToggle(t => t
      .setValue(this.plugin.settings.supportPublishTag)
      .onChange(async v => { this.plugin.settings.supportPublishTag = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName('View Queue').addButton(b => b
      .setButtonText('View').onClick(() => this.plugin.queueManager.showQueueModal()));

    new Setting(containerEl).setName('Clear Queue').addButton(b => b
      .setButtonText('Clear').onClick(async () => this.plugin.queueManager.clearQueue()));
  }
}
