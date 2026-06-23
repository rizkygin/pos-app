import type { FastifyInstance } from "fastify";
import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  cashInCategoryTable,
  couriersTable,
  customersTable,
  ordersTable,
  outletsTable,
  locationsTable,
  cashInDetailTable,
  orderDetailsTable,
  cashFlows,
} from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";
import { CATEGORY_IN } from "../lib/cashflow-categories";
import { haversineKm } from "../lib/utils/geo";

type NoteJson = {
  location: {
    pick_up: { lat: string; long: string; label: string };
    drop_off: { lat: string; long: string; label: string };
  };
  customer_ratings: string;
  customer_note: string;
  customer_review_count: string;
};

type OrderItem = {
  product_id: string;
  quantity: number;
  note_product?: string;
  summary_price: string;
};

type CreateOrderBody = {
  outlet_id: number;
  promo_id?: number;
  discount_amount?: number;
  note?: NoteJson | null;
  items: OrderItem[];
};

//SEARCH:: distance pricelist
function deliveryFeeFromDistance(km: number): number {
  if (km > 30) throw new Error("Jarak pengiriman melebihi batas maksimum (30 km)");
  if (km <= 5) return 10_000;
  if (km <= 10) return 20_000;
  if (km <= 15) return 30_000;
  if (km <= 20) return 40_000;
  if (km <= 25) return 50_000;
  return 60_000;
}

async function computeDeliveryFee(userId: string, outletId: number): Promise<number> {
  const [[userLoc], [outlet]] = await Promise.all([
    db
      .select({ lat: locationsTable.lat, lon: locationsTable.lon })
      .from(locationsTable)
      .where(and(eq(locationsTable.user_id, userId), eq(locationsTable.is_default, true)))
      .limit(1),
    db
      .select({ lat: outletsTable.lat, lon: outletsTable.lon })
      .from(outletsTable)
      .where(eq(outletsTable.id, outletId))
      .limit(1),
  ]);

  if (!userLoc) throw new Error("Alamat pengiriman tidak ditemukan");
  if (!outlet) throw new Error("Outlet tidak ditemukan");

  const km = haversineKm(
    parseFloat(userLoc.lat),
    parseFloat(userLoc.lon),
    parseFloat(outlet.lat),
    parseFloat(outlet.lon),
  );

  return deliveryFeeFromDistance(km);
}

export async function orderRoutes(app: FastifyInstance) {
  // Compute delivery fee for the signed-in customer's default address.
  // Returns { fee } or { error } in-band (matching the old server action).
  app.get("/api/orders/delivery-fee", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

    const outletId = Number((request.query as { outlet_id?: string }).outlet_id);
    if (!outletId) return reply.send({ error: "Outlet tidak ditemukan" });

    try {
      const fee = await computeDeliveryFee(session.user.id, outletId);
      return reply.send({ fee });
    } catch (e) {
      return reply.send({ error: e instanceof Error ? e.message : "Gagal menghitung ongkos kirim" });
    }
  });

  // Customer creates a new pending order
  app.post("/api/orders/create", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const data = request.body as CreateOrderBody;
    const orderId = crypto.randomUUID();

    try {
      const [[customer], delivery_fee] = await Promise.all([
        db
          .select({ id: customersTable.id })
          .from(customersTable)
          .where(eq(customersTable.user_id, session.user.id))
          .limit(1),
        computeDeliveryFee(session.user.id, data.outlet_id),
      ]);

      if (!customer) throw new Error("Customer record not found for this user");

      await db.transaction(async (tx) => {
        await tx.insert(ordersTable).values({
          id: orderId,
          customer_id: customer.id,
          outlet_id: data.outlet_id,
          courier_id: null,
          status: "pending",
          promo_id: data.promo_id,
          discount_amount: data.discount_amount?.toString(),
          delivery_fee: String(delivery_fee),
          note: data.note ?? null,
          scheduled_at: null,
        });

        if (data.items.length > 0) {
          await tx.insert(orderDetailsTable).values(
            data.items.map((item) => ({
              order_id: orderId,
              product_id: item.product_id,
              quantity: item.quantity,
              note_product: item.note_product,
              summary_price: item.summary_price,
            })),
          );
        }
      });

      return reply.send({ success: true, orderId });
    } catch (e) {
      app.log.error(e, "Failed to create order");
      return reply.status(400).send({ success: false, error: e instanceof Error ? e.message : "Gagal membuat order" });
    }
  });

  // Customer cancels their own still-pending order
  app.post("/api/orders/cancel-by-customer", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const { orderId } = (request.body as { orderId?: string }) ?? {};
    if (!orderId) return reply.status(400).send({ success: false, error: "orderId wajib diisi" });

    const [customer] = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(eq(customersTable.user_id, session.user.id))
      .limit(1);

    if (!customer) return reply.status(403).send({ success: false, error: "Customer not found" });

    await db
      .update(ordersTable)
      .set({ status: "cancelled", rejected_by: "customer", updatedAt: new Date() })
      .where(
        and(
          eq(ordersTable.id, orderId),
          eq(ordersTable.customer_id, customer.id),
          eq(ordersTable.status, "pending"),
        ),
      );

    return reply.send({ success: true });
  });

  // Owner confirms a pending order
  app.post("/api/orders/confirm", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const { orderId } = (request.body as { orderId?: string }) ?? {};
    if (!orderId) return reply.status(400).send({ success: false, error: "orderId wajib diisi" });

    const [outlet] = await db
      .select({ id: outletsTable.id })
      .from(outletsTable)
      .where(eq(outletsTable.user_id, session.user.id))
      .limit(1);

    if (!outlet) return reply.status(403).send({ success: false, error: "Not an owner" });

    await db
      .update(ordersTable)
      .set({ status: "confirmed", updatedAt: new Date() })
      .where(
        and(
          eq(ordersTable.id, orderId),
          eq(ordersTable.outlet_id, outlet.id),
          eq(ordersTable.status, "pending"),
        ),
      );

    return reply.send({ success: true });
  });

  // Owner marks a confirmed/preparing order (with assigned courier) as ready
  app.post("/api/orders/mark-ready", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const { orderId } = (request.body as { orderId?: string }) ?? {};
    if (!orderId) return reply.status(400).send({ success: false, error: "orderId wajib diisi" });

    const [outlet] = await db
      .select({ id: outletsTable.id })
      .from(outletsTable)
      .where(eq(outletsTable.user_id, session.user.id))
      .limit(1);

    if (!outlet) return reply.status(403).send({ success: false, error: "Not an owner" });

    await db
      .update(ordersTable)
      .set({ status: "ready", updatedAt: new Date() })
      .where(
        and(
          eq(ordersTable.id, orderId),
          eq(ordersTable.outlet_id, outlet.id),
          isNotNull(ordersTable.courier_id),
          or(eq(ordersTable.status, "confirmed"), eq(ordersTable.status, "preparing")),
        ),
      );

    return reply.send({ success: true });
  });

  // Owner confirms courier pickup of a ready order
  app.post("/api/orders/confirm-pickup", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const { orderId } = (request.body as { orderId?: string }) ?? {};
    if (!orderId) return reply.status(400).send({ success: false, error: "orderId wajib diisi" });

    const [outlet] = await db
      .select({ id: outletsTable.id })
      .from(outletsTable)
      .where(eq(outletsTable.user_id, session.user.id))
      .limit(1);

    if (!outlet) return reply.status(403).send({ success: false, error: "Not an owner" });

    await db
      .update(ordersTable)
      .set({ status: "on_delivery", updatedAt: new Date() })
      .where(
        and(
          eq(ordersTable.id, orderId),
          eq(ordersTable.outlet_id, outlet.id),
          eq(ordersTable.status, "ready"),
        ),
      );

    return reply.send({ success: true });
  });

  // Courier marks an on_delivery order as delivered; records cash-in for the outlet
  app.post("/api/orders/mark-delivered", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const { orderId } = (request.body as { orderId?: string }) ?? {};
    if (!orderId) return reply.status(400).send({ success: false, error: "orderId wajib diisi" });

    try {
      await db.transaction(async (tx) => {
        const [idCategory] = await tx
          .select({ id: cashInCategoryTable.id })
          .from(cashInCategoryTable)
          .where(eq(cashInCategoryTable.category, CATEGORY_IN[0]))
          .limit(1);

        const [outlet] = await tx
          .select({ id: ordersTable.outlet_id })
          .from(ordersTable)
          .where(eq(ordersTable.id, orderId))
          .limit(1);

        if (!outlet) throw new Error("Not an owner");

        const amount = await tx
          .select({
            sum: sql<number>`sum(cast(${orderDetailsTable.summary_price} as numeric))`,
          })
          .from(orderDetailsTable)
          .where(eq(orderDetailsTable.order_id, orderId));

        const cashIn = await tx
          .insert(cashInDetailTable)
          .values({
            category_id: idCategory.id,
            money_amount: String(amount[0].sum ?? 0),
            type: "cash",
          })
          .returning({ id: cashInDetailTable.id });

        await tx.insert(cashFlows).values({
          outlet_id: Number(outlet.id),
          cash_opname: "cash",
          cash_in_detail_id: cashIn[0].id,
        });

        const [courier] = await tx
          .select({ id: couriersTable.id })
          .from(couriersTable)
          .where(eq(couriersTable.user_id, session.user.id))
          .limit(1);

        if (!courier) throw new Error("Not a courier");

        await tx
          .update(orderDetailsTable)
          .set({ status: "checkout" })
          .where(eq(orderDetailsTable.order_id, orderId));

        await tx
          .update(ordersTable)
          .set({ status: "delivered", updatedAt: new Date() })
          .where(
            and(
              eq(ordersTable.id, orderId),
              eq(ordersTable.courier_id, courier.id),
              eq(ordersTable.status, "on_delivery"),
            ),
          );
      });

      return reply.send({ success: true });
    } catch (error: any) {
      app.log.error(error, "Failed to mark order delivered");
      return reply.status(400).send({ success: false, error: error.message ?? "Gagal menyelesaikan order" });
    }
  });
}
