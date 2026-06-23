import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { addPosToCashflowin } from '@/lib/cashflow';

export const POST = async (req: Request) => {
  try {
    const [session, body] = await Promise.all([
      headers().then((h) => auth.api.getSession({ headers: h })),
      req.json(),
    ]);

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await addPosToCashflowin(body.total);

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json(
      { message: e.message, error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};
