import {
  workspace,
  NotebookDocument,
  NotebookEdit,
  NotebookRange,
  NotebookCellData,
  NotebookCellKind,
  WorkspaceEdit,
  Range,
  Uri,
  window,
  commands,
} from 'vscode';
import { parseNotebook } from './parser';
import { ParsedCell } from './types';
import { FabricNotebookFileSystem } from './filesystem';
import { SCHEME } from './constants';
import { computeCellDiff, cellToDisplayFormat, DisplayCell, DiffOperation } from './cellDiff';

function extractCellsFromNotebook(notebook: NotebookDocument): DisplayCell[] {
  const cells: DisplayCell[] = [];
  for (let i = 0; i < notebook.cellCount; i++) {
    const cell = notebook.cellAt(i);
    cells.push({
      source: cell.document.getText(),
      cellKind: cell.kind === NotebookCellKind.Code ? 'code' : 'markup',
      languageId: cell.document.languageId,
    });
  }
  return cells;
}

function cellToNotebookCellData(cell: ParsedCell): NotebookCellData {
  const display = cellToDisplayFormat(cell);
  const kind = display.cellKind === 'code' ? NotebookCellKind.Code : NotebookCellKind.Markup;
  const languageId = cell.cellKind === 'markup' ? 'markdown' : cell.languageId;
  return new NotebookCellData(kind, display.source, languageId);
}

async function applyDiff(
  notebook: NotebookDocument,
  operations: DiffOperation[],
  newParsedCells: ParsedCell[]
): Promise<boolean> {
  const edit = new WorkspaceEdit();
  const notebookEdits: NotebookEdit[] = [];
  const reversed = [...operations].reverse();

  for (const op of reversed) {
    switch (op.type) {
      case 'keep':
        break;
      case 'modify': {
        const cell = notebook.cellAt(op.oldIndex);
        const lastLine = cell.document.lineCount - 1;
        const lastChar = cell.document.lineAt(lastLine).text.length;
        edit.replace(cell.document.uri, new Range(0, 0, lastLine, lastChar), op.newSource);
        break;
      }
      case 'insert': {
        notebookEdits.push(
          NotebookEdit.insertCells(op.atIndex, [cellToNotebookCellData(newParsedCells[op.newIndex]!)])
        );
        break;
      }
      case 'delete': {
        notebookEdits.push(NotebookEdit.deleteCells(new NotebookRange(op.oldIndex, op.oldIndex + 1)));
        break;
      }
    }
  }

  if (notebookEdits.length > 0) {
    edit.set(notebook.uri, notebookEdits);
  }

  return workspace.applyEdit(edit);
}

/**
 * Keeps an open notebook view in sync with external edits to the Fabric source file,
 * preserving cell outputs for unchanged cells.
 */
export class NotebookSyncManager {
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly DEBOUNCE_MS = 300;
  private log: (...args: unknown[]) => void;

  constructor(
    private filesystem: FabricNotebookFileSystem,
    devMode = false
  ) {
    this.log = devMode
      ? (...args: unknown[]) => console.log('[DEV] [NotebookSync]', ...args)
      : () => {};
  }

  register(notebook: NotebookDocument): void {
    if (notebook.uri.scheme !== SCHEME) {
      return;
    }

    this.log('register', notebook.uri.toString());
    this.filesystem.setChangeHandler(notebook.uri, uri => this.onFileChanged(uri));
  }

  unregister(notebook: NotebookDocument): void {
    if (notebook.uri.scheme !== SCHEME) {
      return;
    }

    const key = notebook.uri.toString();
    const timer = this.debounceTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(key);
    }

    this.log('unregister', notebook.uri.toString());
    this.filesystem.removeChangeHandler(notebook.uri);
  }

  private onFileChanged(uri: Uri): void {
    const key = uri.toString();
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key);
        void this.syncNotebook(uri);
      }, this.DEBOUNCE_MS)
    );
  }

  private async syncNotebook(uri: Uri): Promise<void> {
    const notebook = workspace.notebookDocuments.find(nb => nb.uri.toString() === uri.toString());
    if (!notebook) {
      this.log('sync skipped, notebook not found for', uri.toString());
      return;
    }

    this.log('syncing', uri.toString());

    if (notebook.isDirty) {
      const choice = await window.showWarningMessage(
        'The Fabric notebook file changed on disk, but this notebook has unsaved changes.',
        'Reload from disk',
        'Keep my changes'
      );
      if (choice === 'Reload from disk') {
        await commands.executeCommand('workbench.action.files.revert');
      }
      return;
    }

    const realUri = Uri.file(uri.path);
    const sourceBytes = await workspace.fs.readFile(realUri);
    const source = new TextDecoder().decode(sourceBytes);
    const parsed = parseNotebook(source, realUri.fsPath);
    const oldCells = extractCellsFromNotebook(notebook);
    const newCells = parsed.cells.map(cellToDisplayFormat);
    const diff = computeCellDiff(oldCells, newCells);

    const hasChanges = diff.operations.some(op => op.type !== 'keep');
    if (hasChanges) {
      const summary = diff.operations.reduce(
        (acc, op) => {
          acc[op.type] = (acc[op.type] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );
      this.log('applying diff:', summary);
      await applyDiff(notebook, diff.operations, parsed.cells);
    } else {
      this.log('no changes detected');
    }
  }

  dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }
}
