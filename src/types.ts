export type CellLanguage = 'python' | 'sql' | 'markdown' | 'scala' | 'r';

export interface ParsedCell {
  /** Cell content without Fabric section markers or markdown # prefixes */
  source: string;
  cellKind: 'code' | 'markup';
  languageId: CellLanguage;
  /** Per-cell Fabric METADATA block (language, language_group, tags, ...) */
  metadata: Record<string, unknown>;
  startLine: number;
  endLine: number;
}

export interface ParsedNotebook {
  cells: ParsedCell[];
  /** Notebook-level METADATA block (kernel_info, dependencies, ...) */
  notebookMetadata: Record<string, unknown>;
  hasFabricHeader: boolean;
}

export const SECTION_MARKER_REGEX = /^# (METADATA|CELL|MARKDOWN|PARAMETERS) \*{4,}\s*$/;

export const META_LINE_PREFIX = '# META';
