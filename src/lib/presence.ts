// User colors and initials for cursors, avatars and presence (research R9). Shared by browser and server routes.

/** Eight colors readable as cursor, label background (with dark text) and avatar on the dark theme. */
export const PALETTE = ['#f28b82', '#fbbc04', '#81c995', '#78d9ec', '#8ab4f8', '#c58af9', '#ff8bcb', '#fcad70'] as const;

/** A stable color per user: FNV-1a hash of the id onto the palette. */
export function colorFor(userId: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < userId.length; i++) h = Math.imul(h ^ userId.charCodeAt(i), 0x01000193);
	return PALETTE[(h >>> 0) % PALETTE.length];
}

/** The color at 20 % alpha, for remote selections. Expects `#rrggbb`. */
export const lightColor = (color: string) => `${color}33`;

/** Up to two initials: first letters of the first and last word, else the first letter; '?' when empty. */
export function initials(name: string): string {
	const words = name.trim().split(/[\s@._-]+/).filter(Boolean);
	if (!words.length) return '?';
	const first = [...words[0]][0];
	const last = words.length > 1 ? [...words.at(-1)!][0] : '';
	return (first + last).toUpperCase();
}
