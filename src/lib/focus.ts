// A modal <dialog> keeps the page inert, but Tab past its last control still reaches the browser's own UI.
// `trapTab` as the dialog's keydown handler wraps Tab and Shift+Tab around inside it (feature 015).

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function trapTab(e: KeyboardEvent) {
	if (e.key !== 'Tab') return;
	const box = e.currentTarget as HTMLElement;
	const all = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
		(el) => !el.hasAttribute('disabled') && el.tabIndex >= 0 && !el.hidden && el.getClientRects().length > 0
	);
	if (!all.length) return;
	const first = all[0];
	const last = all.at(-1)!;
	if (e.shiftKey && document.activeElement === first) {
		e.preventDefault();
		last.focus();
	} else if (!e.shiftKey && document.activeElement === last) {
		e.preventDefault();
		first.focus();
	}
}
