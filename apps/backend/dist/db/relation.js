"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.accountRelations = exports.sessionRelations = exports.cashFlowsRelation = exports.cashOutCategoryRelation = exports.cashInCategoryRelation = exports.ordersRelations = exports.ratingsRelations = exports.orderDetailsRelations = exports.productsRelations = exports.couriersRelations = exports.customersRelations = exports.outletsRelations = exports.usersRelations = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema = __importStar(require("./schema"));
exports.usersRelations = (0, drizzle_orm_1.relations)(schema.usersTable, ({ one, many }) => ({
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
exports.outletsRelations = (0, drizzle_orm_1.relations)(schema.outletsTable, ({ one, many }) => ({
    hasRoleUser: one(schema.usersTable, {
        fields: [schema.outletsTable.user_id],
        references: [schema.usersTable.id]
    }),
    products: many(schema.productsTable),
    cashFlows: many(schema.cashFlows),
    orders: many(schema.ordersTable),
}));
exports.customersRelations = (0, drizzle_orm_1.relations)(schema.customersTable, ({ one, many }) => ({
    hasRoleUser: one(schema.usersTable, {
        fields: [schema.customersTable.user_id],
        references: [schema.usersTable.id]
    }),
    orders: many(schema.ordersTable)
}));
exports.couriersRelations = (0, drizzle_orm_1.relations)(schema.couriersTable, ({ one, many }) => ({
    hasRoleUser: one(schema.usersTable, {
        fields: [schema.couriersTable.user_id],
        references: [schema.usersTable.id]
    }),
    orders: many(schema.ordersTable)
}));
exports.productsRelations = (0, drizzle_orm_1.relations)(schema.productsTable, ({ one, many }) => ({
    hasOutlet: one(schema.outletsTable, {
        fields: [schema.productsTable.outlet_id],
        references: [schema.outletsTable.id]
    }),
    orderDetails: many(schema.orderDetailsTable)
}));
exports.orderDetailsRelations = (0, drizzle_orm_1.relations)(schema.orderDetailsTable, ({ one }) => ({
    hasProduct: one(schema.productsTable, {
        fields: [schema.orderDetailsTable.product_id],
        references: [schema.productsTable.id]
    }),
    hasOrder: one(schema.ordersTable, {
        fields: [schema.orderDetailsTable.order_id],
        references: [schema.ordersTable.id]
    })
}));
exports.ratingsRelations = (0, drizzle_orm_1.relations)(schema.ratingsTable, ({ one }) => ({
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
exports.ordersRelations = (0, drizzle_orm_1.relations)(schema.ordersTable, ({ one, many }) => ({
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
exports.cashInCategoryRelation = (0, drizzle_orm_1.relations)(schema.cashInCategoryTable, ({ many }) => ({
    hasCashInDetails: many(schema.cashInDetailTable),
}));
exports.cashOutCategoryRelation = (0, drizzle_orm_1.relations)(schema.cashOutCategoryTable, ({ many }) => ({
    hasCashOutDetails: many(schema.cashOutDetailTable),
}));
exports.cashFlowsRelation = (0, drizzle_orm_1.relations)(schema.cashFlows, ({ one }) => ({
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
exports.sessionRelations = (0, drizzle_orm_1.relations)(schema.session, ({ one }) => ({
    hasUserId: one(schema.usersTable, {
        fields: [schema.session.userId],
        references: [schema.usersTable.id]
    })
}));
exports.accountRelations = (0, drizzle_orm_1.relations)(schema.account, ({ one }) => ({
    hasUserId: one(schema.usersTable, {
        fields: [schema.account.userId],
        references: [schema.usersTable.id]
    })
}));
// promosTable has no FK relations — platform admin creates promos independently
