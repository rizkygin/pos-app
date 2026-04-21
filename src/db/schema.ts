import { text, boolean, integer, pgTable, varchar, pgEnum, json, timestamp } from "drizzle-orm/pg-core";
import { timestamps } from "./columns.helper";


export const VEHICLE_TYPE = pgEnum('vechile_type', ['car', 'motorcycle']);
export const STATUS = pgEnum('state', ['addToChart', 'checkout']);
export const RECIEPENT = pgEnum('receipt', ['customer', 'courier', 'outlet']);

export const usersTable = pgTable("users", {
    id: text('id').primaryKey(),
    name: varchar({ length: 255 }).notNull(),
    phone: varchar({ length: 255 }).default('082222222222'),
    email: varchar({ length: 255 }).notNull().unique(),
    address: varchar({ length: 255 }).default('Jl. Contoh'),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image").default('avatar.png'),
    ...timestamps
});

export const outletsTable = pgTable("outlets", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: varchar({ length: 255 }).notNull(),
    address: varchar({ length: 255 }).notNull(),
    phone: varchar({ length: 255 }).notNull(),
    email: varchar({ length: 255 }).notNull().unique(),
    user_id: text('user_id').notNull().references(() => usersTable.id),
    avatar: varchar({ length: 255 }).notNull().default('avatar.png'),
    ratings: varchar().default('5'),
    ...timestamps,
});

export const customersTable = pgTable("customers", {
    id: integer().primaryKey().generatedByDefaultAsIdentity(),
    user_id: text('user_id').notNull().references(() => usersTable.id),
    ratings: varchar().default('5'),
    ...timestamps,
});

export const couriersTable = pgTable("couriers", {
    id: integer().primaryKey().generatedByDefaultAsIdentity(),
    user_id: text('user_id').notNull().references(() => usersTable.id),
    avatar: varchar({ length: 255 }).notNull().default('avatar-courier.png'),
    vehicle_plate: varchar({ length: 255 }).notNull(),
    vehicle_type: VEHICLE_TYPE().notNull(),
    ratings: varchar().default('5'),
    ...timestamps,
});

export const productsTable = pgTable('products', {
    id: text('id').primaryKey(),
    product_name: varchar({ length: 255 }).notNull(),
    price: varchar({ length: 10 }).notNull(),
    price_mark_down: varchar({ length: 10 }).notNull(),
    outlet_id: integer().notNull().references(() => outletsTable.id),
    ratings: varchar().default('5'),
    ...timestamps,
});

export const ordersTable = pgTable('orders', {
    id: text('id').primaryKey(),
    costomer_id: integer().notNull().references(() => customersTable.id),
    courier_id: integer().notNull().references(() => couriersTable.id),
})
//you can place discount on this coloumn later 
//discount : varchar(lenght: 5) ex: OUPIS , AUGUS, RIZKY 

export const orderDetailsTable = pgTable('orderDetails', {
    id: integer().primaryKey().generatedByDefaultAsIdentity(),
    order_id: text('order_id').notNull().references(() => ordersTable.id),
    product_id: text('product_id').notNull().references(() => productsTable.id),
    quantity: integer().notNull(),
    note_product: varchar({ length: 255 }).notNull(),
    extra: json(),
    summary_price: varchar({ length: 10 }).notNull(),
    created_at: timestamp().defaultNow().notNull(),
    status: STATUS(),
})

export const ratingsTable = pgTable('ratings', {
    id: text('id').primaryKey(),
    orderDetailsTable: integer().notNull().references(() => orderDetailsTable.id),
    ratings: varchar().default('5'),
    reviewer: text('reviewer_id').notNull().references(() => usersTable.id),
    reciepent: text('reciepent_id').notNull().references(() => usersTable.id),
    reciepent_as: RECIEPENT(),
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