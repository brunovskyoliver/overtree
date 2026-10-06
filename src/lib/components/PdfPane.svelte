<section class="pdf" aria-label="PDF preview">
	<!-- ponytail: empty bar keeps the tab strip line, the Recompile bar arrives with compiling -->
	<div class="bar"></div>
	<p class="empty">No PDF yet. Compiling arrives in a later version.</p>
</section>

<style>
	.pdf {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--pdf);
	}
	.bar {
		flex: none;
		height: 34px;
		border-bottom: 1px solid var(--border);
	}
	.empty {
		margin: auto;
		padding: 0 16px;
		text-align: center;
		color: var(--text-muted);
	}
</style>
