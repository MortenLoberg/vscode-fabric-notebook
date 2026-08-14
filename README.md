# Fabric Notebook for VS Code

Open Microsoft Fabric notebook files in VS Code's native Notebook Editor.

This extension is inspired by the [Databricks Notebook](https://marketplace.visualstudio.com/items?itemName=andrewgross.databricks-notebook) extension (not a fork). It provides a similar experience for Fabric notebooks: edit cells in VS Code or Cursor while keeping the original Fabric Git source file as the source of truth.

This release is view/edit only. Running notebook cells from VS Code or Cursor is not supported yet.

## Usage

Open a Fabric notebook using any of these methods:

1. Right-click `notebook-content.py` (or `.sql`, `.scala`, `.r`) in the Explorer and select **Open as Fabric Notebook**
2. Right-click an open file's editor tab and select **Open as Fabric Notebook**
3. Use the Command Palette: `Fabric: Open as Fabric Notebook`

The file must be named `notebook-content.*` or start with `# Fabric notebook source`.

## Supported format

Fabric Git integration stores notebooks as source files instead of `.ipynb`:

```text
MyNotebook.Notebook/
  .platform
  notebook-content.py
```

```python
# Fabric notebook source

# METADATA ********************
# META { "kernel_info": { "name": "synapse_pyspark" } }

# CELL ********************
print("hello")

# METADATA ********************
# META { "language": "python", "language_group": "synapse_pyspark" }

# MARKDOWN ********************
# # Title
```

The extension also opens `notebook-content.sql`, `notebook-content.scala`, and `notebook-content.r`.

Notebook-level and per-cell `# METADATA` blocks are preserved on save. Cell outputs are not written back to disk (Fabric Git source does not store them).

## Commands

| Command | Description |
|---------|-------------|
| `Fabric: Open as Fabric Notebook` | Open a Fabric source file in the Notebook Editor |

## How it works

The extension uses a FileSystemProvider with a virtual `fabric-notebook://` URI scheme. When you open a Fabric source file as a notebook:

1. The extension converts Fabric Git source to `.ipynb` JSON in memory
2. VS Code's built-in notebook editor displays the cells
3. On save, the extension converts the notebook back to Fabric Git source

The original `notebook-content.*` file remains the source of truth.

## External file changes

If another process edits the source file while it is open as a notebook, the extension updates the cells and keeps in-editor outputs for cells that still match.

Outputs exist only in the open notebook view. Closing and reopening the notebook starts with empty outputs.

## Development

```bash
npm install
npm run build
npm test
npm run typecheck
npm run lint
```

Press F5 in VS Code or Cursor to launch an Extension Development Host.

```bash
npm run package
```

builds a `.vsix` you can install in VS Code or Cursor with **Install from VSIX**.
