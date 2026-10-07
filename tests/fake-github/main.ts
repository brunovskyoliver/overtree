// Fake GitHub for Playwright (012 quickstart.md): `node tests/fake-github/main.ts`, seeded with one user, one
// installation and two repositories. Specs drive it through POST /_fake/<helper> (server.ts).
import { fakeGitHub } from './server.ts';

const port = Number(process.env.FAKE_GITHUB_PORT ?? 4175);
const gh = fakeGitHub({
	clientId: 'overtree-test-client',
	clientSecret: 'overtree-test-secret',
	callbackUrl: process.env.FAKE_GITHUB_CALLBACK ?? 'http://127.0.0.1:4173/api/github/callback'
});
gh.addUser({ login: 'octo', name: 'Octo Cat', email: 'octo@example.com' });
const installation = gh.addInstallation({ account: 'octo' });
gh.addRepo({
	name: 'thesis',
	installation: installation.id,
	files: {
		'main.tex': '\\documentclass{article}\n\\begin{document}\nHello from GitHub.\n\\end{document}\n',
		'.github/workflows/render-latex.yaml': 'name: Render LaTeX\non: push\njobs: {}\n'
	}
});
gh.addRepo({ name: 'paper', installation: installation.id, files: { 'README.md': '# Paper\n' } });

const { url } = await gh.start(port);
console.log(`Fake GitHub on ${url}`);
