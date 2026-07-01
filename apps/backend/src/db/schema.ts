import {
  text,
  boolean,
  integer,
  pgTable,
  varchar,
  pgEnum,
  json,
  timestamp,
  index,
  uniqueIndex,
  numeric,
} from 'drizzle-orm/pg-core';
import { timestamps } from './columns.helper';

export const VEHICLE_TYPE = pgEnum('vechile_type', ['car', 'motorcycle']);
export const STATUS = pgEnum('state', ['addToChart', 'checkout']);
export const ORDER_STATUS = pgEnum('order_status', [
  'pending',
  'confirmed',
  'preparing',
  'ready',
  'on_delivery',
  'delivered',
  'cancelled',
]);
// delivery = courier-fulfilled order (food/drink/mart): goes through the courier
// lobby + on_delivery leg. service = no courier: owner drives the whole flow and
// the customer accepts at the end (see the service order endpoints).
export const ORDER_FULFILLMENT = pgEnum('order_fulfillment', [
  'delivery',
  'service',
]);
export const RECIEPENT = pgEnum('receipt', [
  'customer',
  'courier',
  'outlet',
  'product',
]);
export const CASHFLOWS_TRANSACTION_TYPE = pgEnum('cashflows_transaction_type', [
  'transfer',
  'cash',
]);
export const REJECTED_BY = pgEnum('rejected_by', [
  'courier',
  'customer',
  'owner',
]);
export const AD_STATUS = pgEnum('ad_status', [
  'pending',
  'approved',
  'rejected',
]);

// --- Invoicing & inventory ---
// sales = faktur penjualan (stock OUT, becomes cash IN when paid)
// purchase = faktur pembelian (stock IN, becomes cash OUT when paid)
export const INVOICE_TYPE = pgEnum('invoice_type', ['sales', 'purchase']);
// draft  -> nothing posted yet (editable, no stock/no receivable)
// posted -> finalised: stock moved, amount owed/owing recorded, not yet paid
// partial-> partially paid
// paid   -> fully paid (cashflow entry created)
// void   -> cancelled: stock movements reversed
export const INVOICE_STATUS = pgEnum('invoice_status', [
  'draft',
  'posted',
  'partial',
  'paid',
  'void',
]);
export const STOCK_MOVEMENT_REASON = pgEnum('stock_movement_reason', [
  'purchase',
  'sales',
  'adjustment',
  'void',
]);

export const usersTable = pgTable('users', {
  id: text('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 255 }).default('082222222222'),
  email: varchar('email', { length: 255 }).notNull().unique(),
  address: varchar('address', { length: 255 }).default('Jl. Contoh'),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image').default('avatar.png'),
  ...timestamps,
});

export const locationsTable = pgTable('locations', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  user_id: text('user_id')
    .notNull()
    .references(() => usersTable.id),
  label: varchar('label', { length: 100 }).notNull().default('Rumah'),
  address: varchar('address', { length: 255 }).notNull(),
  lat: varchar('lat', { length: 255 }).notNull(),
  lon: varchar('lon', { length: 255 }).notNull(),
  note: varchar('note', { length: 255 }).default(''),
  is_default: boolean('is_default').default(false).notNull(),
  ...timestamps,
});

export const outletsTable = pgTable('outlets', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  name: varchar('name', { length: 255 }).notNull(),
  address: varchar('address', { length: 255 }).notNull(),
  lat: varchar('lat', { length: 255 }).notNull(),
  lon: varchar('lon', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  user_id: text('user_id')
    .notNull()
    .references(() => usersTable.id),
  avatar: varchar('avatar', { length: 255 }).notNull().default('avatar.png'),
  ratings: numeric('ratings', { precision: 3, scale: 2 }).default('5'),
  review_count: integer('review_count').default(0).notNull(),
  tags: text('tags').array().default([]).notNull(),
  features: text('features').array().default([]).notNull(),
  is_open: boolean('is_open').default(true).notNull(),
  ...timestamps,
});

export const adminsTable = pgTable('admins', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  user_id: text('user_id')
    .notNull()
    .references(() => usersTable.id),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  ...timestamps,
});

export const customersTable = pgTable('customers', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  user_id: text('user_id')
    .notNull()
    .references(() => usersTable.id),
  ratings: numeric('ratings', { precision: 3, scale: 2 }).default('5'),
  review_count: integer('review_count').default(0).notNull(),
  ...timestamps,
});

export const couriersTable = pgTable('couriers', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  user_id: text('user_id')
    .notNull()
    .references(() => usersTable.id),
  avatar: varchar('avatar', { length: 255 })
    .notNull()
    .default('avatar-courier.png'),
  vehicle_plate: varchar('vehicle_plate', { length: 255 }).notNull(),
  vehicle_type: VEHICLE_TYPE('vehicle_type').notNull(),
  ratings: numeric('ratings', { precision: 3, scale: 2 }).default('5'),
  review_count: integer('review_count').default(0).notNull(),
  ...timestamps,
});

export const productsTable = pgTable(
  'products',
  {
    id: text('id').primaryKey(),
    product_name: varchar('product_name', { length: 255 }).notNull(),
    price: varchar('price', { length: 10 }).notNull(),
    price_mark_down: varchar('price_mark_down', { length: 10 }).notNull(),
    // Service products are priced as a negotiable range instead of a fixed price.
    // When these are set the product is a "service product": the customer sees
    // "mulai dari" lowest_price (price is mirrored to lowest_price), and the owner
    // picks the actual price within [lowest, highest] when confirming the order.
    lowest_price: varchar('lowest_price', { length: 15 }),
    highest_price: varchar('highest_price', { length: 15 }),
    buying_price: varchar('buying_price', { length: 15 })
      .notNull()
      .default('0'),
    outlet_id: integer('outlet_id')
      .notNull()
      .references(() => outletsTable.id),
    ratings: numeric('ratings', { precision: 3, scale: 2 }).default('5'),
    image: varchar('image', { length: 255 }).notNull().default('avatar.png'),
    category: varchar('category', { length: 255 })
      .notNull(),
    isAvailable: boolean('is_available').default(true).notNull(),
    // false = inventory-only item: tracked in stock and usable on invoices, but
    // hidden from the customer ordering flow (customers can't pick it).
    is_for_sale: boolean('is_for_sale').default(true).notNull(),
    // false = this product has no countable stock of its own (a recipe/menu item
    // made from ingredients, or a service). Invoice posting only moves stock for
    // track_stock products; the Stok page only lists them.
    track_stock: boolean('track_stock').default(true).notNull(),
    description: varchar('description', { length: 255 }).default(''),
    unit: varchar('unit', { length: 10 }).notNull().default('pcs'),
    features: text('features').array().default([]).notNull(),
    is_recommended: boolean('is_recommended').default(false).notNull(),
    discount_percent: integer('discount_percent'),
    review_count: integer('review_count').default(0).notNull(),
    // Cached on-hand quantity. Source of truth is the stockMovementsTable ledger;
    // this column is the running balance kept in sync when a movement is posted.
    // numeric (not integer) so weight/volume units (kg, liter) can be fractional.
    stock: numeric('stock', { precision: 12, scale: 2 }).notNull().default('0'),
    ...timestamps,
  },
  (table) => [
    index('products_available_deleted_idx').on(
      table.isAvailable,
      table.deletedAt,
    ),
    index('products_outlet_id_idx').on(table.outlet_id),
  ],
);

export const ordersTable = pgTable(
  'orders',
  {
    id: text('id').primaryKey(),
    customer_id: integer('customer_id')
      .notNull()
      .references(() => customersTable.id),
    courier_id: integer('courier_id').references(() => couriersTable.id),
    outlet_id: integer('outlet_id')
      .notNull()
      .references(() => outletsTable.id),
    fulfillment: ORDER_FULFILLMENT('fulfillment').default('delivery').notNull(),
    status: ORDER_STATUS('status').default('pending').notNull(),
    promo_id: integer('promo_id').references(() => promosTable.id),
    discount_amount: varchar('discount_amount', { length: 15 }),
    delivery_fee: varchar('delivery_fee', { length: 15 }),
    scheduled_at: timestamp('scheduled_at', { withTimezone: true }),
    note: json('note'),
    rejected_by: REJECTED_BY('rejected_by'),
    rejected_reason: varchar('rejected_reason', { length: 255 }),
    ...timestamps,
  },
  (table) => [
    index('id_idx').on(table.id),
    index('costomer_id_idx').on(table.customer_id),
    index('courier_id_idx').on(table.courier_id),
    index('outlet_id_idx').on(table.outlet_id),
    index('orders_outlet_status_idx').on(table.outlet_id, table.status),
    index('orders_courier_status_idx').on(table.courier_id, table.status),
  ],
);

export const orderDetailsTable = pgTable(
  'orderDetails',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    order_id: text('order_id')
      .notNull()
      .references(() => ordersTable.id),
    product_id: text('product_id')
      .notNull()
      .references(() => productsTable.id),
    quantity: integer('quantity').notNull(),
    note_product: text('note_product'),
    extra: json('extra'),
    summary_price: varchar('summary_price', { length: 10 }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    status: STATUS('status'),
  },
  (table) => [
    index('order_details_created_at_idx').on(table.created_at),
    index('order_details_order_id_idx').on(table.order_id),
  ],
);

export const ratingsTable = pgTable(
  'ratings',
  {
    id: text('id').primaryKey(),
    order_details_id: integer('order_details_id')
      .notNull()
      .references(() => orderDetailsTable.id),
    ratings: numeric('ratings', { precision: 3, scale: 2 }).default('5'),
    comment: text('comment'),
    reviewer: text('reviewer_id')
      .notNull()
      .references(() => usersTable.id),
    reciepent: text('reciepent_id').references(() => usersTable.id),
    outlet_id: integer('outlet_id').references(() => outletsTable.id),
    product_id: text('product_id').references(() => productsTable.id),
    reciepent_as: RECIEPENT('reciepent_as'),
    ...timestamps,
  },
  (table) => [
    index('ratings_outlet_id_idx').on(table.outlet_id),
    index('ratings_product_id_idx').on(table.product_id),
    index('ratings_reciepent_idx').on(table.reciepent),
  ],
);

export const cashInCategoryTable = pgTable('cashInCategory', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  category: varchar('category', { length: 50 }),
});

export const cashOutCategoryTable = pgTable('cashOutCategory', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  category: varchar('category', { length: 50 }),
});

export const cashInDetailTable = pgTable(
  'cashInDetailTable',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    category_id: integer('category_id')
      .notNull()
      .references(() => cashInCategoryTable.id),
    money_amount: varchar('money_amount', { length: 15 }).notNull(),
    type: CASHFLOWS_TRANSACTION_TYPE('type')
      .$default(() => 'cash')
      .notNull(),
    created_at: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('cash_in_detail_created_at_idx').on(table.created_at)],
);
export const cashOutDetailTable = pgTable(
  'cashOutDetailTable',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    category_id: integer('category_id')
      .notNull()
      .references(() => cashOutCategoryTable.id),
    money_amount: varchar('money_amount', { length: 15 }).notNull(),
    type: CASHFLOWS_TRANSACTION_TYPE('type')
      .$default(() => 'cash')
      .notNull(),
    created_at: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('cash_out_detail_created_at_idx').on(table.created_at)],
);

export const cashFlows = pgTable('cashFlows', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  outlet_id: integer('outlet_id')
    .notNull()
    .references(() => outletsTable.id),
  cash_opname: varchar('cash_opname', { length: 15 })
    .notNull()
    .$default(() => 'cash'),
  cash_in_detail_id: integer('cash_in_detail_id').references(
    () => cashInDetailTable.id,
  ),
  cash_out_detail_id: integer('cash_out_detail_id').references(
    () => cashOutDetailTable.id,
  ),
});

export const promosTable = pgTable('promos', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  title: varchar('title', { length: 255 }).notNull(),
  description: varchar('description', { length: 500 }).notNull(),
  discount_percent: integer('discount_percent').notNull(),
  min_order: integer('min_order').notNull().default(0),
  max_discount: integer('max_discount'),
  valid_until: timestamp('valid_until', { withTimezone: true }).notNull(),
  gradient: varchar('gradient', { length: 255 })
    .notNull()
    .default('from-rose-500 to-pink-600'),
  features: text('features').array().default([]).notNull(),
  is_active: boolean('is_active').default(true).notNull(),
  image: varchar('image', { length: 255 })
    .notNull()
    .default('/promos/default-promo.png'),
  ...timestamps,
});

export const scheduleProductAdsTable = pgTable('schedule_product_ads', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  time: json('time_display').$type<{ day: string; hour: string }>(),
});

export const productAdsSchedule = pgTable('product_ads_schedule' ,{
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  scheduleProductAdsTable_id : integer('schedule_products_ads_id').notNull().references(() => scheduleProductAdsTable.id),
  productAdsSchedule_id: integer('products_ads_id').notNull().references(()=> productAdsTable.id)
})

export const productAdsTable = pgTable('product_ads', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  outlet_id: integer('outlet_id')
    .notNull()
    .references(() => outletsTable.id),
  product_id: text('product_id')
    .notNull()
    .references(() => productsTable.id),
  title: varchar('title', { length: 255 }).notNull(),
  description: varchar('description', { length: 500 }).default(''),
  banner_image: varchar('banner_image', { length: 255 }).notNull(),
  status: AD_STATUS('status').default('pending').notNull(),
  is_active: boolean('is_active').default(true).notNull(),
  rejection_reason: varchar('rejection_reason', { length: 255 }),
  starts_at: timestamp('starts_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  ends_at: timestamp('ends_at', { withTimezone: true }),
  ...timestamps,
});

export const courierSessionsTable = pgTable('courier_sessions', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  courier_id: integer('courier_id')
    .notNull()
    .references(() => couriersTable.id),
  started_at: timestamp('started_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  ended_at: timestamp('ended_at', { withTimezone: true }),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .$onUpdate(() => new Date())
    .notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
    withTimezone: true,
  }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .$onUpdate(() => new Date())
    .notNull(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});



// ============================================================================
// Invoicing & inventory
// ----------------------------------------------------------------------------
// Owner-side bookkeeping, scoped per outlet:
//   - suppliers          : vendors an outlet buys stock from (purchase invoices)
//   - invoicesTable      : sales / purchase invoice headers (dates, tax, totals)
//   - invoiceItemsTable  : line items; product_id links to stock (nullable for
//                          non-stock charges like ongkir/jasa)
//   - stockMovementsTable: append-only inventory ledger; productsTable.stock is
//                          the cached running balance.
//
// Money uses numeric(14,2) for correct tax/sum math (products & cashflow store
// money as varchar strings; values are cast at the cashflow boundary).
// ============================================================================

export const suppliersTable = pgTable(
  'suppliers',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    outlet_id: integer('outlet_id')
      .notNull()
      .references(() => outletsTable.id),
    name: varchar('name', { length: 255 }).notNull(),
    phone: varchar('phone', { length: 50 }).default(''),
    email: varchar('email', { length: 255 }).default(''),
    address: varchar('address', { length: 255 }).default(''),
    note: varchar('note', { length: 255 }).default(''),
    ...timestamps,
  },
  (table) => [index('suppliers_outlet_id_idx').on(table.outlet_id)],
);

export const invoicesTable = pgTable(
  'invoices',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    outlet_id: integer('outlet_id')
      .notNull()
      .references(() => outletsTable.id),
    type: INVOICE_TYPE('type').notNull(),
    // Human-facing number, unique per outlet (e.g. "INV/2026/0001").
    number: varchar('number', { length: 50 }).notNull(),
    status: INVOICE_STATUS('status').notNull().default('draft'),

    // Counterparty: supplier for purchase, customer for sales; party_name is a
    // free-text fallback when neither is a saved record.
    supplier_id: integer('supplier_id').references(() => suppliersTable.id),
    customer_id: integer('customer_id').references(() => customersTable.id),
    party_name: varchar('party_name', { length: 255 }).default(''),

    // Dates: issue_date = created/terbit, due_date = jatuh tempo / expired.
    issue_date: timestamp('issue_date', { withTimezone: true })
      .defaultNow()
      .notNull(),
    due_date: timestamp('due_date', { withTimezone: true }),

    // Money. tax_rate is a percentage (e.g. 11.00 for PPN 11%); tax_amount is
    // the computed value. tax_inclusive flags whether unit prices already
    // include tax. total = subtotal - discount + tax_amount.
    subtotal: numeric('subtotal', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    tax_rate: numeric('tax_rate', { precision: 5, scale: 2 })
      .notNull()
      .default('0'),
    tax_amount: numeric('tax_amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    tax_inclusive: boolean('tax_inclusive').notNull().default(false),
    discount: numeric('discount', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    total: numeric('total', { precision: 14, scale: 2 }).notNull().default('0'),
    amount_paid: numeric('amount_paid', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    notes: varchar('notes', { length: 500 }).default(''),

    // Link back to the cashflow detail this invoice generated when paid, so a
    // void can reverse it. Exactly one is set depending on type.
    cash_in_detail_id: integer('cash_in_detail_id').references(
      () => cashInDetailTable.id,
    ),
    cash_out_detail_id: integer('cash_out_detail_id').references(
      () => cashOutDetailTable.id,
    ),
    ...timestamps,
  },
  (table) => [
    index('invoices_outlet_type_idx').on(table.outlet_id, table.type),
    index('invoices_status_idx').on(table.status),
    index('invoices_due_date_idx').on(table.due_date),
    uniqueIndex('invoices_outlet_number_uq').on(table.outlet_id, table.number),
  ],
);

export const invoiceItemsTable = pgTable(
  'invoice_items',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    invoice_id: integer('invoice_id')
      .notNull()
      .references(() => invoicesTable.id),
    // Nullable: lines like delivery/jasa have no product and don't move stock.
    product_id: text('product_id').references(() => productsTable.id),
    description: varchar('description', { length: 255 }).notNull(),
    quantity: numeric('quantity', { precision: 12, scale: 2 })
      .notNull()
      .default('1'),
    unit_price: numeric('unit_price', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    // Per-line discount as a percentage (e.g. 10.00 = 10% off this line).
    // line_total already reflects it: qty * unit_price * (1 - discount_pct/100).
    discount_pct: numeric('discount_pct', { precision: 5, scale: 2 })
      .notNull()
      .default('0'),
    line_total: numeric('line_total', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    ...timestamps,
  },
  (table) => [index('invoice_items_invoice_id_idx').on(table.invoice_id)],
);

export const stockMovementsTable = pgTable(
  'stock_movements',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    outlet_id: integer('outlet_id')
      .notNull()
      .references(() => outletsTable.id),
    product_id: text('product_id')
      .notNull()
      .references(() => productsTable.id),
    // Signed: positive = stock in (purchase), negative = stock out (sales).
    qty_change: numeric('qty_change', { precision: 12, scale: 2 }).notNull(),
    reason: STOCK_MOVEMENT_REASON('reason').notNull(),
    // The invoice that caused this movement (null for manual adjustments).
    invoice_id: integer('invoice_id').references(() => invoicesTable.id),
    note: varchar('note', { length: 255 }).default(''),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('stock_movements_product_idx').on(table.product_id),
    index('stock_movements_outlet_idx').on(table.outlet_id),
    index('stock_movements_invoice_idx').on(table.invoice_id),
    // Opname history: filter by outlet + reason, range/sort on created_at.
    index('stock_movements_outlet_reason_created_idx').on(
      table.outlet_id,
      table.reason,
      table.created_at,
    ),
  ],
);
