import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { NextResponse } from 'next/server';

// TEMPORARY diagnostic route to inspect why uploaded files aren't being
// found on disk. Remove after diagnosis.
export const dynamic = 'force-dynamic';

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
  const uploadsDir = path.join(cwd, 'public', 'uploads', 'products');

  // Live write-then-immediately-read self test
  let selfTest: any = {};
  try {
    const testName = `selftest-${Date.now()}.txt`;
    const testPath = path.join(uploadsDir, testName);
    fs.writeFileSync(testPath, 'hello');
    const existsImmediately = fs.existsSync(testPath);
    const statImmediately = existsImmediately ? fs.statSync(testPath) : null;
    selfTest = {
      testPath,
      existsImmediately,
      sizeImmediately: statImmediately?.size,
    };
  } catch (e: any) {
    selfTest = { error: e.message, code: e.code };
  }

  let df = '';
  try {
    df = execSync(`df -h ${uploadsDir}`).toString();
  } catch (e: any) {
    df = 'error: ' + e.message;
  }

  let mountInfo = '';
  try {
    mountInfo = execSync(`mount | grep -i uploads || mount`).toString();
  } catch (e: any) {
    mountInfo = 'error: ' + e.message;
  }

  return NextResponse.json({
    cwd,
    selfTest,
    df,
    mountInfo,
    'public/uploads/products': safeReaddir(uploadsDir),
  });
}
