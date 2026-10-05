import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SERVER_API_URL } from '@/lib/api-url';
import { getMaintenance } from '@/lib/maintenance-server';

// Paths that stay reachable while the platform is down. Without these an admin
// who turned maintenance on has no way back in to turn it off.
const MAINTENANCE_EXEMPT = [
  '/maintenance',
  '/login',
  // Admin-only by the gate below, and where the "end maintenance now" button
  // lives.
  '/dashboard/admin',
];

function isExempt(pathname: string) {
  return MAINTENANCE_EXEMPT.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// The one admin page reachable before two-factor is set up — it is where it
// gets set up. Still admin-only, and inside /dashboard/admin so it stays exempt
// from the maintenance gate.
const ADMIN_SECURITY_PATH = '/dashboard/admin/security';

// Admin gate for /dashboard/admin/*. Decoupled from the DB: the role check goes
// through the backend /api/me endpoint (cookie forwarded — proxy fetches
// don't carry credentials automatically). 401 => no session => home; any
// non-admin role => the regular dashboard; an admin without two-factor =>
// the enrolment page (the backend refuses their admin calls anyway).
async function adminGate(request: NextRequest) {
  const cookie = request.headers.get('cookie') ?? '';
  const res = await fetch(`${SERVER_API_URL}/api/me`, {
    headers: { cookie },
    cache: 'no-store',
  });

  if (res.status === 401) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  const me = res.ok ? await res.json() : null;
  if (me?.role !== 'admin') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  const { pathname } = request.nextUrl;
  if (!me.twoFactorEnabled && pathname !== ADMIN_SECURITY_PATH) {
    return NextResponse.redirect(new URL(ADMIN_SECURITY_PATH, request.url));
  }

  // Admin rights lapse 12 hours after sign-in (lib/admin-access.ts in the
  // backend); the session itself lives on, so the login page is told not to
  // bounce them back as "already signed in".
  if (me.twoFactorEnabled && me.adminSessionExpired) {
    return NextResponse.redirect(new URL('/login?reauth=admin', request.url));
  }

  return NextResponse.next();
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isExempt(pathname)) {
    const maintenance = await getMaintenance();
    if (maintenance.status === 'active') {
      // Rewrite rather than redirect: the visitor keeps the URL they asked for,
      // so a refresh once the window closes lands them back where they were.
      const res = NextResponse.rewrite(new URL('/maintenance', request.url));
      // Tells crawlers and clients this is temporary, not the new content at
      // this URL. Retry-After is seconds until the window is due to end.
      const retryAfter = maintenance.endsAt
        ? Math.max(30, Math.round((Date.parse(maintenance.endsAt) - Date.now()) / 1000))
        : 300;
      res.headers.set('Retry-After', String(retryAfter));
      res.headers.set('X-Robots-Tag', 'noindex');
      res.headers.set('Cache-Control', 'no-store');
      return res;
    }
  }

  if (pathname.startsWith('/dashboard/admin')) {
    return adminGate(request);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next's own assets, the service worker, and files served
  // straight out of /public — those must keep working so the maintenance page
  // can render with its styles and icon.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/|uploads/|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|txt|xml|js|css)$).*)',
  ],
};
