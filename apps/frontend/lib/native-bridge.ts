/**
 * Talking to the courier app, when the dashboard happens to be inside it.
 *
 * The same pages run in a plain browser, where none of this exists — every
 * call here is a no-op then, and nothing may depend on the native side being
 * present. The app is an enhancement, not a requirement.
 *
 * Only lifecycle signals cross this boundary. No order data: the web page is
 * the single source of truth about what an order is, so a shipped APK can
 * never go stale against a dashboard that ships weekly.
 */

type NativeBridge = {
  isNativeApp?: boolean;
  platform?: string;
  postMessage(message: string): void;
};

function bridge(): NativeBridge | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as { KurirUlunpesan?: NativeBridge }).KurirUlunpesan;
  return candidate?.isNativeApp ? candidate : null;
}

/** True when this page is running inside the courier app. */
export function isNativeApp(): boolean {
  return bridge() !== null;
}

function send(message: Record<string, unknown>): void {
  try {
    bridge()?.postMessage(JSON.stringify(message));
  } catch {
    // A broken bridge must never take the dashboard down with it — the page
    // works without the app, which is the whole fallback story.
  }
}

/** Signed in: the app mints a device token and registers for offer pushes. */
export function notifyLogin(): void {
  send({ type: 'auth:login' });
}

/** Signed out: revoke the token and stop the location service. */
export function notifyLogout(): void {
  send({ type: 'auth:logout' });
}

/**
 * On shift. The app starts its location foreground service, which is what
 * keeps a courier locatable — and therefore rankable by distance — once the
 * screen goes off.
 */
export function notifyShiftStarted(): void {
  send({ type: 'shift:started' });
}

/** Off shift: stop reporting. The backend clears the stored point itself. */
export function notifyShiftEnded(): void {
  send({ type: 'shift:ended' });
}
