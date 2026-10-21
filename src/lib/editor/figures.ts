// Figures from pasted, dropped and picked images (feature 015): upload into `figures/` next to the main document,
// then a figure block per image at the caret.
import type { StateCommand } from '@codemirror/state';
import { dirOf, extensionForType, FIGURES_FOLDER, isGraphicName, labelFor, pastedName, relativePath } from '#lib/media.ts';
import type { Project } from '#lib/project.svelte.ts';
import type { FigureSpec } from './commands.ts';
import type { EditorHandle } from './types.ts';

/** Run an insertion as its own undo step: the next typing starts a new one. */
export function insertStep(h: EditorHandle, cmd: StateCommand) {
	h.undoManager.stopCapturing();
	cmd(h.view);
	h.undoManager.stopCapturing();
}

/** The folder `figures/` goes into (the main document's; the root without one) and its project path. */
export function figureHome(project: Project) {
	const main = project.files.find((f) => f.id === project.mainFileId);
	return { parentId: main?.parentId ?? null, dir: main ? dirOf(project.path(main.id)) : '' };
}

/** Path of project file `id` as LaTeX finds it: relative to the main document's folder. */
export const latexPath = (project: Project, id: string) => relativePath(figureHome(project).dir, project.path(id));

// Chrome names every clipboard bitmap "image.png": that is no name of the user's
const GENERIC = /^image\.(png|jpe?g)$/i;

/** The images of a paste or drop that LaTeX can include, and the names of those it can't (GIF, WebP, …). A clipboard
 *  image without a name of its own is called `pasted-YYYYMMDD-HHMMSS.ext`. Files that are no image are left out. */
export function pickImages(list: File[], pasted: boolean, now = new Date()): { images: File[]; refused: string[] } {
	const images: File[] = [];
	const refused: string[] = [];
	for (const f of list) {
		const typed = extensionForType(f.type);
		if (pasted && typed && (!f.name || GENERIC.test(f.name))) images.push(new File([f], pastedName(now, typed), { type: f.type }));
		else if (isGraphicName(f.name)) images.push(f);
		else if (f.type.startsWith('image/')) refused.push(f.name || f.type);
	}
	return { images, refused };
}

export const refusedMessage = (names: string[]) =>
	`LaTeX can't include ${names.join(', ')}: use PNG, JPG or PDF images.`;

/** Upload each image into `figures/` (made when missing, never overwriting: `-2`, `-3` …), one after the other with
 *  the tree's progress lines. Returns a figure for each upload that worked and the messages of those that didn't. */
export async function uploadFigures(project: Project, images: File[]): Promise<{ figures: FigureSpec[]; errors: string[] }> {
	const { parentId } = figureHome(project);
	const lines = project.queueUploads(images);
	const ids: string[] = [];
	const errors: string[] = [];
	for (const [i, file] of images.entries()) {
		const r = await project.send(lines[i], file, parentId, 'rename', FIGURES_FOLDER);
		if (r.status >= 200 && r.status < 300 && r.body.id) ids.push(r.body.id);
		else {
			errors.push(`${file.name}: ${lines[i].error ?? r.body.message ?? 'upload failed.'}`);
			project.dismiss(lines[i]); // the editor shows the message
		}
	}
	if (ids.length) await project.load();
	const figures = ids.map((id) => {
		const path = latexPath(project, id);
		return { path, label: labelFor(path.split('/').at(-1)!) };
	});
	return { figures, errors };
}
