// Relative times for tables (admin, dashboard): "just now", "5 min ago", "3 h ago", "2 days ago", then the date.

const UNITS: [number, Intl.RelativeTimeFormatUnit][] = [
	[60, 'second'],
	[60, 'minute'],
	[24, 'hour'],
	[7, 'day']
];

/** `ts` (ms) relative to `now`, e.g. "5 minutes ago"; older than a week: the date. */
export function relativeTime(ts: number, now = Date.now()): string {
	let v = Math.round((ts - now) / 1000);
	if (Math.abs(v) < 45) return 'just now';
	const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
	for (const [size, unit] of UNITS) {
		if (Math.abs(v) < size) return fmt.format(v, unit);
		v = Math.round(v / size);
	}
	return new Date(ts).toLocaleDateString();
}

/** The full date and time, for a `title` next to a relative time. */
export const absoluteTime = (ts: number) => new Date(ts).toLocaleString();
