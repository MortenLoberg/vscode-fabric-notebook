import { FABRIC_HEADER, NOTEBOOK_CONTENT_FILENAME } from './constants';
import {
  CellLanguage,
  META_LINE_PREFIX,
  ParsedCell,
  ParsedNotebook,
  SECTION_MARKER_REGEX,
} from './types';

type SectionKind = 'METADATA' | 'CELL' | 'MARKDOWN' | 'PARAMETERS';

interface RawSection {
  kind: SectionKind;
  startLine: number;
  lines: string[];
}

export function isNotebookContentFile(fileName: string): boolean {
  const base = fileName.split(/[/\\]/).pop() ?? '';
  return NOTEBOOK_CONTENT_FILENAME.test(base);
}

export function isSupportedNotebookFile(fileName: string): boolean {
  return /\.(py|sql|scala|r)$/i.test(fileName);
}

export function isFabricNotebook(content: string, fileName?: string): boolean {
  const normalized = stripBom(content).replace(/\r\n/g, '\n').trimStart();
  if (normalized.startsWith(FABRIC_HEADER)) {
    return true;
  }
  return fileName !== undefined && isNotebookContentFile(fileName);
}

export function languageFromFileName(fileName?: string): Exclude<CellLanguage, 'markdown'> {
  const ext = fileName?.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'sql':
      return 'sql';
    case 'scala':
      return 'scala';
    case 'r':
      return 'r';
    default:
      return 'python';
  }
}

export function parseNotebook(content: string, fileName?: string): ParsedNotebook {
  const text = stripBom(content).replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const defaultLanguage = languageFromFileName(fileName);

  let index = 0;
  while (index < lines.length && lines[index]!.trim() === '') {
    index++;
  }

  let hasFabricHeader = false;
  if (lines[index] === FABRIC_HEADER) {
    hasFabricHeader = true;
    index++;
  }

  const sections = collectSections(lines, index);
  return buildNotebook(sections, defaultLanguage, hasFabricHeader);
}

export function serializeNotebook(notebook: ParsedNotebook): string {
  const parts: string[] = [FABRIC_HEADER, ''];

  if (hasKeys(notebook.notebookMetadata)) {
    parts.push(serializeSectionMarker('METADATA'), '', serializeMetaBlock(notebook.notebookMetadata), '');
  }

  for (const cell of notebook.cells) {
    if (cell.cellKind === 'markup') {
      parts.push(serializeSectionMarker('MARKDOWN'), '', serializeMarkdownSource(cell.source), '');
    } else {
      parts.push(serializeSectionMarker('CELL'), '', cell.source, '');
    }

    const metadata = cellMetadataForSerialize(cell);
    if (hasKeys(metadata)) {
      parts.push(serializeSectionMarker('METADATA'), '', serializeMetaBlock(metadata), '');
    }
  }

  return `${parts.join('\n').replace(/\n+$/, '')}\n`;
}

function collectSections(lines: string[], startIndex: number): RawSection[] {
  const sections: RawSection[] = [];
  let current: RawSection | undefined;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i]!;
    const match = SECTION_MARKER_REGEX.exec(line);
    if (match) {
      if (current) {
        sections.push(current);
      }
      current = {
        kind: match[1] as SectionKind,
        startLine: i,
        lines: [],
      };
      continue;
    }
    current?.lines.push(line);
  }

  if (current) {
    sections.push(current);
  }

  return sections;
}

function buildNotebook(
  sections: RawSection[],
  defaultLanguage: Exclude<CellLanguage, 'markdown'>,
  hasFabricHeader: boolean
): ParsedNotebook {
  let notebookMetadata: Record<string, unknown> = {};
  const cells: ParsedCell[] = [];
  let pending: ParsedCell | undefined;
  let seenCell = false;

  const flushPending = (): void => {
    if (pending) {
      cells.push(pending);
      pending = undefined;
    }
  };

  for (const section of sections) {
    if (section.kind === 'METADATA') {
      const metadata = parseMetaBlock(section.lines);
      if (!seenCell && !pending) {
        notebookMetadata = metadata;
        continue;
      }
      if (pending) {
        pending.metadata = mergeMetadata(pending.metadata, metadata);
        applyLanguageFromMetadata(pending, metadata);
        flushPending();
        continue;
      }
      const last = cells[cells.length - 1];
      if (last) {
        last.metadata = mergeMetadata(last.metadata, metadata);
        applyLanguageFromMetadata(last, metadata);
      }
      continue;
    }

    flushPending();
    seenCell = true;

    if (section.kind === 'MARKDOWN') {
      pending = {
        source: parseMarkdownSource(section.lines),
        cellKind: 'markup',
        languageId: 'markdown',
        metadata: {},
        startLine: section.startLine,
        endLine: section.startLine + section.lines.length + 1,
      };
      continue;
    }

    const metadata: Record<string, unknown> =
      section.kind === 'PARAMETERS' ? { tags: ['parameters'] } : {};

    pending = {
      source: trimBlankLines(section.lines).join('\n'),
      cellKind: 'code',
      languageId: defaultLanguage,
      metadata,
      startLine: section.startLine,
      endLine: section.startLine + section.lines.length + 1,
    };
  }

  flushPending();

  return {
    cells,
    notebookMetadata,
    hasFabricHeader,
  };
}

function parseMetaBlock(lines: string[]): Record<string, unknown> {
  const jsonLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith(`${META_LINE_PREFIX} `)) {
      jsonLines.push(line.slice(META_LINE_PREFIX.length + 1));
    } else if (line.startsWith(META_LINE_PREFIX)) {
      jsonLines.push(line.slice(META_LINE_PREFIX.length).replace(/^ /, ''));
    }
  }

  const json = jsonLines.join('\n').trim();
  if (!json) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function serializeMetaBlock(metadata: Record<string, unknown>): string {
  return JSON.stringify(metadata, null, 2)
    .split('\n')
    .map(line => `${META_LINE_PREFIX} ${line}`)
    .join('\n');
}

function serializeSectionMarker(kind: SectionKind): string {
  return `# ${kind} ********************`;
}

function parseMarkdownSource(lines: string[]): string {
  return trimBlankLines(lines)
    .map(line => {
      if (line.startsWith('# ')) {
        return line.slice(2);
      }
      if (line === '#') {
        return '';
      }
      return line;
    })
    .join('\n');
}

function serializeMarkdownSource(source: string): string {
  if (source === '') {
    return '';
  }
  return source.split('\n').map(line => `# ${line}`).join('\n');
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === '') {
    start++;
  }
  while (end > start && lines[end - 1]!.trim() === '') {
    end--;
  }
  return lines.slice(start, end);
}

function applyLanguageFromMetadata(cell: ParsedCell, metadata: Record<string, unknown>): void {
  if (cell.cellKind !== 'code') {
    return;
  }
  const language = metadata['language'];
  if (typeof language === 'string') {
    const mapped = mapLanguage(language);
    if (mapped) {
      cell.languageId = mapped;
    }
  }
}

function mapLanguage(language: string): Exclude<CellLanguage, 'markdown'> | undefined {
  switch (language.toLowerCase()) {
    case 'python':
    case 'pyspark':
      return 'python';
    case 'sql':
    case 'sparksql':
    case 'spark_sql':
      return 'sql';
    case 'scala':
      return 'scala';
    case 'r':
    case 'sparkr':
      return 'r';
    default:
      return undefined;
  }
}

function cellMetadataForSerialize(cell: ParsedCell): Record<string, unknown> {
  if (cell.cellKind === 'markup') {
    return { ...cell.metadata };
  }

  const metadata = { ...cell.metadata };
  if (typeof metadata['language'] !== 'string') {
    metadata['language'] = cell.languageId;
  }
  if (typeof metadata['language_group'] !== 'string') {
    metadata['language_group'] = defaultLanguageGroup(cell.languageId);
  }
  return metadata;
}

function defaultLanguageGroup(languageId: CellLanguage): string {
  switch (languageId) {
    case 'sql':
      return 'synapse_sql';
    case 'scala':
      return 'synapse_spark';
    case 'r':
      return 'synapse_sparkr';
    default:
      return 'synapse_pyspark';
  }
}

function mergeMetadata(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...existing, ...incoming };
  const existingTags = asUnknownArray(existing['tags']);
  const incomingTags = asUnknownArray(incoming['tags']);
  if (existingTags.length > 0 || incomingTags.length > 0) {
    merged['tags'] = uniqueTags([...existingTags, ...incomingTags]);
  }
  return merged;
}

function asUnknownArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(item => item as unknown);
}

function uniqueTags(tags: unknown[]): unknown[] {
  const seen = new Set<string>();
  const result: unknown[] = [];
  for (const tag of tags) {
    const key = typeof tag === 'string' ? tag : JSON.stringify(tag);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(tag);
    }
  }
  return result;
}

function hasKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).length > 0;
}

function stripBom(content: string): string {
  return content.replace(/^\uFEFF/, '');
}
