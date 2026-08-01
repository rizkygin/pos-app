import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  ordersTable,
  orderDetailsTable,
  outletsTable,
  couriersTable,
  customersTable,
  usersTable,
  cashInDetailTable,
  cashInCategoryTable,
  cashFlows,
} from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";
import { requireOutletAccess } from "../lib/outlet-access";
import { applySaleStockOut } from "../lib/stock";
import { normalizeIndonesianPhone } from "../lib/utils/phone";
import { parseCoordPair } from "../lib/utils/coords";
import { isWithinServiceArea } from "../lib/service-area";

// Transaction client type (drizzle's tx has the same query builder as `db`).
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Record a POS sale as cash-in for the given outlet. Find-or-create the "Kasir"
// cash-in category so a missing category can't silently drop the cashflow, and
// attribute it to the actual outlet (was hardcoded to outlet 1).
async function addPosToCashflowin(tx: Tx, outletId: number, total: number) {
  let [category] = await tx
    .select({ id: cashInCategoryTable.id })
    .from(cashInCategoryTable)
    .where(eq(cashInCategoryTable.category, "Kasir"))
    .limit(1);

  if (!category) {
    [category] = await tx
      .insert(cashInCategoryTable)
      .values({ category: "Kasir" })
      .returning({ id: cashInCategoryTable.id });
  }

  const [detail] = await tx
    .insert(cashInDetailTable)
    .values({
      category_id: category.id,
      money_amount: String(total),
      type: "cash",
    })
    .returning();

  await tx.insert(cashFlows).values({
    outlet_id: outletId,
    cash_in_detail_id: detail.id,
  });
}

export async function mutationRoutes(app: FastifyInstance) {
  app.post("/api/add-order-detail", async (request, reply) => {
    try {
      // Owner or employee with the cashier permission. The outlet comes from
      // the caller's access — body.outletId is ignored (it let any session
      // write orders into any outlet).
      const access = await requireOutletAccess(request, reply, "cashier");
      if (!access) return;

      const body = (request.body as any) || {};
      body.outletId = access.outlet.id;

      // Idempotency: the desktop cashier (offline-queue capable) sends its own
      // client-generated orderId so a retried request — e.g. the response was
      // lost after the server already committed — replays as a no-op instead
      // of ringing up the sale twice. The web cashier sends no orderId; that
      // path is untouched (server mints one as before). orders.id is a real
      // PRIMARY KEY, so a genuine duplicate is caught below even if this
      // pre-check loses a race.
      const clientOrderId: string | undefined =
        typeof body.orderId === "string" && body.orderId.length > 0 ? body.orderId : undefined;
      if (clientOrderId) {
        const [already] = await db
          .select({ id: ordersTable.id })
          .from(ordersTable)
          .where(eq(ordersTable.id, clientOrderId))
          .limit(1);
        if (already) {
          return { success: true, message: "Order already processed", orderId: clientOrderId, replay: true };
        }
      }

      // Find offline customer and courier (hardcoded for now, can be made dynamic)
      const EMAIL = "rizkygin1@gmail.com";
      const EMAIL_COURIER = "rizkygin3@gmail.com";

      const [customer_offline] = await db
        .select({ id: customersTable.id })
        .from(customersTable)
        .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
        .where(eq(usersTable.email, EMAIL))
        .limit(1);

      const [courier_offline] = await db
        .select({ id: couriersTable.id })
        .from(couriersTable)
        .innerJoin(usersTable, eq(couriersTable.user_id, usersTable.id))
        .where(eq(usersTable.email, EMAIL_COURIER))
        .limit(1);

      let new_order_id: string | undefined;

      try {
        await db.transaction(async (tx) => {
          if (body.cart && body.cart.length > 0) {
            new_order_id = clientOrderId ?? crypto.randomUUID();
            await tx.insert(ordersTable).values({
              id: new_order_id,
              customer_id: customer_offline?.id || 1,
              courier_id: courier_offline?.id || 1,
              status: "delivered",
              outlet_id: body.outletId,
              note: {
                customerName: body.customerName || null,
                cashierName: body.cashierName || null,
                discountAmount: body.discountAmount ?? 0,
                paymentMethod: body.paymentMethod ?? "cash",
                amountPaid: body.amountPaid ?? 0,
                changeDue: body.changeDue ?? 0,
              },
            });

            for (const item of body.cart as any[]) {
              const qty = Number(item.quantity);
              const summary_price =
                item.product.price_mark_down && item.product.price_mark_down !== "0"
                  ? parseFloat(item.product.price_mark_down) * qty
                  : parseFloat(item.product.price) * qty;

              await tx.insert(orderDetailsTable).values({
                order_id: new_order_id,
                product_id: item.product.id,
                quantity: item.quantity,
                note_product: item.note_product || "-",
                summary_price: summary_price.toString(),
                status: "checkout",
              });

              // POS is an immediate sale: move stock (own stock for track_stock
              // products, ingredients for recipe products) with an audit trail.
              // Oversell warnings are ignored here — a POS sale must never fail
              // because stock records lag reality.
              await applySaleStockOut(tx, {
                outletId: body.outletId,
                productId: item.product.id,
                qty,
                note: `POS ${new_order_id}`,
              });
            }
          }

          await addPosToCashflowin(tx, body.outletId, body.total);
        });
      } catch (err: any) {
        // Race: two near-simultaneous retries both slipped past the pre-check
        // above. orders.id is a real PRIMARY KEY, so Postgres catches the
        // duplicate here — treat it exactly like the pre-check hit (already
        // processed), instead of surfacing a raw constraint-violation 500.
        const pgCode = err?.code ?? err?.cause?.code;
        if (clientOrderId && pgCode === "23505") {
          return { success: true, message: "Order already processed", orderId: clientOrderId, replay: true };
        }
        throw err; // anything else: let the outer catch handle it, unchanged
      }

      return { success: true, message: "Order created successfully", orderId: new_order_id };
    } catch (error: any) {
      return reply.status(500).send({ error: { message: error.message || "Internal server error" } });
    }
  });

  app.post("/api/add-pos-to-cashflowin", async (request, reply) => {
    try {
      const access = await requireOutletAccess(request, reply, "cashier");
      if (!access) return;

      const body = (request.body as any) || {};

      await db.transaction((tx) => addPosToCashflowin(tx, access.outlet.id, body.total));

      return { success: true };
    } catch (error: any) {
      return reply.status(500).send({ message: error.message, error: "Internal Server Error" });
    }
  });

  app.post("/api/add-product", async (request, reply) => {
    try {
      const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
      if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

      const body = (request.body as any) || {};
      const { product_name, price, stock, image, outlet_id } = body;

      // Product creation currently stub (matching frontend behavior)
      // await db.insert(productsTable).values({
      //   product_name,
      //   price,
      //   stock,
      //   image,
      //   outlet_id,
      // });

      return { success: true };
    } catch (error: any) {
      console.error("Add product error:", error);
      return reply.status(500).send({ error: error.message || "Internal Server Error" });
    }
  });

  app.post("/api/register-role", async (request, reply) => {
    try {
      const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
      if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

      const userId = session.user.id;
      const body = (request.body as any) || {};
      const { role, data } = body;

      if (role === "owner") {
        const name = String(data?.name ?? "").trim();
        const address = String(data?.address ?? "").trim();
        const phone = String(data?.phone ?? "").trim();
        const email = String(data?.email ?? "").trim().toLowerCase();
        if (!name || !address || !phone || !email) {
          return reply
            .status(400)
            .send({ error: "Nama, alamat, WhatsApp, dan email outlet wajib diisi" });
        }

        // Coverage is advisory, NOT a gate. An outlet outside courier range is
        // warned at the form (see /api/service-area) and may still register:
        // they can sell over the counter today, couriers expand, and refusing a
        // real business because of a circle drawn last month is worse than
        // letting them in with their eyes open.
        //
        // outlets.email is UNIQUE — pre-check so the form gets a friendly 409
        // instead of a raw Postgres error via 500.
        const [taken] = await db
          .select({ id: outletsTable.id })
          .from(outletsTable)
          .where(eq(outletsTable.email, email))
          .limit(1);
        if (taken) {
          return reply
            .status(409)
            .send({ error: "Email outlet sudah digunakan, silakan pakai email lain" });
        }

        // Coverage is advisory at signup — the form warns, it never blocks — but
        // the answer is recorded so the order lobby doesn't have to recompute it
        // on every poll.
        const outletCoords = parseCoordPair(data?.lat, data?.lon);
        const { covered } = outletCoords
          ? await isWithinServiceArea(outletCoords.lat, outletCoords.lon)
          : { covered: true };

        try {
          await db.insert(outletsTable).values({
            name,
            address,
            phone,
            email,
            user_id: userId,
            courier_reachable: covered,
            avatar: data.avatar || "avatar.png",
            // Use the coordinates from the form's "Gunakan Lokasi Saya"; the
            // old Banjarmasin point stays as the fallback only.
            lat: data.lat || "-3.3199",
            lon: data.lon || "114.5907",
            features: Array.isArray(data.features) ? data.features : [],
            is_open: false,
          });
        } catch (e: any) {
          // Race with the pre-check: two submits with the same email.
          if (e?.code === "23505" || e?.cause?.code === "23505") {
            return reply
              .status(409)
              .send({ error: "Email outlet sudah digunakan, silakan pakai email lain" });
          }
          throw e;
        }
      } else if (role === "courier") {
        await db.insert(couriersTable).values({
          user_id: userId,
          vehicle_plate: data.vehicle_plate,
          vehicle_type: data.vehicle_type,
          avatar: data.avatar || "avatar-courier.png",
        });
      } else if (role === "customer") {
        // WhatsApp is how the outlet and courier reach this customer about a
        // live order, so it's required rather than optional. Normalised here,
        // not in the form: the browser is not the only caller, and one canonical
        // shape in the column is worth more than a tidy input mask.
        const phone = normalizeIndonesianPhone(data?.phone);
        if (!phone) {
          return reply.status(400).send({
            error:
              "Nomor WhatsApp tidak valid. Pakai nomor Indonesia, minimal 11 angka (contoh: 08123456789).",
          });
        }

        // Lives on users, not customers: usersTable.phone is already the column
        // the owner's order lobby reads for customer contact. A second phone
        // field on customersTable would be a copy that immediately starts
        // drifting from it.
        await db.update(usersTable).set({ phone }).where(eq(usersTable.id, userId));

        await db.insert(customersTable).values({
          user_id: userId,
        });
      } else {
        return reply.status(400).send({ error: "Invalid role" });
      }

      return { success: true };
    } catch (error: any) {
      console.error("Registration error:", error);
      return reply.status(500).send({ error: error.message || "Internal Server Error" });
    }
  });
}
