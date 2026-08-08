import type { FastifyInstance } from "fastify";
import { tickDispatch } from "./dispatch";

/**
 * How often the dispatch clock is checked.
 *
 * This is the granularity of a 30-second offer, so it bounds how long a courier
 * can sit on an order past their deadline: at 5s the worst case is a 35-second
 * offer, which nobody notices. Going lower buys accuracy nobody asked for and
 * costs a query every time.
 */
const TICK_MS = 5_000;

/**
 * Drives offer expiry and re-dispatch on a timer.
 *
 * The alternative — expiring offers only when someone happens to poll — makes
 * the clock a function of who has a browser open. An order offered to a courier
 * whose phone then dies would sit untouched until another courier opened the
 * lobby, and an order confirmed while the fleet was offline would wait for a
 * human to trigger it. Neither is acceptable for the thing standing between a
 * customer and their food.
 *
 * Safe to run alongside the read-path ticks and, if the backend is ever scaled
 * past one instance, alongside another scheduler: expireStaleOffers is a single
 * atomic UPDATE ... RETURNING, and the partial unique index on order_offers
 * means only one of two racing dispatchers can create the next offer.
 */
export function startDispatchScheduler(app: FastifyInstance) {
  // Guards against overlap: a slow tick must not have a second one running
  // through the same expired offers behind it.
  let running = false;

  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await tickDispatch();
    } catch (err) {
      // A failed tick is not fatal — the next one retries the same work, since
      // every step is derived from current state rather than from what this
      // run believed a moment ago.
      app.log.error({ err }, "dispatch tick failed");
    } finally {
      running = false;
    }
  }, TICK_MS);

  // Don't hold the process open on shutdown.
  timer.unref();

  app.addHook("onClose", async () => {
    clearInterval(timer);
  });

  app.log.info({ tickMs: TICK_MS }, "dispatch scheduler started");
}
