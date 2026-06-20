import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

// TEMPORARY diagnostic route to inspect why uploaded files aren't being
// found on disk. Remove after diagnosis.
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get('key') !== 'tmp-diag-8f2c91') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  function safeReaddir(p: string) {
    try {
      return fs.readdirSync(p).map((name) => {
        const full = path.join(p, name);
        const stat = fs.statSync(full);
        return { name, size: stat.size, mtime: stat.mtime };
      });
    } catch (e: any) {
      return { error: e.message };
    }
  }

  const cwd = process.cwd();

  return NextResponse.json({
    cwd,
    'public/uploads/products': safeReaddir(path.join(cwd, 'public', 'uploads', 'products')),
    'public/products': safeReaddir(path.join(cwd, 'public', 'products')),
    'seed-uploads/products': safeReaddir('/app/seed-uploads/products'),
  });
}
