import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  isFabricNotebook,
  isNotebookContentFile,
  parseNotebook,
  serializeNotebook,
} from './parser';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf8');
}

function comparable(notebook: ReturnType<typeof parseNotebook>) {
  return {
    notebookMetadata: notebook.notebookMetadata,
    cells: notebook.cells.map(cell => ({
      source: cell.source,
      cellKind: cell.cellKind,
      languageId: cell.languageId,
      metadata: cell.metadata,
    })),
  };
}

describe('isFabricNotebook', () => {
  it('detects the Fabric header', () => {
    expect(isFabricNotebook('# Fabric notebook source\n')).toBe(true);
  });

  it('detects notebook-content file names', () => {
    expect(isNotebookContentFile('MyNotebook.Notebook/notebook-content.py')).toBe(true);
    expect(isFabricNotebook('print(1)\n', 'notebook-content.sql')).toBe(true);
  });

  it('rejects ordinary python files', () => {
    expect(isFabricNotebook('print(1)\n', 'script.py')).toBe(false);
  });
});

describe('parseNotebook', () => {
  it('parses notebook metadata, markdown, and code cells', () => {
    const parsed = parseNotebook(loadFixture('notebook-content.py'), 'notebook-content.py');

    expect(parsed.hasFabricHeader).toBe(true);
    expect(parsed.notebookMetadata).toMatchObject({
      kernel_info: { name: 'synapse_pyspark' },
    });
    expect(parsed.cells).toHaveLength(3);
    expect(parsed.cells[0]).toMatchObject({
      cellKind: 'markup',
      languageId: 'markdown',
      source: '# Sales notebook\nWelcome to Fabric.\n\nThis is a second paragraph.',
    });
    expect(parsed.cells[1]).toMatchObject({
      cellKind: 'code',
      languageId: 'python',
      source: 'print("hello")',
      metadata: {
        language: 'python',
        language_group: 'synapse_pyspark',
      },
    });
    expect(parsed.cells[2]?.source).toContain('spark.sql');
  });

  it('uses the file extension for SQL notebooks', () => {
    const parsed = parseNotebook(loadFixture('notebook-content.sql'), 'notebook-content.sql');
    expect(parsed.cells[1]).toMatchObject({
      cellKind: 'code',
      languageId: 'sql',
      source: 'SELECT 1 AS id',
    });
  });

  it('parses PARAMETERS sections as tagged code cells', () => {
    const source = `# Fabric notebook source

# PARAMETERS ********************

batch_size = 100

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }
`;
    const parsed = parseNotebook(source, 'notebook-content.py');
    expect(parsed.cells[0]).toMatchObject({
      cellKind: 'code',
      source: 'batch_size = 100',
      metadata: {
        tags: ['parameters'],
        language: 'python',
        language_group: 'synapse_pyspark',
      },
    });
  });
});

describe('serializeNotebook', () => {
  it('round-trips parsed structure for the python fixture', () => {
    const original = parseNotebook(loadFixture('notebook-content.py'), 'notebook-content.py');
    const again = parseNotebook(serializeNotebook(original), 'notebook-content.py');
    expect(comparable(again)).toEqual(comparable(original));
  });

  it('is stable after a second serialize', () => {
    const original = parseNotebook(loadFixture('notebook-content.py'), 'notebook-content.py');
    const first = serializeNotebook(original);
    const second = serializeNotebook(parseNotebook(first, 'notebook-content.py'));
    expect(second).toBe(first);
  });

  it('round-trips the SQL fixture', () => {
    const original = parseNotebook(loadFixture('notebook-content.sql'), 'notebook-content.sql');
    const again = parseNotebook(serializeNotebook(original), 'notebook-content.sql');
    expect(comparable(again)).toEqual(comparable(original));
  });

  it('writes markdown with # prefixes and keeps blank lines', () => {
    const serialized = serializeNotebook({
      hasFabricHeader: true,
      notebookMetadata: {},
      cells: [
        {
          source: '# Title\n\nBody',
          cellKind: 'markup',
          languageId: 'markdown',
          metadata: {},
          startLine: 0,
          endLine: 1,
        },
      ],
    });

    expect(serialized).toContain('# MARKDOWN ********************');
    expect(serialized).toContain('# # Title');
    expect(serialized).toContain('# ');
    expect(serialized).toContain('# Body');
  });
});
