import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { api, openEditor, test } from './helpers.ts';

/** One blank page, without a TeX container. */
function blankPdf() {
	let pdf = '%PDF-1.4\n';
	const offsets = [0];
	for (const body of [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << >> >>'
	]) {
		offsets.push(pdf.length);
		pdf += `${offsets.length - 1} 0 obj\n${body}\nendobj\n`;
	}
	const xref = pdf.length;
	pdf += 'xref\n0 4\n0000000000 65535 f \n';
	for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
	return Buffer.from(`${pdf}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

test('PDF.js loads on first PDF use, and renders compiled and uploaded PDFs', async ({ page, pid }) => {
	const manifest = JSON.parse(await readFile('.svelte-kit/output/client/.vite/manifest.json', 'utf8'));
	const viewerFile = manifest['src/lib/components/PdfViewer.svelte'].file as string;
	const requests: string[] = [];
	page.on('request', (r) => requests.push(r.url()));
	await openEditor(page);
	expect(requests.some((url) => url.endsWith(viewerFile))).toBe(false);
	const pdf = blankPdf();
	const dir = join(process.env.OVERTREE_E2E_DATA_DIR!, 'compile', pid);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'output.pdf'), pdf);
	await page.route(`**${api()}/compile`, async (route) => {
		if (route.request().method() !== 'POST') return route.continue();
		await route.fulfill({ json: {
			id: 'test-pdf', pdfId: 'test-pdf', status: 'success', compiler: 'pdflatex',
			stopOnFirstError: false, startedAt: Date.now(), durationMs: 0, entries: []
		} });
	});
	await page.getByRole('button', { name: 'Recompile', exact: true }).click();
	const compiled = page.getByRole('region', { name: 'PDF preview', exact: true });
	await expect(compiled.locator('.page canvas')).toBeVisible();
	await expect(compiled.getByRole('textbox', { name: 'Page number' })).toHaveValue('1');
	expect(requests.some((url) => url.endsWith(viewerFile))).toBe(true);

	const uploaded = await page.request.post(`${api()}/files`, {
		headers: { origin: new URL(page.url()).origin },
		multipart: { parentId: '', file: { name: 'proof.pdf', mimeType: 'application/pdf', buffer: pdf } }
	});
	expect(uploaded.status()).toBe(201);
	await page.getByRole('treeitem', { name: 'proof.pdf', exact: true }).locator(':scope > .row').click();
	const preview = page.getByRole('region', { name: 'Preview of proof.pdf', exact: true });
	await expect(preview.locator('.page canvas')).toBeVisible();
	await expect(preview.getByRole('textbox', { name: 'Page number' })).toHaveValue('1');
});
