import { TFile, App, Platform } from 'obsidian';

/**
 * Кеш для проверки WiFi соединения
 */
let wifiCheckCache: { result: boolean; timestamp: number } | null = null;
const WIFI_CHECK_CACHE_TTL = 5000; // 5 секунд

/**
 * Проверяет, является ли устройство мобильным
 */
export function isMobileDevice(): boolean {
  return Platform.isMobile;
}

/**
 * Проверяет WiFi соединение с кешированием результата.
 * Безопасное значение по умолчанию: false (требует явного подтверждения WiFi).
 */
export function isWiFiConnected(): boolean {
  // Проверка кеша
  if (wifiCheckCache && Date.now() - wifiCheckCache.timestamp < WIFI_CHECK_CACHE_TTL) {
    return wifiCheckCache.result;
  }

  const conn = (navigator as Navigator & { connection?: { type?: string } }).connection;
  
  // Безопасное значение по умолчанию: false (не WiFi)
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
 * Проверяет наличие тега публикации в файле.
 * Безопасная проверка с валидацией входных данных.
 */
export function hasPublishTag(file: TFile, app: App, tagName: string): boolean {
  if (!file || !app || !tagName) return false;
  
  // Валидация имени тега
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
 * Проверяет, находится ли файл в указанной папке публикации.
 * Защита от path traversal атак.
 */
export function isInPublishFolder(filePath: string, folder: string): boolean {
  if (!folder) return false;
  
  // Нормализация путей и защита от path traversal
  const normalizedFolder = folder.replace(/^\/+|\/+$/g, '').replace(/\\/g, '/');
  const normalizedPath = filePath.replace(/\\/g, '/');
  
  // Проверка на попытки path traversal
  if (normalizedFolder.includes('..') || normalizedPath.includes('..')) {
    return false;
  }
  
  return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
}
