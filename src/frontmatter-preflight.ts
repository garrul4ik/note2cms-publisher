import { App, TFile, parseYaml, stringifyYaml } from 'obsidian';

export type FrontmatterIssueSeverity = 'warning' | 'error';

export interface FrontmatterIssue {
  code: string;
  message: string;
  severity: FrontmatterIssueSeverity;
}

export interface PreflightResult {
  normalizedMarkdown: string;
  issues: FrontmatterIssue[];
  title: string;
  canPublish: boolean;
}

interface NormalizedCoreFields {
  title: string;
  tags?: string[];
  date?: string;
  slug?: string;
  excerpt?: string;
}

interface FrontmatterParseResult {
  frontmatterText: string | null;
  body: string;
  hadFrontmatter: boolean;
}

interface PreflightContext {
  app: App;
  markdown: string;
  sourcePath?: string;
  includeFrontmatter: boolean;
}

function titleFromPath(path?: string): string {
  if (!path) return 'Untitled';
  const parts = path.split('/');
  const fileName = parts[parts.length - 1] || 'Untitled';
  return fileName.replace(/\.md$/i, '') || 'Untitled';
}

function toUnixLines(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function parseDocument(markdown: string): FrontmatterParseResult {
  const normalized = toUnixLines(markdown);
  let source = normalized;

  if (source.startsWith('\uFEFF')) {
    source = source.slice(1);
  }

  if (!source.startsWith('---\n')) {
    return {
      frontmatterText: null,
      body: source,
      hadFrontmatter: false,
    };
  }

  const endMarker = source.indexOf('\n---', 4);
  if (endMarker === -1) {
    const rest = source.slice(4);
    const splitIndex = rest.search(/\n\s*\n/);
    if (splitIndex !== -1) {
      const fmText = rest.slice(0, splitIndex).trim();
      const body = rest.slice(splitIndex).replace(/^\n+/, '');
      return {
        frontmatterText: fmText || null,
        body,
        hadFrontmatter: true,
      };
    }
    return {
      frontmatterText: null,
      body: rest,
      hadFrontmatter: true,
    };
  }

  const fmText = source.slice(4, endMarker).trim();
  const body = source.slice(endMarker + 4).replace(/^\n/, '');
  return {
    frontmatterText: fmText,
    body,
    hadFrontmatter: true,
  };
}

function parseLooseFrontmatter(frontmatterText: string): { data: Record<string, unknown>; recovered: boolean } {
  const data: Record<string, unknown> = {};
  let recovered = false;

  const lines = frontmatterText.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const colonMatch = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)$/);
    if (colonMatch) {
      const key = colonMatch[1];
      const value = colonMatch[2].trim();
      data[key] = value.replace(/^['"]|['"]$/g, '');
      continue;
    }

    const spacedMatch = line.match(/^([A-Za-z0-9_-]+)\s+(.+)$/);
    if (spacedMatch) {
      const key = spacedMatch[1];
      const value = spacedMatch[2].trim();
      data[key] = value.replace(/^['"]|['"]$/g, '');
      recovered = true;
    }
  }

  return { data, recovered };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTags(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;

  if (typeof value === 'string') {
    const fromInlineArray = value.match(/^\[(.*)\]$/);
    const base = fromInlineArray ? fromInlineArray[1] : value;
    const tags = base
      .split(',')
      .map((tag) => tag.trim().replace(/^['"]|['"]$/g, ''))
      .filter((tag) => tag.length > 0);
    return tags.length ? tags : undefined;
  }

  if (Array.isArray(value)) {
    const tags = value
      .map((tag) => (typeof tag === 'string' ? tag.trim() : String(tag).trim()))
      .filter((tag) => tag.length > 0);
    return tags.length ? tags : undefined;
  }

  return undefined;
}

function readFileFrontmatter(app: App, sourcePath?: string): Record<string, unknown> | null {
  if (!sourcePath) return null;
  const file = app.vault.getAbstractFileByPath(sourcePath);
  if (!(file instanceof TFile)) return null;
  const cache = app.metadataCache.getFileCache(file);
  return asRecord(cache?.frontmatter ?? null);
}

function normalizeCoreFields(
  parsedFrontmatter: Record<string, unknown> | null,
  cacheFrontmatter: Record<string, unknown> | null,
  sourcePath?: string,
): { fields: NormalizedCoreFields; issues: FrontmatterIssue[] } {
  const issues: FrontmatterIssue[] = [];
  const fromPath = titleFromPath(sourcePath);

  const title =
    normalizeString(parsedFrontmatter?.title) ??
    normalizeString(cacheFrontmatter?.title) ??
    fromPath;

  const fields: NormalizedCoreFields = { title };

  const rawTags = parsedFrontmatter?.tags ?? cacheFrontmatter?.tags;
  const normalizedTags = normalizeTags(rawTags);
  if (rawTags !== undefined && normalizedTags === undefined) {
    issues.push({
      code: 'tags-invalid',
      message: 'Tags were invalid and were dropped.',
      severity: 'warning',
    });
  }
  if (normalizedTags) {
    fields.tags = normalizedTags;
    if (typeof rawTags === 'string') {
      issues.push({
        code: 'tags-string',
        message: 'Tags were converted from string to list.',
        severity: 'warning',
      });
    }
  }

  const dateValue = normalizeString(parsedFrontmatter?.date) ?? normalizeString(cacheFrontmatter?.date);
  if (dateValue) {
    fields.date = dateValue;
  }

  const slugValue = normalizeString(parsedFrontmatter?.slug) ?? normalizeString(cacheFrontmatter?.slug);
  if (slugValue) {
    fields.slug = slugValue;
  }

  const excerptValue = normalizeString(parsedFrontmatter?.excerpt) ?? normalizeString(cacheFrontmatter?.excerpt);
  if (excerptValue) {
    fields.excerpt = excerptValue;
  }

  return { fields, issues };
}

function buildNormalizedFrontmatter(
  parsedFrontmatter: Record<string, unknown> | null,
  normalized: NormalizedCoreFields,
  includeFrontmatter: boolean,
): Record<string, unknown> {
  if (!includeFrontmatter) {
    const minimal: Record<string, unknown> = { title: normalized.title };
    if (normalized.tags) minimal.tags = normalized.tags;
    if (normalized.date) minimal.date = normalized.date;
    if (normalized.slug) minimal.slug = normalized.slug;
    if (normalized.excerpt) minimal.excerpt = normalized.excerpt;
    return minimal;
  }

  const merged = parsedFrontmatter ? { ...parsedFrontmatter } : {};
  merged.title = normalized.title;

  if (normalized.tags) merged.tags = normalized.tags;
  if (normalized.date) merged.date = normalized.date;
  if (normalized.slug) merged.slug = normalized.slug;
  if (normalized.excerpt) merged.excerpt = normalized.excerpt;

  return merged;
}

function toMarkdown(frontmatterData: Record<string, unknown>, body: string): string {
  const yaml = stringifyYaml(frontmatterData).trimEnd();
  const normalizedBody = body.replace(/^\n+/, '');
  return `---\n${yaml}\n---\n${normalizedBody}`;
}

export function runFrontmatterPreflight(ctx: PreflightContext): PreflightResult {
  const issues: FrontmatterIssue[] = [];
  const parsedDocument = parseDocument(ctx.markdown);

  let parsedFrontmatter: Record<string, unknown> | null = null;
  if (parsedDocument.frontmatterText) {
    try {
      parsedFrontmatter = asRecord(parseYaml(parsedDocument.frontmatterText));
      if (!parsedFrontmatter) {
        issues.push({
          code: 'frontmatter-not-object',
          message: 'Frontmatter was not an object and was rebuilt.',
          severity: 'warning',
        });
      }
    } catch {
      const recovered = parseLooseFrontmatter(parsedDocument.frontmatterText);
      if (Object.keys(recovered.data).length > 0) {
        parsedFrontmatter = recovered.data;
        issues.push({
          code: 'frontmatter-parse-recovered',
          message: recovered.recovered
            ? 'Frontmatter parse failed and was recovered from loose key-value lines.'
            : 'Frontmatter parse failed and was partially recovered.',
          severity: 'warning',
        });
      } else {
        issues.push({
          code: 'frontmatter-parse-failed',
          message: 'Frontmatter parse failed and was rebuilt.',
          severity: 'warning',
        });
        parsedFrontmatter = null;
      }
    }
  } else if (parsedDocument.hadFrontmatter) {
    issues.push({
      code: 'frontmatter-malformed',
      message: 'Frontmatter block was malformed and was rebuilt.',
      severity: 'warning',
    });
  } else {
    issues.push({
      code: 'frontmatter-missing',
      message: 'Frontmatter was missing and was added.',
      severity: 'warning',
    });
  }

  const cacheFrontmatter = readFileFrontmatter(ctx.app, ctx.sourcePath);
  const normalized = normalizeCoreFields(parsedFrontmatter, cacheFrontmatter, ctx.sourcePath);
  issues.push(...normalized.issues);

  const normalizedFrontmatter = buildNormalizedFrontmatter(
    parsedFrontmatter,
    normalized.fields,
    ctx.includeFrontmatter,
  );

  const normalizedMarkdown = toMarkdown(normalizedFrontmatter, parsedDocument.body);
  const canPublish = normalized.fields.title.trim().length > 0;

  if (!canPublish) {
    issues.push({
      code: 'title-missing',
      message: 'Title is required to publish.',
      severity: 'error',
    });
  }

  return {
    normalizedMarkdown,
    issues,
    title: normalized.fields.title,
    canPublish,
  };
}
