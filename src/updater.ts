import { App, Plugin, PluginManifest, normalizePath, requestUrl, requireApiVersion } from 'obsidian';

const GITHUB_LATEST_RELEASE_URL = 'https://api.github.com/repos/garrul4ik/note2cms-publisher/releases/latest';

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  assets: ReleaseAsset[];
}

/**
 * Compares two SemVer strings (e.g. "1.3.0" vs "1.3.1")
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const cleanCurrent = current.trim().replace(/^v/i, '');
  const cleanLatest = latest.trim().replace(/^v/i, '');
  if (!cleanCurrent || !cleanLatest || cleanCurrent === cleanLatest) return false;

  const cParts = cleanCurrent.split('.').map(n => Number.parseInt(n, 10) || 0);
  const lParts = cleanLatest.split('.').map(n => Number.parseInt(n, 10) || 0);
  const len = Math.max(cParts.length, lParts.length);

  for (let i = 0; i < len; i++) {
    const c = cParts[i] ?? 0;
    const l = lParts[i] ?? 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

/**
 * Fetches latest release metadata from GitHub
 */
export async function checkForUpdates(plugin: Plugin): Promise<UpdateCheckResult> {
  const res = await requestUrl({
    url: GITHUB_LATEST_RELEASE_URL,
    method: 'GET',
    headers: { Accept: 'application/vnd.github+json' },
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Status ${res.status}`);
  }

  const data = res.json as { tag_name?: unknown; assets?: unknown } | null;
  const rawTag = typeof data?.tag_name === 'string' ? data.tag_name.trim() : '';
  const latestVersion = rawTag.replace(/^v/i, '');
  if (!latestVersion) {
    throw new Error('Invalid release tag');
  }

  const rawAssets = data && Array.isArray(data.assets) ? data.assets : [];
  const assets: ReleaseAsset[] = [];
  for (const item of rawAssets) {
    if (item && typeof item === 'object') {
      const candidate = item as { name?: unknown; browser_download_url?: unknown };
      if (typeof candidate.name === 'string' && typeof candidate.browser_download_url === 'string') {
        assets.push({
          name: candidate.name,
          browser_download_url: candidate.browser_download_url,
        });
      }
    }
  }

  const currentVersion = plugin.manifest.version;
  return {
    hasUpdate: isNewerVersion(currentVersion, latestVersion),
    currentVersion,
    latestVersion,
    assets,
  };
}

async function downloadAssetText(url: string): Promise<string> {
  const res = await requestUrl({ url, method: 'GET' });
  if (res.status < 200 || res.status >= 300 || typeof res.text !== 'string' || res.text.length === 0) {
    throw new Error(`Download failed (${res.status})`);
  }
  return res.text;
}

/**
 * Downloads release assets, validates manifest, writes to plugin folder, and reloads plugin.
 * Returns true if plugin was hot-reloaded automatically.
 */
export async function installUpdate(plugin: Plugin, release: UpdateCheckResult): Promise<boolean> {
  const mainJsAsset = release.assets.find(a => a.name === 'main.js');
  const manifestAsset = release.assets.find(a => a.name === 'manifest.json');
  const stylesAsset = release.assets.find(a => a.name === 'styles.css');

  if (!mainJsAsset || !manifestAsset) {
    throw new Error('Release is missing required files');
  }

  const [manifestText, mainJsText, stylesText] = await Promise.all([
    downloadAssetText(manifestAsset.browser_download_url),
    downloadAssetText(mainJsAsset.browser_download_url),
    stylesAsset ? downloadAssetText(stylesAsset.browser_download_url) : Promise.resolve(null),
  ]);

  const remoteManifest = JSON.parse(manifestText) as Partial<PluginManifest>;
  if (remoteManifest.id !== plugin.manifest.id || typeof remoteManifest.version !== 'string') {
    throw new Error('Invalid manifest in release');
  }
  if (typeof remoteManifest.minAppVersion === 'string' && !requireApiVersion(remoteManifest.minAppVersion)) {
    throw new Error(`Requires app version ${remoteManifest.minAppVersion} or newer`);
  }

  const pluginDir = plugin.manifest.dir ?? normalizePath(`${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`);
  const adapter = plugin.app.vault.adapter;

  await adapter.write(normalizePath(`${pluginDir}/main.js`), mainJsText);
  await adapter.write(normalizePath(`${pluginDir}/manifest.json`), manifestText);
  if (stylesText !== null) {
    await adapter.write(normalizePath(`${pluginDir}/styles.css`), stylesText);
  }

  plugin.manifest.version = remoteManifest.version;

  const plugins = (plugin.app as App & {
    plugins?: {
      disablePlugin?: (id: string) => Promise<void>;
      enablePlugin?: (id: string) => Promise<void>;
    };
  }).plugins;

  if (typeof plugins?.disablePlugin === 'function' && typeof plugins?.enablePlugin === 'function') {
    await plugins.disablePlugin(plugin.manifest.id);
    await plugins.enablePlugin(plugin.manifest.id);
    return true;
  }

  return false;
}
