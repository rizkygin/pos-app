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

      await db.transaction(async (tx) => {
        if (body.cart && body.cart.length > 0) {
          new_order_id = crypto.randomUUID();
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

        try {
          await db.insert(outletsTable).values({
            name,
            address,
            phone,
            email,
            user_id: userId,
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
