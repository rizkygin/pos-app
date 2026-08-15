import { isNull } from "drizzle-orm";
import { ordersTable } from "../db/schema";

/**
 * Every read of `orders` must exclude soft-deleted rows.
 *
 * Cancelling a cashier order sets orders.deleted_at (routes/mutations.ts
 * /api/orders/:orderId/cancel) rather than deleting the row, because the sale
 * and its reversal are both real events and the cashflow reversal points at the
 * order id. The row surviving is the whole point — but it means a query that
 * forgets this predicate reports a sale that was voided, and reports it as
 * revenue.
 *
 * Some queries are already safe by accident: cancellation also sets
 * status='cancelled', so anything filtering that status out (e.g. the
 * `validOrderDetails` predicate in routes/dashboard.ts) can't see these rows.
 * That is a coincidence of the current implementation, not a contract — status
 * is a lifecycle field and deleted_at is a visibility field, and the day
 * something soft-deletes an order in another status the coincidence stops
 * holding. Spell the predicate out rather than leaning on it.
 *
 * Not applied everywhere, on purpose. These queries are structurally unable to
 * see a cancelled cashier order and were left alone:
 *
 * - lib/dispatch.ts, lib/offer-details.ts, the courier-lobby and offer-log
 *   queries. Dispatch only ever reads orders awaiting a courier; a POS order is
 *   written status='delivered' and never enters the queue, so it has no offer
 *   rows to join against.
 * - the service/materials endpoints in routes/orders.ts, which filter on
 *   fulfillment IN ('service','materials'). Cashier orders are 'delivery'.
 *   (These are also under the jasa guardrail — hands off.)
 *
 * If soft-delete is ever extended past cashier orders, revisit all of the above
 * before assuming it still holds.
 */
export const orderNotDeleted = isNull(ordersTable.deletedAt);
