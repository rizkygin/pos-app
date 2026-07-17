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
    // Scale 3 matches recipe_items.qty so gram/ml-size recipe decrements
    // (e.g. 0.005 kg per portion) survive the write without rounding.
    stock: numeric('stock', { precision: 12, scale: 3 }).notNull().default('0'),
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
//   - recipeItemsTable   : optional bill-of-materials for menu items; a sale of
//                          a track_stock=false product consumes its ingredients.
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
    // Down payment (uang muka) agreed on the draft; auto-recorded as the first
    // payment when the invoice is posted (amount_paid stays 0 until then).
    down_payment: numeric('down_payment', { precision: 14, scale: 2 })
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

// One row per payment received/made on an invoice (down payment, installment,
// settlement). Links the invoice to the cashflow detail each payment created so
// a void can reverse ALL of them — invoices.cash_in/out_detail_id only remembers
// the latest one.
export const invoicePaymentsTable = pgTable(
  'invoice_payments',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    invoice_id: integer('invoice_id')
      .notNull()
      .references(() => invoicesTable.id),
    cash_in_detail_id: integer('cash_in_detail_id').references(
      () => cashInDetailTable.id,
    ),
    cash_out_detail_id: integer('cash_out_detail_id').references(
      () => cashOutDetailTable.id,
    ),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    created_at: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('invoice_payments_invoice_id_idx').on(table.invoice_id)],
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
    // Scale 3 to carry recipe-precision decrements losslessly.
    qty_change: numeric('qty_change', { precision: 12, scale: 3 }).notNull(),
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

// Optional bill-of-materials: what one sold unit of `product_id` consumes.
// Only consulted when the sold product has track_stock=false (a menu item with
// no countable stock of its own); a menu item with no rows here moves no stock
// at all — recipes are strictly opt-in per product. Rows are kept (dormant) if
// the owner toggles track_stock back on. Hard-deleted, replace-on-save.
export const recipeItemsTable = pgTable(
  'recipe_items',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    outlet_id: integer('outlet_id')
      .notNull()
      .references(() => outletsTable.id),
    // The menu item being sold (track_stock = false).
    product_id: text('product_id')
      .notNull()
      .references(() => productsTable.id, { onDelete: 'cascade' }),
    // The ingredient consumed (track_stock = true), in its own stock unit.
    ingredient_id: text('ingredient_id')
      .notNull()
      .references(() => productsTable.id, { onDelete: 'cascade' }),
    // Consumed per ONE unit sold. Scale 3 (not 2) so gram/ml-size amounts of
    // kg/L-stocked ingredients fit, e.g. 0.005 kg of garlic per portion.
    qty: numeric('qty', { precision: 12, scale: 3 }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('recipe_items_product_ingredient_idx').on(
      table.product_id,
      table.ingredient_id,
    ),
    index('recipe_items_outlet_idx').on(table.outlet_id),
  ],
);

// ============================================================================
// Outlet employees ("Karyawan"): staff accounts an OWNER creates for their
// outlet. An employee is a real users-row (own login) linked here with a
// page-level permission map the owner controls. One employment per account
// (user_id unique) keeps role resolution unambiguous. The number of ACTIVE
// employees is capped by the subscription plan's features.maxEmployees.
// Billing, employee management, and outlet settings are owner-only by
// construction — no permission key can grant them.
// ============================================================================
export const employeesTable = pgTable(
  'employees',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    outlet_id: integer('outlet_id')
      .notNull()
      .references(() => outletsTable.id),
    user_id: text('user_id')
      .notNull()
      .references(() => usersTable.id),
    // Page-level toggles, e.g. { cashier: true, reports: false } — keys are
    // the EMPLOYEE_PERMISSIONS list in lib/outlet-access.ts. Missing key =
    // no access.
    permissions: json('permissions')
      .$type<Record<string, boolean>>()
      .notNull()
      .default({}),
    is_active: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('employees_user_id_uq').on(t.user_id),
    index('employees_outlet_idx').on(t.outlet_id),
  ],
);

// ============================================================================
// SaaS subscription billing (platform-level — this is Ulun Pesan's OWN revenue,
// deliberately separate from the merchant's cashflow/invoices tables).
//
// Payment is MANUAL FIRST (merchant bank-transfers, our admin confirms), but the
// schema is shaped so a Xendit gateway can slot in later WITHOUT a rewrite: the
// manual bank-transfer columns and the (nullable) Xendit columns live side by
// side on subscription_payments, and both paths converge on the same
// "confirm payment -> extend period" transition. See [[project_railway_deploy]]
// tenancy note: subscription is per ACCOUNT/OWNER (users.id), because one owner
// can run several outlets that all share the one subscription.
// ============================================================================

// Tiers the merchant can subscribe to (gating limits live on subscription_plans
// .features, read by the access middleware — built later).
export const SUBSCRIPTION_TIER = pgEnum('subscription_tier', [
  'basic',
  'pro',
  'max_lite',
  'max',
]);
export const BILLING_INTERVAL = pgEnum('billing_interval', [
  'monthly',
  'yearly',
]);
export const SUBSCRIPTION_STATUS = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'expired',
  'canceled',
]);
// manual_transfer = merchant transfers + admin confirms (now).
// xendit = hosted invoice / gateway settlement (later).
export const SUBSCRIPTION_PAYMENT_METHOD = pgEnum(
  'subscription_payment_method',
  ['manual_transfer', 'xendit'],
);
// Covers both the manual flow (pending -> paid | rejected | expired) and the
// Xendit flow (pending -> paid | expired | failed | refunded).
export const SUBSCRIPTION_PAYMENT_STATUS = pgEnum(
  'subscription_payment_status',
  ['pending', 'paid', 'rejected', 'expired', 'failed', 'refunded'],
);
export const SUBSCRIPTION_ACTOR = pgEnum('subscription_actor', [
  'system',
  'admin',
  'merchant',
]);
export const NOTIFICATION_CHANNEL = pgEnum('notification_channel', [
  'email',
  'whatsapp',
  'in_app',
]);
export const NOTIFICATION_STATUS = pgEnum('notification_status', [
  'pending',
  'sent',
  'failed',
]);

// A purchasable plan = one (tier × interval) row with its price + feature caps.
export const subscriptionPlansTable = pgTable(
  'subscription_plans',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    tier: SUBSCRIPTION_TIER('tier').notNull(),
    interval: BILLING_INTERVAL('interval').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    // Base price in IDR. The amount a merchant actually transfers gets a small
    // unique suffix at payment time (subscription_payments.unique_code).
    price: numeric('price', { precision: 14, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('IDR'),
    // Trial length granted on first subscribe (0 = no trial for this plan).
    trial_days: integer('trial_days').notNull().default(0),
    // Feature flags / usage caps this tier unlocks, read by the gating
    // middleware. e.g. { "maxOutlets": 3, "desktopCashier": true }.
    features: json('features')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    is_active: boolean('is_active').notNull().default(true),
    sort_order: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('subscription_plans_tier_interval_idx').on(t.tier, t.interval),
  ],
);

// One subscription per account/owner. Access is granted while
// now() < current_period_end (the gating middleware may add a grace window).
export const subscriptionsTable = pgTable(
  'subscriptions',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    // Per ACCOUNT/OWNER (a user may own several outlets) — hangs off users.id,
    // NOT outlets.id. Middleware maps outlet -> outlets.user_id -> here.
    user_id: text('user_id')
      .notNull()
      .references(() => usersTable.id),
    plan_id: integer('plan_id').references(() => subscriptionPlansTable.id),
    // Cached tier so gating doesn't join subscription_plans on every request.
    tier: SUBSCRIPTION_TIER('tier'),
    status: SUBSCRIPTION_STATUS('status').notNull().default('trialing'),
    trial_ends_at: timestamp('trial_ends_at', { withTimezone: true }),
    current_period_start: timestamp('current_period_start', {
      withTimezone: true,
    }),
    current_period_end: timestamp('current_period_end', { withTimezone: true }),
    // Merchant asked to stop renewing; access still runs until period_end.
    cancel_at_period_end: boolean('cancel_at_period_end')
      .notNull()
      .default(false),
    canceled_at: timestamp('canceled_at', { withTimezone: true }),
    // Scheduled DOWNGRADE (Model 2): a confirmed lower-tier payment does not
    // flip the tier immediately — the merchant keeps what they paid for until
    // next_tier_at (the old period's end), when a lazy read applies next_* and
    // clears them. Upgrades never sit here (they apply instantly, converting
    // remaining value into bonus days at the new tier's daily rate).
    next_plan_id: integer('next_plan_id').references(() => subscriptionPlansTable.id),
    next_tier: SUBSCRIPTION_TIER('next_tier'),
    next_tier_at: timestamp('next_tier_at', { withTimezone: true }),
    // Marketing deal: percentage off, optionally scoped to one tier and/or one
    // interval (NULL scope = applies to any). 0 = no deal. Applied at payment
    // creation and snapshotted onto the payment row.
    discount_pct: numeric('discount_pct', { precision: 5, scale: 2 })
      .notNull()
      .default('0'),
    discount_tier: SUBSCRIPTION_TIER('discount_tier'),
    discount_interval: BILLING_INTERVAL('discount_interval'),
    discount_note: varchar('discount_note', { length: 255 }).default(''),
    // Xendit-ready (nullable until the gateway migration): maps this account to
    // a Xendit customer for hosted invoices / future recurring plans.
    xendit_customer_id: varchar('xendit_customer_id', { length: 255 }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('subscriptions_user_id_idx').on(t.user_id),
    index('subscriptions_status_period_idx').on(
      t.status,
      t.current_period_end,
    ),
  ],
);

// One row per payment attempt/renewal. Manual bank-transfer columns and the
// (nullable) Xendit columns coexist so the gateway path reuses this table.
export const subscriptionPaymentsTable = pgTable(
  'subscription_payments',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    subscription_id: integer('subscription_id')
      .notNull()
      .references(() => subscriptionsTable.id),
    // Denormalised owner for the admin queue / direct lookups.
    user_id: text('user_id')
      .notNull()
      .references(() => usersTable.id),
    plan_id: integer('plan_id')
      .notNull()
      .references(() => subscriptionPlansTable.id),
    // Snapshots so a later plan price/def change can't rewrite history.
    tier: SUBSCRIPTION_TIER('tier').notNull(),
    interval: BILLING_INTERVAL('interval').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('IDR'),
    // Base plan price...
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    // Marketing-deal percentage applied to THIS payment (snapshot; the live
    // deal lives on subscriptions). amount stays the base plan price.
    discount_pct: numeric('discount_pct', { precision: 5, scale: 2 })
      .notNull()
      .default('0'),
    // ...and the unique-amount matching trick: unique_code (e.g. 237) is added
    // to the discounted price so admin can auto-match a bank transfer to THIS
    // record. amount_due = discounted amount + unique_code = actual transfer.
    unique_code: integer('unique_code').notNull().default(0),
    amount_due: numeric('amount_due', { precision: 14, scale: 2 }).notNull(),
    method: SUBSCRIPTION_PAYMENT_METHOD('method')
      .notNull()
      .default('manual_transfer'),
    status: SUBSCRIPTION_PAYMENT_STATUS('status').notNull().default('pending'),
    // The access window this payment grants; on confirm the subscription's
    // current_period_end is set/extended to period_end.
    period_start: timestamp('period_start', { withTimezone: true }),
    period_end: timestamp('period_end', { withTimezone: true }),
    // Set when an UPGRADE consumed this segment's remaining value (converted to
    // bonus days on the new plan) — consumed segments never count twice.
    converted_at: timestamp('converted_at', { withTimezone: true }),
    // After this an unpaid pending payment is void (manual quote / Xendit invoice
    // expiry).
    expires_at: timestamp('expires_at', { withTimezone: true }),
    paid_at: timestamp('paid_at', { withTimezone: true }),

    // --- Manual bank-transfer fields (method = manual_transfer) ---
    proof_image: varchar('proof_image', { length: 255 }),
    sender_bank: varchar('sender_bank', { length: 100 }),
    sender_name: varchar('sender_name', { length: 255 }),
    transfer_date: timestamp('transfer_date', { withTimezone: true }),
    merchant_note: varchar('merchant_note', { length: 500 }),

    // --- Admin review / audit (manual confirm) ---
    reviewed_by: text('reviewed_by').references(() => usersTable.id),
    reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
    review_note: varchar('review_note', { length: 500 }),

    // --- Xendit-ready (all nullable until the gateway migration) ---
    // external_id = OUR idempotency key sent to Xendit (e.g. "subpay-<id>").
    external_id: varchar('external_id', { length: 255 }),
    xendit_invoice_id: varchar('xendit_invoice_id', { length: 255 }),
    xendit_payment_request_id: varchar('xendit_payment_request_id', {
      length: 255,
    }),
    // Hosted checkout URL Xendit returns; where the merchant pays.
    invoice_url: text('invoice_url'),
    // Concrete rail Xendit settled on (BCA VA, QRIS, OVO, ...).
    payment_channel: varchar('payment_channel', { length: 50 }),
    // Raw webhook body kept verbatim for audit / dispute.
    gateway_payload: json('gateway_payload'),
    ...timestamps,
  },
  (t) => [
    index('subscription_payments_user_idx').on(t.user_id),
    index('subscription_payments_subscription_idx').on(t.subscription_id),
    index('subscription_payments_status_idx').on(t.status),
    // Manual reconciliation: look up a pending payment by the exact transfer.
    index('subscription_payments_amount_due_idx').on(t.amount_due),
    // Nullable + unique: Postgres treats NULLs as distinct, so manual rows
    // (external_id/xendit_invoice_id = NULL) never collide.
    uniqueIndex('subscription_payments_external_id_idx').on(t.external_id),
    uniqueIndex('subscription_payments_xendit_invoice_idx').on(
      t.xendit_invoice_id,
    ),
  ],
);

// Append-only audit trail: every lifecycle change (submit/confirm/reject/renew/
// upgrade/expire/cancel), who did it, and what changed.
export const subscriptionEventsTable = pgTable(
  'subscription_events',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    subscription_id: integer('subscription_id')
      .notNull()
      .references(() => subscriptionsTable.id),
    user_id: text('user_id')
      .notNull()
      .references(() => usersTable.id),
    payment_id: integer('payment_id').references(
      () => subscriptionPaymentsTable.id,
    ),
    // Freeform verb, e.g. 'payment_submitted','payment_confirmed','renewed',
    // 'upgraded','expired','trial_started'. String (not enum) so new event kinds
    // don't each need a migration.
    type: varchar('type', { length: 50 }).notNull(),
    actor: SUBSCRIPTION_ACTOR('actor').notNull().default('system'),
    // users.id of the acting admin/merchant when actor != system.
    actor_id: text('actor_id').references(() => usersTable.id),
    detail: json('detail'),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('subscription_events_subscription_idx').on(
      t.subscription_id,
      t.created_at,
    ),
  ],
);

// Notify outbox: durable, retryable record of merchant-facing notifications
// (payment confirmed/rejected, expiring soon, expired). A dispatcher drains
// status = 'pending'; in_app rows are also read straight from here.
export const subscriptionNotificationsTable = pgTable(
  'subscription_notifications',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    user_id: text('user_id')
      .notNull()
      .references(() => usersTable.id),
    subscription_id: integer('subscription_id').references(
      () => subscriptionsTable.id,
    ),
    event_id: integer('event_id').references(() => subscriptionEventsTable.id),
    channel: NOTIFICATION_CHANNEL('channel').notNull().default('in_app'),
    // e.g. 'payment_confirmed','payment_rejected','expiring_soon','expired'.
    type: varchar('type', { length: 50 }).notNull(),
    title: varchar('title', { length: 255 }),
    body: varchar('body', { length: 1000 }),
    status: NOTIFICATION_STATUS('status').notNull().default('pending'),
    // email/wa: when dispatched. in_app: read_at is when the merchant saw it.
    sent_at: timestamp('sent_at', { withTimezone: true }),
    read_at: timestamp('read_at', { withTimezone: true }),
    payload: json('payload'),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('subscription_notifications_user_idx').on(t.user_id, t.status),
  ],
);
