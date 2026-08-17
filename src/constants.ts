/**
 * Built-in notebook type so VS Code/Cursor uses the Jupyter notebook editor.
 */
export const NOTEBOOK_TYPE = 'jupyter-notebook';

/**
 * Virtual URI scheme for Fabric notebooks. Distinct from file: so we can
 * transform Fabric source to in-memory ipynb without changing the on-disk file.
 */
export const SCHEME = 'fabric-notebook';

export const FABRIC_HEADER = '# Fabric notebook source';

export const NOTEBOOK_CONTENT_FILENAME = /^notebook-content\.(py|sql|scala|r)$/i;

export const SUPPORTED_EXTENSIONS = ['.py', '.sql', '.scala', '.r'] as const;
