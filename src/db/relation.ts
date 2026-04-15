import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
    usersTable: {
        hasRoleCustomer: r.one.customersTable({
            from: r.usersTable.id,
            to: r.customersTable.user_id
        }),
        hasOutlets: r.many.outletsTable({
            from: r.usersTable.id,
            to: r.outletsTable.user_id
        }),
        hasRoleCourier: r.many.couriersTable({
            from: r.usersTable.id,
            to: r.couriersTable.user_id
        })
    },
    outletsTable: {
        hasRoleUser: r.one.usersTable({
            from: r.outletsTable.user_id,
            to: r.usersTable.id
        }),
        products: r.many.productsTable({
            from: r.outletsTable.id,
            to: r.productsTable.outlet_id
        }),
    },
    customersTable: {
        hasRoleUser: r.one.usersTable({
            from: r.customersTable.user_id,
            to: r.usersTable.id
        }),
        orders: r.many.ordersTable({
            from: r.customersTable.id,
            to: r.ordersTable.costomer_id
        })
    },
    couriersTable: {
        hasRoleUser: r.one.usersTable({
            from: r.couriersTable.user_id,
            to: r.usersTable.id
        }),
        orders: r.many.ordersTable({
            from: r.couriersTable.id,
            to: r.ordersTable.courier_id
        })
    },
    productsTable: {
        hasOutlet: r.one.outletsTable({
            from: r.productsTable.outlet_id,
            to: r.outletsTable.id
        }),
        orderDetails: r.many.orderDetailsTable({
            from: r.productsTable.id,
            to: r.orderDetailsTable.product_id
        })
    },
    orderDetailsTable: {
        hasProduct: r.one.productsTable({
            from: r.orderDetailsTable.product_id,
            to: r.productsTable.id
        }),
        hasOrder: r.one.ordersTable({
            from: r.orderDetailsTable.order_id,
            to: r.ordersTable.id
        })
    },
    ratingsTable: {
        hasOrderDetails: r.one.orderDetailsTable({
            from: r.ratingsTable.orderDetailsTable,
            to: r.orderDetailsTable.id
        }),
        hasReviewer: r.one.usersTable({
            from: r.ratingsTable.reviewer,
            to: r.usersTable.id
        }),
        hasReciepent: r.one.usersTable({
            from: r.ratingsTable.reciepent,
            to: r.usersTable.id
        })
    },
    ordersTable: {
        hasCustomer: r.one.customersTable({
            from: r.ordersTable.costomer_id,
            to: r.customersTable.id
        }),
        hasCourier: r.one.couriersTable({
            from: r.ordersTable.courier_id,
            to: r.couriersTable.id
        }),
        hasOrderDetails: r.many.orderDetailsTable({
            from: r.ordersTable.id,
            to: r.orderDetailsTable.order_id
        })
    }
}));