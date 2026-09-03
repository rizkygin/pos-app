import { relations } from "drizzle-orm";
import * as schema from "./schema";

export const usersRelations = relations(schema.usersTable, ({ one, many }) => ({
    hasRoleCustomer: one(schema.customersTable, {
        fields: [schema.usersTable.id],
        references: [schema.customersTable.user_id]
    }),
    hasOutlets: many(schema.outletsTable),
    hasRoleCourier: one(schema.couriersTable, {
        fields: [schema.usersTable.id],
        references: [schema.couriersTable.user_id]
    }),
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
    cashFlows: many(schema.cashFlows),
    orders: many(schema.ordersTable),
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
    orderDetails: many(schema.orderDetailsTable),
    // A variant and the product it varies (migration 0071). Self-referencing,
    // so both ends carry the same relationName — without it drizzle cannot tell
    // which side of the same table it is looking at. Same shape as the add-on
    // self-relation on orderDetails below, and for a related reason: both model
    // "this row belongs under that one", one level deep.
    variantOf: one(schema.productsTable, {
        fields: [schema.productsTable.variant_of],
        references: [schema.productsTable.id],
        relationName: "productVariants"
    }),
    variants: many(schema.productsTable, { relationName: "productVariants" })
}));

export const orderDetailsRelations = relations(schema.orderDetailsTable, ({ one, many }) => ({
    hasProduct: one(schema.productsTable, {
        fields: [schema.orderDetailsTable.product_id],
        references: [schema.productsTable.id]
    }),
    hasOrder: one(schema.ordersTable, {
        fields: [schema.orderDetailsTable.order_id],
        references: [schema.ordersTable.id]
    }),
    // Add-on lines and the line they were added to. Self-referencing, so both
    // ends carry the same relationName — without it drizzle cannot tell which
    // side of the same table it is looking at.
    parentLine: one(schema.orderDetailsTable, {
        fields: [schema.orderDetailsTable.parent_detail_id],
        references: [schema.orderDetailsTable.id],
        relationName: "lineAddons"
    }),
    addons: many(schema.orderDetailsTable, { relationName: "lineAddons" })
}));

export const ratingsRelations = relations(schema.ratingsTable, ({ one }) => ({
    hasOrderDetails: one(schema.orderDetailsTable, {
        fields: [schema.ratingsTable.order_details_id],
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
    }),
    hasOutlet: one(schema.outletsTable, {
        fields: [schema.ratingsTable.outlet_id],
        references: [schema.outletsTable.id]
    }),
    hasProduct: one(schema.productsTable, {
        fields: [schema.ratingsTable.product_id],
        references: [schema.productsTable.id]
    }),
}));

export const ordersRelations = relations(schema.ordersTable, ({ one, many }) => ({
    hasCustomer: one(schema.customersTable, {
        fields: [schema.ordersTable.customer_id],
        references: [schema.customersTable.id]
    }),
    hasCourier: one(schema.couriersTable, {
        fields: [schema.ordersTable.courier_id],
        references: [schema.couriersTable.id]
    }),
    hasOutlet: one(schema.outletsTable, {
        fields: [schema.ordersTable.outlet_id],
        references: [schema.outletsTable.id]
    }),
    hasPromo: one(schema.promosTable, {
        fields: [schema.ordersTable.promo_id],
        references: [schema.promosTable.id]
    }),
    hasOrderDetails: many(schema.orderDetailsTable)
}));

export const cashInCategoryRelation = relations(schema.cashInCategoryTable, ({ many }) => ({
    hasCashInDetails: many(schema.cashInDetailTable),
}));

export const cashOutCategoryRelation = relations(schema.cashOutCategoryTable, ({ many }) => ({
    hasCashOutDetails: many(schema.cashOutDetailTable),
}));

export const cashFlowsRelation = relations(schema.cashFlows, ({ one }) => ({
    hasOutlet: one(schema.outletsTable, {
        fields: [schema.cashFlows.outlet_id],
        references: [schema.outletsTable.id]
    }),
    hasCashInDetail: one(schema.cashInDetailTable, {
        fields: [schema.cashFlows.cash_in_detail_id],
        references: [schema.cashInDetailTable.id]
    }),
    hasCashOutDetail: one(schema.cashOutDetailTable, {
        fields: [schema.cashFlows.cash_out_detail_id],
        references: [schema.cashOutDetailTable.id]
    }),
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

// promosTable has no FK relations — platform admin creates promos independently
// ── Add-on catalogue (see db/schema.ts) ─────────────────────────────────────
export const addonGroupsRelations = relations(schema.addonGroupsTable, ({ one, many }) => ({
    hasOutlet: one(schema.outletsTable, {
        fields: [schema.addonGroupsTable.outlet_id],
        references: [schema.outletsTable.id]
    }),
    options: many(schema.addonGroupOptionsTable),
    attachedTo: many(schema.productAddonGroupsTable)
}));

export const addonGroupOptionsRelations = relations(schema.addonGroupOptionsTable, ({ one }) => ({
    hasGroup: one(schema.addonGroupsTable, {
        fields: [schema.addonGroupOptionsTable.group_id],
        references: [schema.addonGroupsTable.id]
    }),
    // The product actually sold when this option is picked — where its stock,
    // recipe and cost come from.
    hasProduct: one(schema.productsTable, {
        fields: [schema.addonGroupOptionsTable.product_id],
        references: [schema.productsTable.id]
    })
}));

export const productAddonGroupsRelations = relations(schema.productAddonGroupsTable, ({ one }) => ({
    hasProduct: one(schema.productsTable, {
        fields: [schema.productAddonGroupsTable.product_id],
        references: [schema.productsTable.id]
    }),
    hasGroup: one(schema.addonGroupsTable, {
        fields: [schema.productAddonGroupsTable.group_id],
        references: [schema.addonGroupsTable.id]
    })
}));
