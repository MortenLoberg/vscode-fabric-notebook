import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ipynbToSource, sourceToIpynb } from './ipynbConverter';
import { parseNotebook } from './parser';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf8');
}

describe('sourceToIpynb / ipynbToSource', () => {
  it('converts Fabric source into notebook cells', () => {
    const ipynb = JSON.parse(sourceToIpynb(loadFixture('notebook-content.py'), 'notebook-content.py')) as {
      cells: Array<{ cell_type: string; source: string[]; metadata: { vscode?: { languageId?: string } } }>;
      metadata: { fabric_notebook?: { notebookMetadata: Record<string, unknown> } };
    };

    expect(ipynb.cells).toHaveLength(3);
    expect(ipynb.cells[0]?.cell_type).toBe('markdown');
    expect(ipynb.cells[1]?.cell_type).toBe('code');
    expect(ipynb.metadata.fabric_notebook?.notebookMetadata).toMatchObject({
      kernel_info: { name: 'synapse_pyspark' },
    });
  });

  it('round-trips through ipynb without writing outputs', () => {
    const source = loadFixture('notebook-content.py');
    const ipynb = JSON.parse(sourceToIpynb(source, 'notebook-content.py')) as {
      cells: Array<{ outputs?: unknown[] }>;
    };
    ipynb.cells[1]!.outputs = [{ output_type: 'stream', name: 'stdout', text: ['hi\n'] }];

    const restored = ipynbToSource(JSON.stringify(ipynb), 'notebook-content.py');
    expect(restored).not.toContain('stdout');
    expect(restored).not.toContain('"outputs"');

    const original = parseNotebook(source, 'notebook-content.py');
    const again = parseNotebook(restored, 'notebook-content.py');
    expect(again.cells.map(cell => cell.source)).toEqual(original.cells.map(cell => cell.source));
    expect(again.notebookMetadata).toEqual(original.notebookMetadata);
  });

  it('preserves SQL language on round-trip', () => {
    const source = loadFixture('notebook-content.sql');
    const restored = ipynbToSource(sourceToIpynb(source, 'notebook-content.sql'), 'notebook-content.sql');
    const parsed = parseNotebook(restored, 'notebook-content.sql');
    expect(parsed.cells[1]?.languageId).toBe('sql');
    expect(parsed.cells[1]?.source).toBe('SELECT 1 AS id');
  });
});
