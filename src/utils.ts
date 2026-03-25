import { TFile, App, Platform } from 'obsidian';

/**
 * Cache for WiFi connection check
 */
let wifiCheckCache: { result: boolean; timestamp: number } | null = null;
const WIFI_CHECK_CACHE_TTL = 5000; // 5 seconds

/**
 * Checks if device is mobile
 */
export function isMobileDevice(): boolean {
  return Platform.isMobile;
}

/**
 * Checks WiFi connection with result caching.
 * Safe default value: false (requires explicit WiFi confirmation).
 */
export function isWiFiConnected(): boolean {
  // Check cache
  if (wifiCheckCache && Date.now() - wifiCheckCache.timestamp < WIFI_CHECK_CACHE_TTL) {
    return wifiCheckCache.result;
  }

  const conn = (navigator as Navigator & { connection?: { type?: string } }).connection;
  
  // Safe default value: false (not WiFi)
  if (!conn || !conn.type) {
    const result = false;
    wifiCheckCache = { result, timestamp: Date.now() };
    return result;
  }
  
  const result = conn.type === 'wifi';
  wifiCheckCache = { result, timestamp: Date.now() };
  return result;
}

/**
 * Checks for publish tag in file.
 * Safe check with input validation.
 */
export function hasPublishTag(file: TFile, app: App, tagName: string): boolean {
  if (!file || !app || !tagName) return false;
  
  // Tag name validation
  const sanitizedTag = tagName.trim().replace(/^#+/, '');
  if (!sanitizedTag || sanitizedTag.length === 0) return false;
  
  const cache = app.metadataCache.getFileCache(file);
  if (!cache?.tags || !Array.isArray(cache.tags)) return false;
  
  return cache.tags.some(tag => {
    if (!tag || typeof tag.tag !== 'string') return false;
    const normalizedTag = tag.tag.replace(/^#+/, '');
    return normalizedTag === sanitizedTag;
  });
}

/**
 * Checks if file is in specified publish folder.
 * Protection against path traversal attacks.
 */
export function isInPublishFolder(filePath: string, folder: string): boolean {
  if (!folder) return false;
  
  // Path normalization and path traversal protection
  const normalizedFolder = folder.replace(/^\/+|\/+$/g, '').replace(/\\/g, '/');
  const normalizedPath = filePath.replace(/\\/g, '/');
  
  // Check for path traversal attempts
  if (normalizedFolder.includes('..') || normalizedPath.includes('..')) {
    return false;
  }
  
  return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
}

/**
 * Converts error to readable message
 */
export function formatError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return 'Unknown error';
  }
}
