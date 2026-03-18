import { TFile, App, Platform } from 'obsidian';

export function isMobileDevice(): boolean {
  return Platform.isMobile;
}

export function isWiFiConnected(): boolean {
  const conn = (navigator as Navigator & { connection?: { type?: string } }).connection;
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
