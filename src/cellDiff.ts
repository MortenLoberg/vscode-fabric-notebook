import { ParsedCell } from './types';

export interface DisplayCell {
  source: string;
  cellKind: 'code' | 'markup';
  languageId: string;
}

export type DiffOperation =
  | { type: 'keep'; oldIndex: number; newIndex: number }
  | { type: 'modify'; oldIndex: number; newIndex: number; newSource: string }
  | { type: 'insert'; atIndex: number; newIndex: number }
  | { type: 'delete'; oldIndex: number };

export interface CellDiffResult {
  operations: DiffOperation[];
}

function cellFingerprint(cell: DisplayCell): string {
  return `${cell.cellKind}:${cell.languageId}:${cell.source}`;
}

function lcs(oldCells: DisplayCell[], newCells: DisplayCell[]): [number, number][] {
  const n = oldCells.length;
  const m = newCells.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0) as number[]);

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (cellFingerprint(oldCells[i - 1]!) === cellFingerprint(newCells[j - 1]!)) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  const pairs: [number, number][] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (cellFingerprint(oldCells[i - 1]!) === cellFingerprint(newCells[j - 1]!)) {
      pairs.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1]![j]! > dp[i]![j - 1]!) {
      i--;
    } else {
      j--;
    }
  }

  pairs.reverse();
  return pairs;
}

export function computeCellDiff(oldCells: DisplayCell[], newCells: DisplayCell[]): CellDiffResult {
  const matched = lcs(oldCells, newCells);
  const operations: DiffOperation[] = [];
  const matchedOld = new Set(matched.map(([o]) => o));
  const matchedNew = new Set(matched.map(([, n]) => n));

  const unmatchedOld: number[] = [];
  for (let i = 0; i < oldCells.length; i++) {
    if (!matchedOld.has(i)) {
      unmatchedOld.push(i);
    }
  }
  const unmatchedNew: number[] = [];
  for (let j = 0; j < newCells.length; j++) {
    if (!matchedNew.has(j)) {
      unmatchedNew.push(j);
    }
  }

  const pairedAsModify = new Map<number, number>();
  const pairedNewAsModify = new Set<number>();

  let ui = 0;
  let uj = 0;
  while (ui < unmatchedOld.length && uj < unmatchedNew.length) {
    const oi = unmatchedOld[ui]!;
    const nj = unmatchedNew[uj]!;
    const oldCell = oldCells[oi]!;
    const newCell = newCells[nj]!;
    if (oldCell.cellKind === newCell.cellKind && oldCell.languageId === newCell.languageId) {
      pairedAsModify.set(oi, nj);
      pairedNewAsModify.add(nj);
      ui++;
      uj++;
    } else if (oi <= nj) {
      ui++;
    } else {
      uj++;
    }
  }

  let oldIdx = 0;
  let newIdx = 0;
  let matchIdx = 0;

  while (oldIdx < oldCells.length || newIdx < newCells.length) {
    if (
      matchIdx < matched.length &&
      matched[matchIdx]![0] === oldIdx &&
      matched[matchIdx]![1] === newIdx
    ) {
      operations.push({ type: 'keep', oldIndex: oldIdx, newIndex: newIdx });
      oldIdx++;
      newIdx++;
      matchIdx++;
      continue;
    }

    const nextMatchOld = matchIdx < matched.length ? matched[matchIdx]![0] : oldCells.length;
    const nextMatchNew = matchIdx < matched.length ? matched[matchIdx]![1] : newCells.length;

    while (oldIdx < nextMatchOld) {
      if (pairedAsModify.has(oldIdx)) {
        const pairedNewIdx = pairedAsModify.get(oldIdx)!;
        while (newIdx < pairedNewIdx) {
          if (!pairedNewAsModify.has(newIdx) && !matchedNew.has(newIdx)) {
            operations.push({ type: 'insert', atIndex: oldIdx, newIndex: newIdx });
          }
          newIdx++;
        }
        operations.push({
          type: 'modify',
          oldIndex: oldIdx,
          newIndex: pairedNewIdx,
          newSource: newCells[pairedNewIdx]!.source,
        });
        newIdx = pairedNewIdx + 1;
      } else {
        operations.push({ type: 'delete', oldIndex: oldIdx });
      }
      oldIdx++;
    }

    while (newIdx < nextMatchNew) {
      if (!pairedNewAsModify.has(newIdx) && !matchedNew.has(newIdx)) {
        operations.push({ type: 'insert', atIndex: oldIdx, newIndex: newIdx });
      }
      newIdx++;
    }
  }

  return { operations };
}

export function cellToDisplayFormat(cell: ParsedCell): DisplayCell {
  return {
    source: cell.source,
    cellKind: cell.cellKind,
    languageId: cell.languageId,
  };
}
