import { getSession } from '@/lib/auth';
import { ErrandRatingForm } from '@/components/errand/errand-rating-form';

/**
 * Rating page for a finished errand, reached from the link the courier shares
 * over WhatsApp.
 *
 * The link is public in the sense that anyone who receives it can open it, so
 * a session is required and the backend checks the caller is party to this
 * errand before recording anything. The link identifies the job; the login
 * identifies who is rating whom.
 *
 * Both directions land here — the customer rating the courier, and the courier
 * rating the customer. Which one happens is decided server-side from the errand
 * itself, never from anything this page sends.
 */
export default async function ErrandRatingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Redirects to /login by itself when there is no session. Note that /login
  // has no return-URL support, so someone following the WhatsApp link while
  // signed out lands on the dashboard after logging in and has to tap the link
  // a second time. Worth fixing in the login flow rather than here.
  await getSession();

  return (
    <main className="px-4 pb-12">
      <ErrandRatingForm errandId={id} />
    </main>
  );
}
