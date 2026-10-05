// Railway's deploy healthcheck (healthcheckPath in the root railway.json). A new
// deployment only takes traffic once this answers 2xx, so visitors never hit a
// container that is still booting. Deliberately touches nothing else — not the
// backend, not the session — so it says "this server is up" and nothing more.
export function GET() {
  return Response.json({ ok: true });
}
