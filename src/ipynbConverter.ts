import { parseNotebook, serializeNotebook } from './parser';
import { CellLanguage, ParsedCell, ParsedNotebook } from './types';

interface CellMetadata {
  vscode?: {
    languageId?: string;
  };
  fabric?: Record<string, unknown>;
  [key: string]: unknown;
}

interface IpynbCell {
  cell_type: 'code' | 'markdown' | 'raw';
  source: string[];
  metadata: CellMetadata;
  execution_count?: number | null;
  outputs?: unknown[];
}

interface IpynbNotebook {
  cells: IpynbCell[];
  metadata: {
    kernelspec?: {
      display_name: string;
      language: string;
      name: string;
    };
    language_info?: {
      name: string;
      version?: string;
    };
    fabric_notebook?: {
      notebookMetadata: Record<string, unknown>;
      hasFabricHeader: boolean;
    };
    [key: string]: unknown;
  };
  nbformat: number;
  nbformat_minor: number;
}

export function sourceToIpynb(source: string, fileName?: string): string {
  const parsed = parseNotebook(source, fileName);
  const defaultLanguage = defaultNotebookLanguage(parsed);

  const ipynb: IpynbNotebook = {
    cells: parsed.cells.map(cell => toIpynbCell(cell)),
    metadata: {
      ...kernelspecForLanguage(defaultLanguage),
      fabric_notebook: {
        notebookMetadata: parsed.notebookMetadata,
        hasFabricHeader: parsed.hasFabricHeader,
      },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };

  return JSON.stringify(ipynb, null, 1);
}

export function ipynbToSource(ipynbContent: string, fileName?: string): string {
  const ipynb = JSON.parse(ipynbContent) as IpynbNotebook;
  const fabric = ipynb.metadata.fabric_notebook;
  const fallbackLanguage = languageFromKernelspec(ipynb) ?? languageFromFileNameSafe(fileName);

  const cells: ParsedCell[] = ipynb.cells.map((cell, index) => {
    const source = joinLines(cell.source);

    if (cell.cell_type === 'markdown') {
      return {
        source,
        cellKind: 'markup' as const,
        languageId: 'markdown' as const,
        metadata: cell.metadata.fabric ?? {},
        startLine: index,
        endLine: index + 1,
      };
    }

    const language = resolveCodeLanguage(cell, fallbackLanguage);
    return {
      source,
      cellKind: 'code' as const,
      languageId: language,
      metadata: cell.metadata.fabric ?? {},
      startLine: index,
      endLine: index + 1,
    };
  });

  const notebook: ParsedNotebook = {
    cells,
    notebookMetadata: fabric?.notebookMetadata ?? {},
    hasFabricHeader: fabric?.hasFabricHeader ?? true,
  };

  return serializeNotebook(notebook);
}

function toIpynbCell(cell: ParsedCell): IpynbCell {
  const source = splitIntoLines(cell.source);

  if (cell.cellKind === 'markup') {
    return {
      cell_type: 'markdown',
      source,
      metadata: {
        fabric: cell.metadata,
      },
    };
  }

  const metadata: CellMetadata = {
    fabric: cell.metadata,
  };

  if (cell.languageId !== 'python') {
    metadata.vscode = {
      languageId: cell.languageId,
    };
  }

  return {
    cell_type: 'code',
    source,
    metadata,
    execution_count: null,
    outputs: [],
  };
}

function resolveCodeLanguage(
  cell: IpynbCell,
  fallback: Exclude<CellLanguage, 'markdown'>
): Exclude<CellLanguage, 'markdown'> {
  const stored = cell.metadata.fabric?.['language'];
  if (typeof stored === 'string') {
    const mapped = mapStoredLanguage(stored);
    if (mapped) {
      return mapped;
    }
  }

  const vscodeLanguage = cell.metadata.vscode?.languageId;
  if (vscodeLanguage) {
    const mapped = mapStoredLanguage(vscodeLanguage);
    if (mapped) {
      return mapped;
    }
  }

  return fallback;
}

function mapStoredLanguage(language: string): Exclude<CellLanguage, 'markdown'> | undefined {
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

function defaultNotebookLanguage(parsed: ParsedNotebook): Exclude<CellLanguage, 'markdown'> {
  const firstCode = parsed.cells.find(cell => cell.cellKind === 'code');
  if (firstCode && firstCode.languageId !== 'markdown') {
    return firstCode.languageId;
  }
  return 'python';
}

function languageFromKernelspec(ipynb: IpynbNotebook): Exclude<CellLanguage, 'markdown'> | undefined {
  const name = ipynb.metadata.language_info?.name ?? ipynb.metadata.kernelspec?.language;
  return name ? mapStoredLanguage(name) : undefined;
}

function languageFromFileNameSafe(fileName?: string): Exclude<CellLanguage, 'markdown'> {
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

function kernelspecForLanguage(language: Exclude<CellLanguage, 'markdown'>): Pick<
  IpynbNotebook['metadata'],
  'kernelspec' | 'language_info'
> {
  switch (language) {
    case 'sql':
      return {
        kernelspec: {
          display_name: 'SQL',
          language: 'sql',
          name: 'sql',
        },
        language_info: {
          name: 'sql',
        },
      };
    case 'scala':
      return {
        kernelspec: {
          display_name: 'Scala',
          language: 'scala',
          name: 'scala',
        },
        language_info: {
          name: 'scala',
        },
      };
    case 'r':
      return {
        kernelspec: {
          display_name: 'R',
          language: 'r',
          name: 'ir',
        },
        language_info: {
          name: 'r',
        },
      };
    default:
      return {
        kernelspec: {
          display_name: 'Python 3',
          language: 'python',
          name: 'python3',
        },
        language_info: {
          name: 'python',
        },
      };
  }
}

function splitIntoLines(content: string): string[] {
  if (!content) {
    return [];
  }

  const lines = content.split('\n');
  return lines.map((line, i) => {
    if (i < lines.length - 1) {
      return `${line}\n`;
    }
    return line;
  });
}

function joinLines(lines: string | string[]): string {
  if (typeof lines === 'string') {
    return lines.replace(/\r\n/g, '\n');
  }
  return lines.join('').replace(/\r\n/g, '\n');
}
