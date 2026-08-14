import { ExtensionContext, ExtensionMode, workspace, languages } from 'vscode';
import { FabricNotebookFileSystem } from './filesystem';
import { NotebookSyncManager } from './notebookSync';
import { registerCommands } from './commands';
import { SCHEME } from './constants';

let fileSystem: FabricNotebookFileSystem | undefined;

/**
 * Uses a FileSystemProvider with fabric-notebook:// URIs so Fabric Git-source
 * files open in VS Code's Notebook Editor. The original file stays the source of truth.
 */
export function activate(context: ExtensionContext): void {
  fileSystem = new FabricNotebookFileSystem();
  context.subscriptions.push(
    workspace.registerFileSystemProvider(SCHEME, fileSystem, {
      isCaseSensitive: true,
    })
  );
  context.subscriptions.push(fileSystem);

  registerCommands(context);

  const isDev = context.extensionMode === ExtensionMode.Development;
  fileSystem.setDevMode(isDev);
  const syncManager = new NotebookSyncManager(fileSystem, isDev);

  context.subscriptions.push(
    workspace.onDidOpenNotebookDocument(notebook => {
      if (notebook.uri.scheme === SCHEME) {
        syncManager.register(notebook);
      }
    })
  );

  context.subscriptions.push(
    workspace.onDidCloseNotebookDocument(notebook => {
      if (notebook.uri.scheme === SCHEME) {
        syncManager.unregister(notebook);
      }
    })
  );

  context.subscriptions.push({ dispose: () => syncManager.dispose() });

  // Keep inline completions initialized for notebook cells on a custom URI scheme.
  const inlineCompletionProvider = languages.registerInlineCompletionItemProvider(
    { pattern: '**/*' },
    { provideInlineCompletionItems: () => undefined }
  );
  context.subscriptions.push(inlineCompletionProvider);

  if (isDev) {
    console.log('[DEV] Fabric Notebook extension activated');
  }
}

export function deactivate(): void {
  fileSystem?.dispose();
  fileSystem = undefined;
}
