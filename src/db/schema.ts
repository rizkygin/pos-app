import { uuid, date, integer, PgEnumColumn, pgTable, varchar, pgEnum, json, timestamp } from "drizzle-orm/pg-core";
import { timestamps } from "./columns.helper";


export const VEHICLE_TYPE = pgEnum('vechile_type', ['car', 'motorcycle']);
export const STATUS = pgEnum('state', ['addToChart', 'checkout']);
export const RECIEPENT = pgEnum('reciepent', ['customer', 'courier', 'outlet']);

export const usersTable = pgTable("users", {
    id: uuid().defaultRandom().primaryKey(),
    name: varchar({ length: 255 }).notNull(),
    phone: varchar({ length: 255 }).notNull(),
    email: varchar({ length: 255 }).notNull().unique(),
    address: varchar({ length: 255 }).notNull(),
    ...timestamps,
});

export const outletsTable = pgTable("outlets", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: varchar({ length: 255 }).notNull(),
    address: varchar({ length: 255 }).notNull(),
    phone: varchar({ length: 255 }).notNull(),
    email: varchar({ length: 255 }).notNull().unique(),
    user_id: uuid().notNull().references(() => usersTable.id),
    avatar: varchar({ length: 255 }).notNull().default('avatar.png'),
    ratings: varchar().default('5'),
    ...timestamps,
});

export const customersTable = pgTable("customers", {
    id: integer().primaryKey().generatedByDefaultAsIdentity(),
    user_id: uuid().notNull().references(() => usersTable.id),
    ratings: varchar().default('5'),
    ...timestamps,
});

export const couriersTable = pgTable("couriers", {
    id: integer().primaryKey().generatedByDefaultAsIdentity(),
    user_id: uuid().notNull().references(() => usersTable.id),
    avatar: varchar({ length: 255 }).notNull().default('avatar-courier.png'),
    vehicle_plate: varchar({ length: 255 }).notNull(),
    vehicle_type: VEHICLE_TYPE().notNull(),
    ratings: varchar().default('5'),
    ...timestamps,
});

export const productsTable = pgTable('products', {
    id: uuid().defaultRandom().primaryKey(),
    product_name: varchar({ length: 255 }).notNull(),
    price: varchar({ length: 10 }).notNull(),
    price_mark_down: varchar({ length: 10 }).notNull(),
    outlet_id: integer().notNull().references(() => outletsTable.id),
    ratings: varchar().default('5'),
    ...timestamps,
});

export const ordersTable = pgTable('orders', {
    id: uuid().defaultRandom().primaryKey(),
    costomer_id: integer().notNull().references(() => customersTable.id),
    courier_id: integer().notNull().references(() => couriersTable.id),
})
//you can place discount on this coloumn later 
//discount : varchar(lenght: 5) ex: OUPIS , AUGUS, RIZKY 

export const orderDetailsTable = pgTable('orderDetails', {
    id: integer().primaryKey().generatedByDefaultAsIdentity(),
    order_id: uuid().notNull().references(() => ordersTable.id),
    product_id: uuid().notNull().references(() => productsTable.id),
    quantity: integer().notNull(),
    note_product: varchar({ length: 255 }).notNull(),
    extra: json(),
    summary_price: varchar({ length: 10 }).notNull(),
    created_at: timestamp().defaultNow().notNull(),
    status: STATUS(),
})

export const ratingsTable = pgTable('ratings', {
    id: uuid().defaultRandom().primaryKey(),
    orderDetailsTable: integer().notNull().references(() => orderDetailsTable.id),
    ratings: varchar().default('5'),
    reviewer: uuid().notNull().references(() => usersTable.id),
    reciepent: uuid().notNull().references(() => usersTable.id),
    reciepent_as: RECIEPENT(),
    ...timestamps,
})