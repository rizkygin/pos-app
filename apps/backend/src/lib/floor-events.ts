import { EventEmitter } from "node:events";

/**
 * Manajemen Meja live updates: "something on this outlet's floor changed".
 *
 * Every mutation of the floor — a seating, a saved bill, a paid bill, a layout
 * — publishes one of these AFTER its transaction commits, and
 * GET /api/floor/stream forwards it to every host and cashier device of that
 * outlet. The event carries no floor data, only which seatings it touched:
 * devices react by re-reading /api/floor (or one seating), so what they see is
 * always the committed state and always passes the same permission check as a
 * normal read. A lost event therefore costs a few seconds of staleness, never a
 * wrong screen — and the clients keep a slow poll as a safety net for exactly
 * that.
 *
 * IN-PROCESS. The bus lives in this Node process, which is correct while the
 * backend runs as ONE instance (it does, on Railway). Scaling to several
 * replicas would split the subscribers between them; the fix then is to carry
 * the same events over Postgres LISTEN/NOTIFY (pg_notify inside the
 * transaction also gives "delivered only on commit" for free). Nothing outside
 * this file would need to change.
 */

export type FloorEvent = {
  reason: string;
  /** Seatings whose bill or occupancy changed, so a cashier tab can tell if it is one of them. */
  sessionIds: string[];
  at: number;
};

const bus = new EventEmitter();
// One listener per connected device per outlet; the default cap of 10 would
// warn on an ordinary busy evening.
bus.setMaxListeners(0);

const channel = (outletId: number) => `floor:${outletId}`;

export function publishFloor(
  outletId: number,
  reason: string,
  sessionIds: (string | null | undefined)[] = [],
) {
  const event: FloorEvent = {
    reason,
    sessionIds: sessionIds.filter((s): s is string => typeof s === "string" && s !== ""),
    at: Date.now(),
  };
  bus.emit(channel(outletId), event);
}

/** Listen to one outlet's floor. Returns the unsubscribe. */
export function subscribeFloor(outletId: number, listener: (e: FloorEvent) => void) {
  bus.on(channel(outletId), listener);
  return () => {
    bus.off(channel(outletId), listener);
  };
}
