import type { Metadata } from 'next';
import { VerifyPhoneClient } from './verify-phone-client';

/**
 * Where the WhatsApp verification link lands.
 *
 * Public, and deliberately so: the link is tapped from inside WhatsApp, which on
 * a phone opens whatever browser is default — very often one with no session.
 * The token in the URL is the proof, exactly as with the email link, so nothing
 * here depends on being logged in.
 *
 * This render does NOT touch the token. WhatsApp fetches the URL to build the
 * chat preview, and Next.js prefetches links on hover; consuming it server-side
 * meant the token was always spent before the customer's own tap, and everyone
 * saw "link ini sudah dipakai". The spend happens in the client component,
 * behind a button — see the note there.
 */
export const metadata: Metadata = {
    title: 'Verifikasi WhatsApp',
    // Nothing to index, and a crawler on a one-time link is exactly the traffic
    // this page is built to ignore.
    robots: { index: false, follow: false },
};

export default async function VerifyPhonePage({
    searchParams,
}: {
    searchParams: Promise<{ token?: string }>;
}) {
    const { token } = await searchParams;

    return (
        <main className="flex min-h-svh items-center justify-center px-4 py-12">
            <VerifyPhoneClient token={token ?? null} />
        </main>
    );
}
