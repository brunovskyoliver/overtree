<!-- ponytail: one file, feature 006 adds real files and folders -->
<section class="tree-panel" aria-labelledby="file-tree-title">
	<h2 class="pane-header" id="file-tree-title">File tree</h2>
	<ul role="tree" aria-labelledby="file-tree-title">
		<li role="treeitem" aria-selected="true" tabindex="0">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6v18h12V7zM14 3v4h4" /></svg>
			main.tex
		</li>
	</ul>
</section>

<style>
	.tree-panel {
		height: 100%;
		overflow: auto;
	}
	ul {
		margin: 0;
		padding: 0 6px;
		list-style: none;
	}
	li {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 8px;
		border-radius: 4px;
		font-weight: 500;
	}
	li[aria-selected='true'] {
		background: var(--accent);
	}
	svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linejoin: round;
	}
</style>
