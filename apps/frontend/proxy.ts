import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { API_URL } from '@/lib/api-url';

// Admin gate for /dashboard/admin/*. Decoupled from the DB: the role check goes
// through the backend /api/me endpoint (cookie forwarded — middleware fetches
// don't carry credentials automatically). 401 => no session => home; any
// non-admin role => the regular dashboard.
export async function proxy(request: NextRequest) {
  const cookie = request.headers.get('cookie') ?? '';
  const res = await fetch(`${API_URL}/api/me`, {
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

export const config = {
  matcher: '/dashboard/admin/:path*',
};
