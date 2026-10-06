import { clerkSetup } from '@clerk/testing/playwright';

// Testing token for the `clerk` smoke project (bypasses Clerk's bot protection); only with the keys present.
export default async function globalSetup() {
	const publishableKey = process.env.PUBLIC_CLERK_PUBLISHABLE_KEY;
	const secretKey = process.env.CLERK_SECRET_KEY;
	if (publishableKey && secretKey) await clerkSetup({ publishableKey, secretKey });
}
