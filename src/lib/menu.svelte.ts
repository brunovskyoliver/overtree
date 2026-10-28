import { tick } from 'svelte';

/** Menu button state and keyboard (research R12), shared by the compile options and zoom menus. */
export class Menu {
	open = $state(false);
	root = $state<HTMLElement>();
	toggle = $state<HTMLElement>(); // gets focus back on close
	menu = $state<HTMLElement>();

	#items = () => [...this.menu!.querySelectorAll<HTMLElement>('[role^="menuitem"]')];

	show = async (focus: 'first' | 'last' = 'first') => {
		this.open = true;
		await tick();
		if (!this.open || !this.menu) return;
		// Pane overflow and scrollable tables must not clip their menus. Keep the existing
		// alignment, then move into the browser's top layer and constrain it to the viewport.
		const rect = this.menu.getBoundingClientRect();
		const width = Math.min(rect.width, innerWidth - 16);
		Object.assign(this.menu.style, {
			position: 'fixed', margin: '0', inset: 'auto', minWidth: '0',
			width: `${width}px`, maxHeight: `${innerHeight - 16}px`, overflowY: 'auto',
			left: `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`,
			top: `${Math.max(8, Math.min(rect.top, innerHeight - rect.height - 8))}px`
		});
		this.menu.setAttribute('popover', 'manual');
		this.menu.showPopover();
		this.#items().at(focus === 'first' ? 0 : -1)?.focus({ preventScroll: true });
	};

	close = () => {
		this.open = false;
		this.toggle!.focus();
	};

	ontoggle = () => (this.open ? (this.open = false) : this.show());

	// Enter/Space are the items' own click
	onmenukey = (e: KeyboardEvent) => {
		const list = this.#items();
		const i = list.indexOf(document.activeElement as HTMLElement);
		const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 }[e.key];
		if (to !== undefined) {
			e.preventDefault();
			list[(to + list.length) % list.length].focus();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			this.close();
		} else if (e.key === 'Tab') this.open = false;
	};

	ontogglekey = (e: KeyboardEvent) => {
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
		e.preventDefault();
		this.show(e.key === 'ArrowDown' ? 'first' : 'last');
	};

	// ponytail: an outside click closes without moving focus, the click puts it where the user clicked
	onwindowpointerdown = (e: PointerEvent) => {
		if (this.open && !this.root!.contains(e.target as Node)) this.open = false;
	};
}
