import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../db";
import {
  ordersTable,
  orderDetailsTable,
  outletsTable,
  couriersTable,
  customersTable,
  usersTable,
  productsTable,
} from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";

async function addPosToCashflowin(total: number) {
  const { cashInDetailTable, cashInCategoryTable, cashFlows } = await import("../db/schema").then((m) => ({
    cashInDetailTable: m.cashInDetailTable,
    cashInCategoryTable: m.cashInCategoryTable,
    cashFlows: m.cashFlows,
  }));

  const [category] = await db
    .select({ id: cashInCategoryTable.id })
    .from(cashInCategoryTable)
    .where(eq(cashInCategoryTable.category, "POS"))
    .limit(1);

  if (!category) return;

  const [detail] = await db
    .insert(cashInDetailTable)
    .values({
      category_id: category.id,
      money_amount: String(total),
      type: "cash",
    })
    .returning();

  await db.insert(cashFlows).values({
    outlet_id: 1,
    cash_in_detail_id: detail.id,
  });
}

export async function mutationRoutes(app: FastifyInstance) {
  app.post("/api/add-order-detail", async (request, reply) => {
    try {
      const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
      if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

      const body = (request.body as any) || {};

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
              discountAmount: body.discountAmount ?? 0,
              paymentMethod: body.paymentMethod ?? "cash",
              amountPaid: body.amountPaid ?? 0,
              changeDue: body.changeDue ?? 0,
            },
          });

          for (const item of body.cart as any[]) {
            const summary_price =
              item.product.price_mark_down && item.product.price_mark_down !== "0"
                ? parseFloat(item.product.price_mark_down) * item.quantity
                : parseFloat(item.product.price) * item.quantity;

            await tx.insert(orderDetailsTable).values({
              order_id: new_order_id,
              product_id: item.product.id,
              quantity: item.quantity,
              note_product: item.note_product || "-",
              summary_price: summary_price.toString(),
              status: "checkout",
            });
          }
        }

        await addPosToCashflowin(body.total);
      });

      return { success: true, message: "Order created successfully", orderId: new_order_id };
    } catch (error: any) {
      return reply.status(500).send({ error: { message: error.message || "Internal server error" } });
    }
  });

  app.post("/api/add-pos-to-cashflowin", async (request, reply) => {
    try {
      const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
      if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

      const body = (request.body as any) || {};

      await addPosToCashflowin(body.total);

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
        await db.insert(outletsTable).values({
          name: data.name,
          address: data.address,
          phone: data.phone,
          email: data.email,
          user_id: userId,
          avatar: data.avatar || "avatar.png",
          lat: "-3.3199",
          lon: "114.5907",
          features: Array.isArray(data.features) ? data.features : [],
          is_open: false,
        });
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
