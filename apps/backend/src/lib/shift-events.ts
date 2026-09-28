import { EventEmitter } from "node:events";

/**
 * Cashier shift live updates: "this outlet's shift was opened or closed".
 *
 * An outlet has at most one open shift, shared by every till that sells there —
 * the web cashier, the Android app, a second tablet. A shift opened on one of
 * them has to show up on the others, or a cashier keeps selling on a screen
 * that says "Shift belum dibuka", and a shift closed on one leaves the others
 * offering a Tutup Shift that can only answer 409.
 *
 * Published AFTER the open or close commits, and forwarded by
 * GET /api/shifts/stream to every cashier device of that outlet. Like the floor
 * bus (lib/floor-events.ts) it carries no figures, only which shift changed:
 * devices re-read /api/shifts/current, so what they show is always the
 * committed state and passes the same permission check as a normal read.
 *
 * IN-PROCESS, for the same reason and with the same way out as the floor bus:
 * correct while the backend runs as one instance.
 */

export type ShiftEvent = {
  reason: "open" | "close";
  shiftId: number;
  at: number;
};

const bus = new EventEmitter();
// One listener per connected till per outlet.
bus.setMaxListeners(0);

const channel = (outletId: number) => `shift:${outletId}`;

export function publishShift(outletId: number, reason: ShiftEvent["reason"], shiftId: number) {
  const event: ShiftEvent = { reason, shiftId, at: Date.now() };
  bus.emit(channel(outletId), event);
}

/** Listen to one outlet's shifts. Returns the unsubscribe. */
export function subscribeShift(outletId: number, listener: (e: ShiftEvent) => void) {
  bus.on(channel(outletId), listener);
  return () => {
    bus.off(channel(outletId), listener);
  };
}
