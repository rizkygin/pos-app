import { EventEmitter } from "node:events";

/**
 * Pesan Mandiri live updates: "a customer sent an order", or "one was taken
 * care of" (accepted, rejected, cancelled by the customer).
 *
 * Published AFTER the write commits and forwarded by GET /api/self-orders/stream
 * to every cashier device of that outlet, so the till rings the moment a phone
 * sends and stops ringing on every till once one of them has accepted it. Like
 * the floor and shift buses it carries no order data, only which one changed:
 * devices re-read /api/self-orders, so what they show is always the committed
 * state and passes the same permission check as a normal read.
 *
 * IN-PROCESS, for the same reason and with the same way out as the floor bus
 * (lib/floor-events.ts): correct while the backend runs as one instance.
 */

export type SelfOrderEvent = {
  reason: "new" | "accepted" | "rejected" | "cancelled";
  id: string;
  at: number;
};

const bus = new EventEmitter();
// One listener per connected till per outlet.
bus.setMaxListeners(0);

const channel = (outletId: number) => `self-order:${outletId}`;

export function publishSelfOrder(outletId: number, reason: SelfOrderEvent["reason"], id: string) {
  const event: SelfOrderEvent = { reason, id, at: Date.now() };
  bus.emit(channel(outletId), event);
}

/** Listen to one outlet's self orders. Returns the unsubscribe. */
export function subscribeSelfOrder(outletId: number, listener: (e: SelfOrderEvent) => void) {
  bus.on(channel(outletId), listener);
  return () => {
    bus.off(channel(outletId), listener);
  };
}
