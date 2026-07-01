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
  productsTable,
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
  // 'service' = no courier: skip delivery-fee computation, owner drives the flow.
  fulfillment?: "delivery" | "service";
};

//SEARCH:: distance pricelist
function deliveryFeeFromDistance(km: number): number {
  if (km > 30) throw new Error("Jarak pengiriman melebihi batas maksimum (30 km)");
  if (km <= 5) return 10_000;
  if (km <= 6) return 11_000;
  if (km <= 7) return 13_000;
  if (km <= 8) return 16_000;
  if (km <= 9) return 17_000;
  if (km <= 10) return 19_000;
  if (km <= 12) return 23_000;
  if (km <= 14) return 25_000;
  if (km <= 15) return 28_000;
  if (km <= 17) return 30_000;
  if (km <= 20) return 38_000;
  if (km <= 25) return 45_000;
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
    const isService = data.fulfillment === "service";

    try {
      // Service orders have no courier/delivery, so there's no delivery fee to
      // compute (and no drop-off location to compute it from).
      const [[customer], delivery_fee] = await Promise.all([
        db
          .select({ id: customersTable.id })
          .from(customersTable)
          .where(eq(customersTable.user_id, session.user.id))
          .limit(1),
        isService ? Promise.resolve(0) : computeDeliveryFee(session.user.id, data.outlet_id),
      ]);

      if (!customer) throw new Error("Customer record not found for this user");

      await db.transaction(async (tx) => {
        await tx.insert(ordersTable).values({
          id: orderId,
          customer_id: customer.id,
          outlet_id: data.outlet_id,
          courier_id: null,
          fulfillment: isService ? "service" : "delivery",
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
          // Delivery orders need a courier assigned before they can be "ready";
          // service orders have no courier, so allow them through.
          or(isNotNull(ordersTable.courier_id), eq(ordersTable.fulfillment, "service")),
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

  // ----- Service (no-courier) order lifecycle -----
  // These mirror the delivery transitions but are driven entirely by the owner
  // (and finished by the customer). courier_id stays null the whole time.

  // Helper: resolve the caller's outlet, or reply 403.
  async function requireOwnerOutlet(request: any, reply: any) {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) {
      reply.status(401).send({ success: false, error: "Unauthorized" });
      return null;
    }
    const [outlet] = await db
      .select({ id: outletsTable.id })
      .from(outletsTable)
      .where(eq(outletsTable.user_id, session.user.id))
      .limit(1);
    if (!outlet) {
      reply.status(403).send({ success: false, error: "Not an owner" });
      return null;
    }
    return { session, outlet };
  }

  // Owner accepts a pending service order at a price they slide within the
  // product's [lowest_price, highest_price] range. The chosen price becomes the
  // agreed price on the order detail. pending -> confirmed.
  app.post("/api/orders/confirm-service", async (request, reply) => {
    const ctx = await requireOwnerOutlet(request, reply);
    if (!ctx) return;

    const { orderId, price } = (request.body as { orderId?: string; price?: number | string }) ?? {};
    if (!orderId || price == null) {
      return reply.status(400).send({ success: false, error: "orderId dan price wajib diisi" });
    }
    const chosen = Number(price);
    if (!Number.isFinite(chosen) || chosen < 0) {
      return reply.status(400).send({ success: false, error: "Harga tidak valid" });
    }

    try {
      // The service product's range (a service order is a single service item).
      const [row] = await db
        .select({
          detailId: orderDetailsTable.id,
          lowest: productsTable.lowest_price,
          highest: productsTable.highest_price,
          status: ordersTable.status,
          fulfillment: ordersTable.fulfillment,
        })
        .from(ordersTable)
        .innerJoin(orderDetailsTable, eq(orderDetailsTable.order_id, ordersTable.id))
        .innerJoin(productsTable, eq(productsTable.id, orderDetailsTable.product_id))
        .where(and(eq(ordersTable.id, orderId), eq(ordersTable.outlet_id, ctx.outlet.id)))
        .limit(1);

      if (!row) return reply.status(404).send({ success: false, error: "Order tidak ditemukan" });
      if (row.fulfillment !== "service") return reply.status(400).send({ success: false, error: "Bukan order layanan" });
      if (row.status !== "pending") return reply.status(400).send({ success: false, error: "Order tidak lagi menunggu konfirmasi" });

      const lowest = Number(row.lowest ?? 0);
      const highest = Number(row.highest ?? row.lowest ?? 0);
      if (chosen < lowest || chosen > highest) {
        return reply.status(400).send({ success: false, error: `Harga harus di antara ${lowest} dan ${highest}` });
      }

      await db.transaction(async (tx) => {
        await tx
          .update(orderDetailsTable)
          .set({ summary_price: String(chosen) })
          .where(eq(orderDetailsTable.order_id, orderId));
        await tx
          .update(ordersTable)
          .set({ status: "confirmed", updatedAt: new Date() })
          .where(and(eq(ordersTable.id, orderId), eq(ordersTable.status, "pending")));
      });

      return reply.send({ success: true });
    } catch (error: any) {
      app.log.error(error, "Failed to confirm service order");
      return reply.status(400).send({ success: false, error: error.message ?? "Gagal mengonfirmasi order" });
    }
  });

  // Owner sets the appointment time and an optional discount (amount or percent,
  // stored resolved into discount_amount). confirmed -> preparing.
  app.post("/api/orders/schedule-service", async (request, reply) => {
    const ctx = await requireOwnerOutlet(request, reply);
    if (!ctx) return;

    const { orderId, scheduled_at, discount_amount, discount_percent } =
      (request.body as {
        orderId?: string;
        scheduled_at?: string;
        discount_amount?: number | string;
        discount_percent?: number | string;
      }) ?? {};
    if (!orderId || !scheduled_at) {
      return reply.status(400).send({ success: false, error: "orderId dan scheduled_at wajib diisi" });
    }
    const when = new Date(scheduled_at);
    if (Number.isNaN(when.getTime())) {
      return reply.status(400).send({ success: false, error: "Tanggal jadwal tidak valid" });
    }

    try {
      // Agreed price = sum of the order's detail prices (set at confirm).
      const [{ sum: agreed } = { sum: 0 }] = await db
        .select({ sum: sql<number>`coalesce(sum(cast(${orderDetailsTable.summary_price} as numeric)), 0)` })
        .from(orderDetailsTable)
        .where(eq(orderDetailsTable.order_id, orderId));

      let discount = 0;
      if (discount_percent != null && discount_percent !== "") {
        const pct = Number(discount_percent);
        if (Number.isFinite(pct) && pct > 0) discount = Math.round((Number(agreed) * pct) / 100);
      } else if (discount_amount != null && discount_amount !== "") {
        const amt = Number(discount_amount);
        if (Number.isFinite(amt) && amt > 0) discount = Math.round(amt);
      }
      if (discount > Number(agreed)) discount = Number(agreed);

      const res = await db
        .update(ordersTable)
        .set({ status: "preparing", scheduled_at: when, discount_amount: String(discount), updatedAt: new Date() })
        .where(
          and(
            eq(ordersTable.id, orderId),
            eq(ordersTable.outlet_id, ctx.outlet.id),
            eq(ordersTable.fulfillment, "service"),
            eq(ordersTable.status, "confirmed"),
          ),
        )
        .returning({ id: ordersTable.id });

      if (res.length === 0) return reply.status(400).send({ success: false, error: "Order tidak dapat dijadwalkan" });
      return reply.send({ success: true, discount_amount: discount });
    } catch (error: any) {
      app.log.error(error, "Failed to schedule service order");
      return reply.status(400).send({ success: false, error: error.message ?? "Gagal menjadwalkan order" });
    }
  });

  // Owner closes a scheduled service order once the work is done, handing it to
  // the customer to accept. ready -> on_delivery (reuses on_delivery as "closed").
  app.post("/api/orders/close-service", async (request, reply) => {
    const ctx = await requireOwnerOutlet(request, reply);
    if (!ctx) return;

    const { orderId } = (request.body as { orderId?: string }) ?? {};
    if (!orderId) return reply.status(400).send({ success: false, error: "orderId wajib diisi" });

    const res = await db
      .update(ordersTable)
      .set({ status: "on_delivery", updatedAt: new Date() })
      .where(
        and(
          eq(ordersTable.id, orderId),
          eq(ordersTable.outlet_id, ctx.outlet.id),
          eq(ordersTable.fulfillment, "service"),
          eq(ordersTable.status, "ready"),
        ),
      )
      .returning({ id: ordersTable.id });

    if (res.length === 0) return reply.status(400).send({ success: false, error: "Order tidak dapat ditutup" });
    return reply.send({ success: true });
  });

  // Customer accepts a closed service order. Records the outlet's cash-in
  // (agreed price - discount) and finalises. on_delivery -> delivered.
  app.post("/api/orders/accept-service", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const { orderId } = (request.body as { orderId?: string }) ?? {};
    if (!orderId) return reply.status(400).send({ success: false, error: "orderId wajib diisi" });

    try {
      const [customer] = await db
        .select({ id: customersTable.id })
        .from(customersTable)
        .where(eq(customersTable.user_id, session.user.id))
        .limit(1);
      if (!customer) return reply.status(403).send({ success: false, error: "Customer not found" });

      await db.transaction(async (tx) => {
        const [order] = await tx
          .select({
            outlet_id: ordersTable.outlet_id,
            discount: ordersTable.discount_amount,
          })
          .from(ordersTable)
          .where(
            and(
              eq(ordersTable.id, orderId),
              eq(ordersTable.customer_id, customer.id),
              eq(ordersTable.fulfillment, "service"),
              eq(ordersTable.status, "on_delivery"),
            ),
          )
          .limit(1);
        if (!order) throw new Error("Order tidak dapat diselesaikan");

        const [{ sum: agreed } = { sum: 0 }] = await tx
          .select({ sum: sql<number>`coalesce(sum(cast(${orderDetailsTable.summary_price} as numeric)), 0)` })
          .from(orderDetailsTable)
          .where(eq(orderDetailsTable.order_id, orderId));

        const net = Math.max(0, Number(agreed) - Number(order.discount ?? 0));

        const [idCategory] = await tx
          .select({ id: cashInCategoryTable.id })
          .from(cashInCategoryTable)
          .where(eq(cashInCategoryTable.category, CATEGORY_IN[0]))
          .limit(1);
        if (!idCategory) throw new Error("Kategori kas masuk belum ada");

        const cashIn = await tx
          .insert(cashInDetailTable)
          .values({ category_id: idCategory.id, money_amount: String(net), type: "cash" })
          .returning({ id: cashInDetailTable.id });

        await tx.insert(cashFlows).values({
          outlet_id: Number(order.outlet_id),
          cash_opname: "cash",
          cash_in_detail_id: cashIn[0].id,
        });

        await tx
          .update(orderDetailsTable)
          .set({ status: "checkout" })
          .where(eq(orderDetailsTable.order_id, orderId));

        await tx
          .update(ordersTable)
          .set({ status: "delivered", updatedAt: new Date() })
          .where(and(eq(ordersTable.id, orderId), eq(ordersTable.status, "on_delivery")));
      });

      return reply.send({ success: true });
    } catch (error: any) {
      app.log.error(error, "Failed to accept service order");
      return reply.status(400).send({ success: false, error: error.message ?? "Gagal menyelesaikan order" });
    }
  });
}
