import { commands, window, Uri, ExtensionContext, workspace } from 'vscode';
import { NOTEBOOK_TYPE, SCHEME, SUPPORTED_EXTENSIONS } from './constants';
import { isFabricNotebook, isSupportedNotebookFile } from './parser';

export function registerCommands(context: ExtensionContext): void {
  context.subscriptions.push(commands.registerCommand('fabric.openAsNotebook', openAsNotebook));
}

async function openAsNotebook(uri?: Uri): Promise<void> {
  uri = uri ?? window.activeTextEditor?.document.uri;

  if (!uri) {
    void window.showErrorMessage('No file selected');
    return;
  }

  if (!isSupportedNotebookFile(uri.fsPath)) {
    void window.showErrorMessage(
      `Not a Fabric notebook file. Expected ${SUPPORTED_EXTENSIONS.join(', ')}`
    );
    return;
  }

  try {
    const bytes = await workspace.fs.readFile(uri);
    const content = new TextDecoder().decode(bytes);
    if (!isFabricNotebook(content, uri.fsPath)) {
      void window.showErrorMessage(
        "Not a Fabric notebook. Expected a notebook-content.* file or a '# Fabric notebook source' header."
      );
      return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void window.showErrorMessage(`Failed to read file: ${message}`);
    return;
  }

  const notebookUri = Uri.from({
    scheme: SCHEME,
    path: uri.path,
  });

  try {
    await commands.executeCommand('vscode.openWith', notebookUri, NOTEBOOK_TYPE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void window.showErrorMessage(`Failed to open notebook: ${message}`);
  }
}
