import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Turn an already-authorised request into a Server-Sent Events stream.
 *
 * Writes `retry` and a `ready` event straight away — a client re-reads on
 * `ready`, which is how it catches up on whatever it missed while it was not
 * connected — then a comment line every 20s so idle proxies don't close the
 * connection. `onClose` registers what to undo when the device goes away
 * (unsubscribing from a bus, above all).
 *
 * Authorise BEFORE calling this: once hijacked, the reply can no longer send a
 * 401/403.
 */
export function openEventStream(request: FastifyRequest, reply: FastifyReply) {
  reply.hijack();
  const res = reply.raw;
  // Hijacking skips Fastify's send pipeline, so the headers already set on
  // the reply — CORS above all, which a credentialed cross-origin
  // EventSource cannot do without — are copied across by hand.
  const headers: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(reply.getHeaders())) {
    if (v !== undefined) headers[k] = Array.isArray(v) ? v.map(String) : String(v);
  }
  res.writeHead(200, {
    ...headers,
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // nginx-style proxies buffer responses unless told not to.
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");
  res.write("event: ready\ndata: {}\n\n");

  const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
  const cleanups: (() => void)[] = [() => clearInterval(ping)];
  request.raw.on("close", () => {
    for (const fn of cleanups) fn();
  });

  return {
    send(event: string, data: unknown) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    onClose(fn: () => void) {
      cleanups.push(fn);
    },
  };
}
