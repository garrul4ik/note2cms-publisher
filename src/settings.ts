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
  frontmatterMode: 'smart_normalize';
  showQuickFixModal: boolean;
  defaultWritebackAction: 'ask' | 'publish_only' | 'publish_and_save';
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
  frontmatterMode: 'smart_normalize',
  showQuickFixModal: true,
  defaultWritebackAction: 'ask',
  queue: [],
};

/**
 * Валидатор настроек плагина
 */
class SettingsValidator {
  static validateApiUrl(url: string): { valid: boolean; error?: string } {
    if (!url || url.trim().length === 0) {
      return { valid: false, error: 'API URL cannot be empty' };
    }
    try {
      new URL(url);
      return { valid: true };
    } catch {
      return { valid: false, error: 'Invalid URL format' };
    }
  }

  static validateApiToken(token: string): { valid: boolean; error?: string } {
    if (!token || token.trim().length === 0) {
      return { valid: false, error: 'API token cannot be empty' };
    }
    if (token.length < 10) {
      return { valid: false, error: 'API token too short' };
    }
    return { valid: true };
  }

  static validatePublishFolder(folder: string): { valid: boolean; error?: string } {
    if (!folder) return { valid: true }; // Пустая папка допустима
    
    // Проверка на path traversal
    if (folder.includes('..')) {
      return { valid: false, error: 'Path traversal not allowed' };
    }
    
    return { valid: true };
  }

  static validateTagName(tagName: string): { valid: boolean; error?: string } {
    if (!tagName || tagName.trim().length === 0) {
      return { valid: false, error: 'Tag name cannot be empty' };
    }
    
    // Проверка на недопустимые символы
    if (!/^[a-zA-Z0-9_-]+$/.test(tagName.replace(/^#+/, ''))) {
      return { valid: false, error: 'Tag name contains invalid characters' };
    }
    
    return { valid: true };
  }
}

/**
 * Вкладка настроек плагина с валидацией
 */
export class Note2CMSSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: Note2CMSPublisher) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    
    this.renderHeader(containerEl);
    this.renderApiSettings(containerEl);
    this.renderPublishSettings(containerEl);
    this.renderBehaviorSettings(containerEl);
    this.renderQueueSettings(containerEl);
  }

  private renderHeader(containerEl: HTMLElement): void {
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
  }

  private renderApiSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('API URL')
      .setDesc('URL of your CMS API endpoint')
      .addText(t => {
        t.setValue(this.plugin.settings.apiUrl)
          .onChange((v) => { void this.updateSettingWithValidation('apiUrl', v, SettingsValidator.validateApiUrl); });
        return t;
      });

    new Setting(containerEl)
      .setName('API token')
      .setDesc('Authentication token for API access')
      .addText(t => {
        t.setValue(this.plugin.settings.apiToken)
          .onChange((v) => { void this.updateSettingWithValidation('apiToken', v, SettingsValidator.validateApiToken); });
        t.inputEl.setAttribute('type', 'password');
        return t;
      });

    new Setting(containerEl).setName('Test connection').addButton(b => b
      .setButtonText('Test').onClick(() => { void this.handleTestConnection(); }));
  }

  private renderPublishSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('Publish folder')
      .setDesc('Folder containing notes to publish')
      .addText(t => {
        t.setValue(this.plugin.settings.publishFolder)
          .onChange((v) => { void this.updateSettingWithValidation('publishFolder', v, SettingsValidator.validatePublishFolder); });
        return t;
      });

    new Setting(containerEl)
      .setName('Support #publish tag')
      .setDesc('Allow publishing notes with specific tag')
      .addToggle(t => {
        t.setValue(this.plugin.settings.supportPublishTag)
          .onChange((v) => { void this.updateSetting('supportPublishTag', v); });
        return t;
      });

    new Setting(containerEl)
      .setName('Publish tag name')
      .setDesc('Tag name for publishing (without #)')
      .addText(t => {
        t.setValue(this.plugin.settings.publishTagName)
          .onChange((v) => { void this.updateSettingWithValidation('publishTagName', v, SettingsValidator.validateTagName); });
        return t;
      });
  }

  private renderBehaviorSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Auto publish on change').addToggle(t => t
      .setValue(this.plugin.settings.autoPublish)
      .onChange((v) => { void this.updateSetting('autoPublish', v); }));

    new Setting(containerEl).setName('Confirm on mobile').addToggle(t => t
      .setValue(this.plugin.settings.confirmOnMobile)
      .onChange((v) => { void this.updateSetting('confirmOnMobile', v); }));

    new Setting(containerEl).setName('Wifi only').addToggle(t => t
      .setValue(this.plugin.settings.wifiOnly)
      .onChange((v) => { void this.updateSetting('wifiOnly', v); }));

    new Setting(containerEl).setName('Frontmatter mode').addDropdown((d) => d
      .addOption('smart_normalize', 'Smart normalize')
      .setValue(this.plugin.settings.frontmatterMode)
      .onChange((v) => { void this.updateSetting('frontmatterMode', v as 'smart_normalize'); }));

    new Setting(containerEl).setName('Show quick-fix modal').addToggle((t) => t
      .setValue(this.plugin.settings.showQuickFixModal)
      .onChange((v) => { void this.updateSetting('showQuickFixModal', v); }));

    new Setting(containerEl).setName('Default writeback action').addDropdown((d) => d
      .addOption('ask', 'Ask each time')
      .addOption('publish_only', 'Publish only')
      .addOption('publish_and_save', 'Publish and save')
      .setValue(this.plugin.settings.defaultWritebackAction)
      .onChange((v) => {
        void this.updateSetting('defaultWritebackAction', v as 'ask' | 'publish_only' | 'publish_and_save');
      }));
  }

  private renderQueueSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('View queue').addButton(b => b
      .setButtonText('View').onClick(() => { this.plugin.queueManager.showQueueModal(); }));

    new Setting(containerEl).setName('Clear queue').addButton(b => b
      .setButtonText('Clear').onClick(() => { void this.plugin.queueManager.clearQueue(); }));
  }

  /**
   * Обновляет настройку без валидации
   */
  private async updateSetting<K extends keyof Note2CMSSettings>(key: K, value: Note2CMSSettings[K]) {
    this.plugin.settings[key] = value;
    await this.plugin.saveSettings();
  }

  /**
   * Обновляет настройку с валидацией
   */
  private async updateSettingWithValidation<K extends keyof Note2CMSSettings>(
    key: K,
    value: Note2CMSSettings[K],
    validator: (val: string) => { valid: boolean; error?: string }
  ) {
    const validation = validator(value as string);
    if (!validation.valid) {
      new Notice(`Validation error: ${validation.error}`);
      return;
    }
    
    this.plugin.settings[key] = value;
    await this.plugin.saveSettings();
  }

  /**
   * Обрабатывает тестирование соединения
   */
  private async handleTestConnection() {
    // Валидация перед тестированием
    const urlValidation = SettingsValidator.validateApiUrl(this.plugin.settings.apiUrl);
    if (!urlValidation.valid) {
      new Notice(`Invalid API URL: ${urlValidation.error}`);
      return;
    }

    const tokenValidation = SettingsValidator.validateApiToken(this.plugin.settings.apiToken);
    if (!tokenValidation.valid) {
      new Notice(`Invalid API token: ${tokenValidation.error}`);
      return;
    }

    const res = await this.plugin.testConnection();
    new Notice(res.success ? 'Connection successful' : `Connection failed: ${res.error}`);
  }
}
