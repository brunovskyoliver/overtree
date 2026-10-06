import type { HocuspocusProvider } from '@hocuspocus/provider';
import type { EditorView } from '@codemirror/view';
import type { UndoManager } from 'yjs';

// What the editor hands to the toolbar, outline and page.
export type EditorHandle = { view: EditorView; undoManager: UndoManager; provider: HocuspocusProvider };
