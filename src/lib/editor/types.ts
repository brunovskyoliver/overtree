import type { HocuspocusProvider } from '@hocuspocus/provider';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import type { UndoManager } from 'yjs';

// What the editor hands to the toolbar, outline and page: the shared view plus the active tab's file and sync.
export type EditorHandle = {
	view: EditorView;
	undoManager: UndoManager;
	provider: HocuspocusProvider;
	fileId: string;
	/** Called on every view update until the returned function is called (survives tab switches). */
	listen: (fn: (u: ViewUpdate) => void) => () => void;
};
