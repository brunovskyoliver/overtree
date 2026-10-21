// Fake doi.org, arXiv and Zotero for Playwright (017): `node tests/fake-refs/main.ts`.
import { fakeRefs } from './server.ts';

const { url } = await fakeRefs().start(Number(process.env.FAKE_REFS_PORT ?? 4176));
console.log(`Fake references on ${url}`);
