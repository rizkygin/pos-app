import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/src/db';
import { adminsTable } from '@/src/db/schema';
import { eq } from 'drizzle-orm';

export async function proxy(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  const totalAdmin = await db.$count(
    adminsTable,
    eq(adminsTable.user_id, session.user.id),
  );

  if (totalAdmin === 0) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/dashboard/admin/:path*',
};
