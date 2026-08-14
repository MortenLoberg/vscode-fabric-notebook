import { describe, expect, it } from 'vitest';
import { cellToDisplayFormat, computeCellDiff, DisplayCell } from './cellDiff';

function cell(source: string, languageId = 'python', cellKind: DisplayCell['cellKind'] = 'code'): DisplayCell {
  return { source, languageId, cellKind };
}

describe('computeCellDiff', () => {
  it('keeps identical cells', () => {
    const cells = [cell('print(1)'), cell('# Title', 'markdown', 'markup')];
    const diff = computeCellDiff(cells, cells);
    expect(diff.operations).toEqual([
      { type: 'keep', oldIndex: 0, newIndex: 0 },
      { type: 'keep', oldIndex: 1, newIndex: 1 },
    ]);
  });

  it('marks content changes as modify', () => {
    const diff = computeCellDiff([cell('print(1)')], [cell('print(2)')]);
    expect(diff.operations).toEqual([
      { type: 'modify', oldIndex: 0, newIndex: 0, newSource: 'print(2)' },
    ]);
  });

  it('inserts and deletes unmatched cells', () => {
    const diff = computeCellDiff(
      [cell('a'), cell('b')],
      [cell('a'), cell('# md', 'markdown', 'markup'), cell('b')]
    );
    expect(diff.operations.map(op => op.type)).toEqual(['keep', 'insert', 'keep']);
  });
});

describe('cellToDisplayFormat', () => {
  it('uses the parsed source as-is', () => {
    expect(
      cellToDisplayFormat({
        source: 'SELECT 1',
        cellKind: 'code',
        languageId: 'sql',
        metadata: {},
        startLine: 0,
        endLine: 1,
      })
    ).toEqual({
      source: 'SELECT 1',
      cellKind: 'code',
      languageId: 'sql',
    });
  });
});
