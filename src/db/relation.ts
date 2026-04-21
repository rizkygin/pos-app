import { relations } from "drizzle-orm";
import * as schema from "./schema";

export const usersRelations = relations(schema.usersTable, ({ one, many }) => ({
    hasRoleCustomer: one(schema.customersTable, {
        fields: [schema.usersTable.id],
        references: [schema.customersTable.user_id]
    }),
    hasOutlets: many(schema.outletsTable),
    hasRoleCourier: many(schema.couriersTable),
    sessions: many(schema.session),
    accounts: many(schema.account),
    hasGivenRatings: many(schema.ratingsTable, { relationName: "reviewer" }),
    hasReceivedRatings: many(schema.ratingsTable, { relationName: "reciepent" })
}));

export const outletsRelations = relations(schema.outletsTable, ({ one, many }) => ({
    hasRoleUser: one(schema.usersTable, {
        fields: [schema.outletsTable.user_id],
        references: [schema.usersTable.id]
    }),
    products: many(schema.productsTable),
}));

export const customersRelations = relations(schema.customersTable, ({ one, many }) => ({
    hasRoleUser: one(schema.usersTable, {
        fields: [schema.customersTable.user_id],
        references: [schema.usersTable.id]
    }),
    orders: many(schema.ordersTable)
}));

export const couriersRelations = relations(schema.couriersTable, ({ one, many }) => ({
    hasRoleUser: one(schema.usersTable, {
        fields: [schema.couriersTable.user_id],
        references: [schema.usersTable.id]
    }),
    orders: many(schema.ordersTable)
}));

export const productsRelations = relations(schema.productsTable, ({ one, many }) => ({
    hasOutlet: one(schema.outletsTable, {
        fields: [schema.productsTable.outlet_id],
        references: [schema.outletsTable.id]
    }),
    orderDetails: many(schema.orderDetailsTable)
}));

export const orderDetailsRelations = relations(schema.orderDetailsTable, ({ one }) => ({
    hasProduct: one(schema.productsTable, {
        fields: [schema.orderDetailsTable.product_id],
        references: [schema.productsTable.id]
    }),
    hasOrder: one(schema.ordersTable, {
        fields: [schema.orderDetailsTable.order_id],
        references: [schema.ordersTable.id]
    })
}));

export const ratingsRelations = relations(schema.ratingsTable, ({ one }) => ({
    hasOrderDetails: one(schema.orderDetailsTable, {
        fields: [schema.ratingsTable.orderDetailsTable],
        references: [schema.orderDetailsTable.id]
    }),
    hasReviewer: one(schema.usersTable, {
        fields: [schema.ratingsTable.reviewer],
        references: [schema.usersTable.id],
        relationName: "reviewer"
    }),
    hasReciepent: one(schema.usersTable, {
        fields: [schema.ratingsTable.reciepent],
        references: [schema.usersTable.id],
        relationName: "reciepent"
    })
}));

export const ordersRelations = relations(schema.ordersTable, ({ one, many }) => ({
    hasCustomer: one(schema.customersTable, {
        fields: [schema.ordersTable.costomer_id],
        references: [schema.customersTable.id]
    }),
    hasCourier: one(schema.couriersTable, {
        fields: [schema.ordersTable.courier_id],
        references: [schema.couriersTable.id]
    }),
    hasOrderDetails: many(schema.orderDetailsTable)
}));

export const sessionRelations = relations(schema.session, ({ one }) => ({
    hasUserId: one(schema.usersTable, {
        fields: [schema.session.userId],
        references: [schema.usersTable.id]
    })
}));

export const accountRelations = relations(schema.account, ({ one }) => ({
    hasUserId: one(schema.usersTable, {
        fields: [schema.account.userId],
        references: [schema.usersTable.id]
    })
}));