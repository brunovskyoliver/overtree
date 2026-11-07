// What an upload of files and folders from the desktop sends (FileTree): each file with the folder path it goes into
// below the target, the uploaded folder's own name first ("thesis/figs" for thesis/figs/plot.png).
import { isJunkPath } from './files.ts';

export type Item = { file: File; folder?: string };

/** Files picked with the folder picker: each in its folder, from `webkitRelativePath`. */
export const picked = (files: Iterable<File>): Item[] =>
	[...files].map((file) => ({ file, folder: file.webkitRelativePath.split('/').slice(0, -1).join('/') || undefined }));

/** A dropped file, or all files of a dropped folder, each with the folder path it was in. */
export async function dropped(entry: FileSystemEntry, dir = ''): Promise<Item[]> {
	if (entry.isFile) return [{ file: await new Promise<File>((ok, fail) => (entry as FileSystemFileEntry).file(ok, fail)), folder: dir || undefined }];
	const reader = (entry as FileSystemDirectoryEntry).createReader();
	const entries: FileSystemEntry[] = [];
	// readEntries gives a folder's entries in batches (100 in Chrome) until an empty one
	for (let batch; (batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail))).length; ) entries.push(...batch);
	const path = dir ? `${dir}/${entry.name}` : entry.name;
	return (await Promise.all(entries.map((e) => dropped(e, path)))).flat();
}

/** Without junk (.DS_Store, .git, __MACOSX), like a zip's. */
export const withoutJunk = (items: Item[]) => items.filter(({ file, folder }) => !isJunkPath([...(folder?.split('/') ?? []), file.name]));

/** The path an item shows in the upload list. */
export const itemPath = ({ file, folder }: Item) => (folder ? `${folder}/${file.name}` : file.name);
