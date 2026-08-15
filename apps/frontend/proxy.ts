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

// Admin gate for /dashboard/admin/*. Decoupled from the DB: the role check goes
// through the backend /api/me endpoint (cookie forwarded — proxy fetches
// don't carry credentials automatically). 401 => no session => home; any
// non-admin role => the regular dashboard.
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
