import { text, boolean, integer, pgTable, varchar, pgEnum, json, timestamp } from "drizzle-orm/pg-core";
import { timestamps } from "./columns.helper";


export const VEHICLE_TYPE = pgEnum('vechile_type', ['car', 'motorcycle']);
export const STATUS = pgEnum('state', ['addToChart', 'checkout']);
export const RECIEPENT = pgEnum('receipt', ['customer', 'courier', 'outlet']);

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

export const outletsTable = pgTable("outlets", {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    name: varchar("name", { length: 255 }).notNull(),
    address: varchar("address", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    user_id: text('user_id').notNull().references(() => usersTable.id),
    avatar: varchar("avatar", { length: 255 }).notNull().default('avatar.png'),
    ratings: varchar("ratings").default('5'),
    ...timestamps,
});

export const customersTable = pgTable("customers", {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    user_id: text('user_id').notNull().references(() => usersTable.id),
    ratings: varchar("ratings").default('5'),
    ...timestamps,
});

export const couriersTable = pgTable("couriers", {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    user_id: text('user_id').notNull().references(() => usersTable.id),
    avatar: varchar("avatar", { length: 255 }).notNull().default('avatar-courier.png'),
    vehicle_plate: varchar("vehicle_plate", { length: 255 }).notNull(),
    vehicle_type: VEHICLE_TYPE("vehicle_type").notNull(),
    ratings: varchar("ratings").default('5'),
    ...timestamps,
});

export const productsTable = pgTable('products', {
    id: text('id').primaryKey(),
    product_name: varchar("product_name", { length: 255 }).notNull(),
    price: varchar("price", { length: 10 }).notNull(),
    price_mark_down: varchar("price_mark_down", { length: 10 }).notNull(),
    outlet_id: integer("outlet_id").notNull().references(() => outletsTable.id),
    ratings: varchar("ratings").default('5'),
    image: varchar("image", { length: 255 }).notNull().default('avatar.png'),
    category: varchar("category", { length: 255 }).notNull().default('avatar.png'),
    isAvailable: boolean("is_available").default(true).notNull(),
    description: varchar("description", { length: 255 }).default(''),
    unit: varchar("unit", { length: 10 }).notNull().default('pcs'),
    ...timestamps,
});

export const ordersTable = pgTable('orders', {
    id: text('id').primaryKey(),
    costomer_id: integer("costomer_id").notNull().references(() => customersTable.id),
    courier_id: integer("courier_id").notNull().references(() => couriersTable.id),

})
//you can place discount on this coloumn later 
//discount : varchar(lenght: 5) ex: OUPIS , AUGUS, RIZKY 

export const orderDetailsTable = pgTable('orderDetails', {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    order_id: text('order_id').notNull().references(() => ordersTable.id),
    product_id: text('product_id').notNull().references(() => productsTable.id),
    quantity: integer("quantity").notNull(),
    note_product: varchar("note_product", { length: 255 }).notNull(),
    extra: json("extra"),
    summary_price: varchar("summary_price", { length: 10 }).notNull(),
    created_at: timestamp("created_at").defaultNow().notNull(),
    status: STATUS("status"),
})

export const ratingsTable = pgTable('ratings', {
    id: text('id').primaryKey(),
    orderDetailsTable: integer("order_details_id").notNull().references(() => orderDetailsTable.id),
    ratings: varchar("ratings").default('5'),
    reviewer: text('reviewer_id').notNull().references(() => usersTable.id),
    reciepent: text('reciepent_id').notNull().references(() => usersTable.id),
    reciepent_as: RECIEPENT("reciepent_as"),
    ...timestamps,
})


export const session = pgTable(
    "session",
    {
        id: text("id").primaryKey(),
        expiresAt: timestamp("expires_at").notNull(),
        token: text("token").notNull().unique(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
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
        accessTokenExpiresAt: timestamp("access_token_expires_at"),
        refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
        scope: text("scope"),
        password: text("password"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
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
        expiresAt: timestamp("expires_at").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
);