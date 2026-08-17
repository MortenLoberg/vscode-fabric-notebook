import {
  FileSystemProvider,
  Uri,
  FileType,
  FileStat,
  FileChangeEvent,
  FileChangeType,
  EventEmitter,
  Disposable,
  NotebookCellKind,
  workspace,
} from 'vscode';
import { sourceToIpynb, ipynbToSource } from './ipynbConverter';
import { computeCellDiff, cellToDisplayFormat } from './cellDiff';
import { parseNotebook } from './parser';

interface IpynbCellForMerge {
  outputs?: unknown[];
  execution_count?: number | null;
  [key: string]: unknown;
}

interface IpynbForMerge {
  cells: IpynbCellForMerge[];
  [key: string]: unknown;
}

/**
 * Virtual filesystem for fabric-notebook:// URIs.
 * Maps virtual notebook URIs to real Fabric source files and converts
 * between Fabric Git source and in-memory ipynb JSON.
 */
export class FabricNotebookFileSystem implements FileSystemProvider {
  private readonly _onDidChangeFile = new EventEmitter<FileChangeEvent[]>();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  private readonly watchers = new Map<string, Disposable>();
  private readonly changeHandlers = new Map<string, (uri: Uri) => void>();
  private log: (...args: unknown[]) => void = () => {};

  private readonly lastWriteTime = new Map<string, number>();
  private readonly WRITE_GRACE_MS = 2000;

  setDevMode(enabled: boolean): void {
    this.log = enabled ? (...args: unknown[]) => console.log('[DEV] [FS]', ...args) : () => {};
  }

  setChangeHandler(uri: Uri, handler: (uri: Uri) => void): void {
    this.log('setChangeHandler', uri.toString());
    this.changeHandlers.set(uri.toString(), handler);
  }

  removeChangeHandler(uri: Uri): void {
    this.changeHandlers.delete(uri.toString());
  }

  private toRealUri(uri: Uri): Uri {
    return Uri.file(uri.path);
  }

  private isSelfWrite(key: string): boolean {
    const writeTime = this.lastWriteTime.get(key);
    if (writeTime && Date.now() - writeTime < this.WRITE_GRACE_MS) {
      this.lastWriteTime.delete(key);
      return true;
    }
    if (writeTime) {
      this.lastWriteTime.delete(key);
    }
    return false;
  }

  async stat(uri: Uri): Promise<FileStat> {
    return workspace.fs.stat(this.toRealUri(uri));
  }

  async readFile(uri: Uri): Promise<Uint8Array> {
    this.log('readFile', uri.toString());
    const realUri = this.toRealUri(uri);
    const sourceBytes = await workspace.fs.readFile(realUri);
    const source = new TextDecoder().decode(sourceBytes);

    if (this.changeHandlers.has(uri.toString())) {
      const notebook = workspace.notebookDocuments.find(nb => nb.uri.toString() === uri.toString());
      if (notebook && notebook.cellCount > 0) {
        this.log('readFile preserving outputs for managed notebook');
        const merged = this.mergeWithOutputs(source, realUri.fsPath, notebook);
        if (merged) {
          return new TextEncoder().encode(merged);
        }
      }
    }

    return new TextEncoder().encode(sourceToIpynb(source, realUri.fsPath));
  }

  private mergeWithOutputs(
    source: string,
    fileName: string,
    notebook: import('vscode').NotebookDocument
  ): string | null {
    try {
      const parsed = parseNotebook(source, fileName);
      const baseIpynb = JSON.parse(sourceToIpynb(source, fileName)) as IpynbForMerge;

      const oldCells = [];
      for (let i = 0; i < notebook.cellCount; i++) {
        const cell = notebook.cellAt(i);
        oldCells.push({
          source: cell.document.getText(),
          cellKind: cell.kind === NotebookCellKind.Code ? ('code' as const) : ('markup' as const),
          languageId: cell.document.languageId,
        });
      }

      const newCells = parsed.cells.map(cellToDisplayFormat);
      const diff = computeCellDiff(oldCells, newCells);

      for (const op of diff.operations) {
        if (op.type === 'keep' || op.type === 'modify') {
          const notebookCell = notebook.cellAt(op.oldIndex);
          const ipynbCell = baseIpynb.cells[op.newIndex];
          if (ipynbCell && notebookCell.outputs.length > 0) {
            ipynbCell.outputs = serializeOutputs(notebookCell.outputs);
            ipynbCell.execution_count = notebookCell.executionSummary?.executionOrder ?? null;
          }
        }
      }

      return JSON.stringify(baseIpynb, null, 1);
    } catch (e) {
      this.log('mergeWithOutputs failed, falling back to default', e);
      return null;
    }
  }

  async writeFile(
    uri: Uri,
    content: Uint8Array,
    _options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    this.log('writeFile', uri.toString());
    this.lastWriteTime.set(uri.toString(), Date.now());

    const ipynbContent = new TextDecoder().decode(content);
    const source = ipynbToSource(ipynbContent, this.toRealUri(uri).fsPath);
    await workspace.fs.writeFile(this.toRealUri(uri), new TextEncoder().encode(source));
  }

  watch(uri: Uri): Disposable {
    const key = uri.toString();
    this.log('watch called', key);

    const existing = this.watchers.get(key);
    if (existing) {
      this.log('watch already exists for', key);
      return existing;
    }

    const realUri = this.toRealUri(uri);
    this.log('watch creating watcher for real path', realUri.fsPath);
    const watcher = workspace.createFileSystemWatcher(realUri.fsPath);
    const disposables: Disposable[] = [];

    disposables.push(
      watcher.onDidChange(() => {
        this.log('onDidChange fired', key);
        if (this.isSelfWrite(key)) {
          this.log('onDidChange skipped (self-write)');
          return;
        }

        const handler = this.changeHandlers.get(key);
        if (handler) {
          this.log('onDidChange routed to sync handler');
          handler(uri);
          return;
        }

        this._onDidChangeFile.fire([{ type: FileChangeType.Changed, uri }]);
      })
    );

    disposables.push(
      watcher.onDidDelete(() => {
        this.log('onDidDelete fired', key);
        if (this.changeHandlers.has(key)) {
          this.log('onDidDelete suppressed (managed)');
          return;
        }

        this._onDidChangeFile.fire([{ type: FileChangeType.Deleted, uri }]);
        this.watchers.delete(key);
      })
    );

    disposables.push(
      watcher.onDidCreate(() => {
        this.log('onDidCreate fired', key);
        if (this.isSelfWrite(key)) {
          this.log('onDidCreate skipped (self-write)');
          return;
        }

        const handler = this.changeHandlers.get(key);
        if (handler) {
          this.log('onDidCreate routed to sync handler');
          handler(uri);
          return;
        }

        this._onDidChangeFile.fire([{ type: FileChangeType.Created, uri }]);
      })
    );

    const disposable = Disposable.from(watcher, ...disposables);
    this.watchers.set(key, disposable);

    return {
      dispose: () => {
        this.log('watch disposed', key);
        disposable.dispose();
        this.watchers.delete(key);
        this.lastWriteTime.delete(key);
      },
    };
  }

  readDirectory(_uri: Uri): [string, FileType][] {
    return [];
  }

  createDirectory(_uri: Uri): void {
    // Not supported — we only work with existing files
  }

  delete(_uri: Uri): void {
    // Not supported — delete the real file manually
  }

  rename(_oldUri: Uri, _newUri: Uri): void {
    // Not supported — rename the real file manually
  }

  dispose(): void {
    for (const watcher of this.watchers.values()) {
      watcher.dispose();
    }
    this.watchers.clear();
    this._onDidChangeFile.dispose();
  }
}

function serializeOutputs(outputs: readonly import('vscode').NotebookCellOutput[]): unknown[] {
  const result: unknown[] = [];

  for (const output of outputs) {
    const items = output.items;
    if (items.length === 0) {
      continue;
    }

    const stdoutItem = items.find(i => i.mime === 'application/vnd.code.notebook.stdout');
    const stderrItem = items.find(i => i.mime === 'application/vnd.code.notebook.stderr');
    if (stdoutItem) {
      result.push({
        output_type: 'stream',
        name: 'stdout',
        text: splitOutputText(new TextDecoder().decode(stdoutItem.data)),
      });
      continue;
    }
    if (stderrItem) {
      result.push({
        output_type: 'stream',
        name: 'stderr',
        text: splitOutputText(new TextDecoder().decode(stderrItem.data)),
      });
      continue;
    }

    const errorItem = items.find(i => i.mime === 'application/vnd.code.notebook.error');
    if (errorItem) {
      try {
        const raw: unknown = JSON.parse(new TextDecoder().decode(errorItem.data));
        const errorData = raw as Record<string, unknown>;
        const name = typeof errorData['name'] === 'string' ? errorData['name'] : 'Error';
        const message = typeof errorData['message'] === 'string' ? errorData['message'] : '';
        const stack = typeof errorData['stack'] === 'string' ? errorData['stack'].split('\n') : [];
        result.push({
          output_type: 'error',
          ename: name,
          evalue: message,
          traceback: stack,
        });
      } catch {
        result.push({
          output_type: 'error',
          ename: 'Error',
          evalue: '',
          traceback: [],
        });
      }
      continue;
    }

    const data: Record<string, string[]> = {};
    for (const item of items) {
      data[item.mime] = splitOutputText(new TextDecoder().decode(item.data));
    }

    result.push({
      output_type: 'execute_result',
      data,
      metadata: {},
      execution_count: null,
    });
  }

  return result;
}

function splitOutputText(text: string): string[] {
  if (!text) {
    return [];
  }
  const lines = text.split('\n');
  return lines.map((line, i) => {
    if (i < lines.length - 1) {
      return `${line}\n`;
    }
    return line;
  });
}
