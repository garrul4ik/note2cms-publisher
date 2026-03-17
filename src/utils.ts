import { TFile, App } from 'obsidian';

export function isMobileDevice(): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

export function isWiFiConnected(): boolean {
  const conn = (navigator as any).connection;
  if (!conn) return true;
  return conn.type !== 'cellular';
}

export function hasPublishTag(file: TFile, app: App, tagName: string): boolean {
  const cache = app.metadataCache.getFileCache(file);
  if (!cache?.tags) return false;
  return cache.tags.some(tag => tag.tag === `#${tagName}` || tag.tag === tagName);
}

export function isInPublishFolder(filePath: string, folder: string): boolean {
  if (!folder) return false;
  const normalized = folder.replace(/^\/+|\/+$/g, '');
  return filePath === normalized || filePath.startsWith(`${normalized}/`);
}
