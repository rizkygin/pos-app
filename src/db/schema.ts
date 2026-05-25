import { text, boolean, integer, pgTable, varchar, pgEnum, json, timestamp, index, numeric } from "drizzle-orm/pg-core";
import { timestamps } from "./columns.helper";


export const VEHICLE_TYPE = pgEnum('vechile_type', ['car', 'motorcycle']);
export const STATUS = pgEnum('state', ['addToChart', 'checkout']);
export const ORDER_STATUS = pgEnum('order_status', ['pending', 'confirmed', 'preparing', 'ready', 'on_delivery', 'delivered', 'cancelled']);
export const RECIEPENT = pgEnum('receipt', ['customer', 'courier', 'outlet', 'product']);
export const CASHFLOWS_TRANSACTION_TYPE = pgEnum('cashflows_transaction_type', ['transfer', 'cash']);

export const usersTable = pgTable("users", {
    id: text('id').primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 255 }).default('082222222222'),
    email: varchar("email", { length: 255 }).notNull().unique(),
    address: varchar("address", { length: 255 }).default('Jl. Contoh'),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image").default('avatar.png'),
    ...timestamps
});

export const locationsTable = pgTable("locations", {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    user_id: text('user_id').notNull().references(() => usersTable.id),
    label: varchar("label", { length: 100 }).notNull().default('Rumah'),
    address: varchar("address", { length: 255 }).notNull(),
    lat: varchar("lat", { length: 255 }).notNull(),
    lon: varchar("lon", { length: 255 }).notNull(),
    note: varchar("note", { length: 255 }).default(''),
    is_default: boolean("is_default").default(false).notNull(),
    ...timestamps,
});

export const outletsTable = pgTable("outlets", {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    name: varchar("name", { length: 255 }).notNull(),
    address: varchar("address", { length: 255 }).notNull(),
    lat: varchar("lat", { length: 255 }).notNull(),
    lon: varchar("lon", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    user_id: text('user_id').notNull().references(() => usersTable.id),
    avatar: varchar("avatar", { length: 255 }).notNull().default('avatar.png'),
    ratings: numeric("ratings", { precision: 3, scale: 2 }).default('5'),
    review_count: integer("review_count").default(0).notNull(),
    tags: text("tags").array().default([]).notNull(),
    features: text("features").array().default([]).notNull(),
    is_open: boolean("is_open").default(true).notNull(),
    ...timestamps,
});

export const customersTable = pgTable("customers", {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    user_id: text('user_id').notNull().references(() => usersTable.id),
    ratings: numeric("ratings", { precision: 3, scale: 2 }).default('5'),
    review_count: integer("review_count").default(0).notNull(),
    ...timestamps,
});

export const couriersTable = pgTable("couriers", {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    user_id: text('user_id').notNull().references(() => usersTable.id),
    avatar: varchar("avatar", { length: 255 }).notNull().default('avatar-courier.png'),
    vehicle_plate: varchar("vehicle_plate", { length: 255 }).notNull(),
    vehicle_type: VEHICLE_TYPE("vehicle_type").notNull(),
    ratings: numeric("ratings", { precision: 3, scale: 2 }).default('5'),
    review_count: integer("review_count").default(0).notNull(),
    ...timestamps,
});

export const productsTable = pgTable('products', {
    id: text('id').primaryKey(),
    product_name: varchar("product_name", { length: 255 }).notNull(),
    price: varchar("price", { length: 10 }).notNull(),
    price_mark_down: varchar("price_mark_down", { length: 10 }).notNull(),
    buying_price: varchar("buying_price", { length: 15 }).notNull().default('0'),
    outlet_id: integer("outlet_id").notNull().references(() => outletsTable.id),
    ratings: numeric("ratings", { precision: 3, scale: 2 }).default('5'),
    image: varchar("image", { length: 255 }).notNull().default('avatar.png'),
    category: varchar("category", { length: 255 }).notNull().default('avatar.png'),
    isAvailable: boolean("is_available").default(true).notNull(),
    description: varchar("description", { length: 255 }).default(''),
    unit: varchar("unit", { length: 10 }).notNull().default('pcs'),
    features: text("features").array().default([]).notNull(),
    is_recommended: boolean("is_recommended").default(false).notNull(),
    discount_percent: integer("discount_percent"),
    review_count: integer("review_count").default(0).notNull(),
    ...timestamps,
}, (table) => [
    index("products_available_deleted_idx").on(table.isAvailable, table.deletedAt),
]);

export const ordersTable = pgTable('orders', {
    id: text('id').primaryKey(),
    customer_id: integer("customer_id").notNull().references(() => customersTable.id),
    courier_id: integer("courier_id").references(() => couriersTable.id),
    outlet_id: integer("outlet_id").notNull().references(() => outletsTable.id),
    status: ORDER_STATUS("status").default('pending').notNull(),
    promo_id: integer("promo_id").references(() => promosTable.id),
    discount_amount: varchar("discount_amount", { length: 15 }),
    delivery_fee: varchar("delivery_fee", { length: 15 }),
    scheduled_at: timestamp("scheduled_at", { withTimezone: true }),
    note: json("note"),
    ...timestamps,
}, (table) => [
    index("id_idx").on(table.id),
    index("costomer_id_idx").on(table.customer_id),
    index("courier_id_idx").on(table.courier_id),
    index("outlet_id_idx").on(table.outlet_id),
])

export const orderDetailsTable = pgTable('orderDetails', {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    order_id: text('order_id').notNull().references(() => ordersTable.id),
    product_id: text('product_id').notNull().references(() => productsTable.id),
    quantity: integer("quantity").notNull(),
    note_product: text('note_product'),
    extra: json("extra"),
    summary_price: varchar("summary_price", { length: 10 }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    status: STATUS("status"),
}, (table) => [
    index("order_details_created_at_idx").on(table.created_at),
])

export const ratingsTable = pgTable('ratings', {
    id: text('id').primaryKey(),
    order_details_id: integer("order_details_id").notNull().references(() => orderDetailsTable.id),
    ratings: numeric("ratings", { precision: 3, scale: 2 }).default('5'),
    comment: text('comment'),
    reviewer: text('reviewer_id').notNull().references(() => usersTable.id),
    reciepent: text('reciepent_id').references(() => usersTable.id),
    outlet_id: integer('outlet_id').references(() => outletsTable.id),
    product_id: text('product_id').references(() => productsTable.id),
    reciepent_as: RECIEPENT("reciepent_as"),
    ...timestamps,
})


export const cashInCategoryTable = pgTable('cashInCategory', {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    category: varchar("category", { length: 50 }),
})

export const cashOutCategoryTable = pgTable('cashOutCategory', {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    category: varchar("category", { length: 50 }),
})

export const cashInDetailTable = pgTable('cashInDetailTable', {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    category_id: integer('category_id').notNull().references(() => cashInCategoryTable.id),
    money_amount: varchar("money_amount", { length: 15 }).notNull(),
    type: CASHFLOWS_TRANSACTION_TYPE("type").$default(() => 'cash').notNull(),
    created_at: timestamp('created_at').defaultNow().notNull(),

})
export const cashOutDetailTable = pgTable('cashOutDetailTable', {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    category_id: integer('category_id').notNull().references(() => cashOutCategoryTable.id),
    money_amount: varchar("money_amount", { length: 15 }).notNull(),
    type: CASHFLOWS_TRANSACTION_TYPE("type").$default(() => 'cash').notNull(),
    created_at: timestamp('created_at').defaultNow().notNull()
})

export const cashFlows = pgTable('cashFlows', {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    outlet_id: integer('outlet_id').notNull().references(() => outletsTable.id),
    cash_opname: varchar("cash_opname", { length: 15 }).notNull().$default(() => 'cash'),
    cash_in_detail_id: integer('cash_in_detail_id').references(() => cashInDetailTable.id),
    cash_out_detail_id: integer('cash_out_detail_id').references(() => cashOutDetailTable.id),
})

export const promosTable = pgTable('promos', {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    code: varchar('code', { length: 20 }).notNull().unique(),
    title: varchar('title', { length: 255 }).notNull(),
    description: varchar('description', { length: 500 }).notNull(),
    discount_percent: integer('discount_percent').notNull(),
    min_order: integer('min_order').notNull().default(0),
    max_discount: integer('max_discount'),
    valid_until: timestamp('valid_until', { withTimezone: true }).notNull(),
    gradient: varchar('gradient', { length: 255 }).notNull().default('from-rose-500 to-pink-600'),
    features: text('features').array().default([]).notNull(),
    is_active: boolean('is_active').default(true).notNull(),
    image: varchar("image", { length: 255 }).notNull().default('/promos/default-promo.png'),
    ...timestamps,
});

export const session = pgTable(
    "session",
    {
        id: text("id").primaryKey(),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        token: text("token").notNull().unique(),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .$onUpdate(() => new Date())
            .notNull(),
        ipAddress: text("ip_address"),
        userAgent: text("user_agent"),
        userId: text('user_id')
            .notNull()
            .references(() => usersTable.id, { onDelete: "cascade" }),
    },
);

export const account = pgTable(
    "account",
    {
        id: text("id").primaryKey(),
        accountId: text("account_id").notNull(),
        providerId: text("provider_id").notNull(),
        userId: text('user_id')
            .notNull()
            .references(() => usersTable.id, { onDelete: "cascade" }),
        accessToken: text("access_token"),
        refreshToken: text("refresh_token"),
        idToken: text("id_token"),
        accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
        refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
        scope: text("scope"),
        password: text("password"),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .$onUpdate(() => new Date())
            .notNull(),
    },
);

export const verification = pgTable(
    "verification",
    {
        id: text("id").primaryKey(),
        identifier: text("identifier").notNull(),
        value: text("value").notNull(),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
);