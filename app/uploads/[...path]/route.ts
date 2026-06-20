import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

// Next.js snapshots `public/` once at server boot and never rescans it, so
// files written to the persistent uploads volume after the server has
// started are invisible to its static file router. This route reads them
// from disk on every request instead, bypassing that snapshot.

const UPLOADS_ROOT = path.join(process.cwd(), 'public', 'uploads');

const CONTENT_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;
  const filePath = path.join(UPLOADS_ROOT, ...segments);

  if (!filePath.startsWith(UPLOADS_ROOT + path.sep)) {
    return new NextResponse('Not found', { status: 404 });
  }

  const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()];
  if (!contentType) {
    return new NextResponse('Not found', { status: 404 });
  }

  try {
    const file = await fs.readFile(filePath);
    return new NextResponse(file, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=0, must-revalidate',
      },
    });
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}
