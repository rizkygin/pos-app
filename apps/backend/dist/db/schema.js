"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUBSCRIPTION_TIER = exports.employeesTable = exports.recipeItemsTable = exports.stockMovementsTable = exports.invoicePaymentsTable = exports.invoiceItemsTable = exports.invoicesTable = exports.suppliersTable = exports.verification = exports.account = exports.session = exports.courierSessionsTable = exports.productAdsTable = exports.productAdsSchedule = exports.scheduleProductAdsTable = exports.promosTable = exports.cashFlows = exports.cashOutDetailTable = exports.cashInDetailTable = exports.cashOutCategoryTable = exports.cashInCategoryTable = exports.ratingsTable = exports.orderDetailsTable = exports.errandOrdersTable = exports.orderOffersTable = exports.ordersTable = exports.productsTable = exports.courierDocumentsTable = exports.couriersTable = exports.serviceAreaTable = exports.customersTable = exports.adminsTable = exports.outletsTable = exports.locationsTable = exports.usersTable = exports.STOCK_MOVEMENT_REASON = exports.INVOICE_STATUS = exports.INVOICE_TYPE = exports.AD_STATUS = exports.REJECTED_BY = exports.CASHFLOWS_TRANSACTION_TYPE = exports.RECIEPENT = exports.ERRAND_STATUS = exports.ORDER_FULFILLMENT = exports.ORDER_STATUS = exports.STATUS = exports.COURIER_DOCUMENT_KIND = exports.OFFER_STATE = exports.COURIER_VERIFICATION_STATUS = exports.VEHICLE_TYPE = void 0;
exports.menuGroupsTable = exports.courierDevicesTable = exports.pushSubscriptionsTable = exports.subscriptionNotificationsTable = exports.subscriptionEventsTable = exports.subscriptionPaymentsTable = exports.subscriptionsTable = exports.subscriptionPlansTable = exports.NOTIFICATION_STATUS = exports.NOTIFICATION_CHANNEL = exports.SUBSCRIPTION_ACTOR = exports.SUBSCRIPTION_PAYMENT_STATUS = exports.SUBSCRIPTION_PAYMENT_METHOD = exports.SUBSCRIPTION_STATUS = exports.BILLING_INTERVAL = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const drizzle_orm_1 = require("drizzle-orm");
const columns_helper_1 = require("./columns.helper");
exports.VEHICLE_TYPE = (0, pg_core_1.pgEnum)('vechile_type', ['car', 'motorcycle']);
// A courier carries other people's money and goods to strangers' front doors,
// so joining is an application an admin decides on, not a signup that completes
// itself. 'rejected' is a real state rather than a deletion: the applicant is
// told why and can replace the offending photos.
exports.COURIER_VERIFICATION_STATUS = (0, pg_core_1.pgEnum)('courier_verification_status', [
    'pending',
    'approved',
    'rejected',
]);
// A dispatch offer's life. 'superseded' is separate from 'expired' on purpose:
// expired means a courier was given the order and let the clock run out (which
// belongs in their record), superseded means dispatch moved on for a reason
// that isn't their fault — the order was cancelled, or somebody else got there
// first through the open pool.
exports.OFFER_STATE = (0, pg_core_1.pgEnum)('offer_state', [
    'offered',
    'accepted',
    'declined',
    'expired',
    'superseded',
]);
// The exact set an applicant must produce. Fixed slots, not a free-form gallery:
// an admin comparing a face against a SIM photo needs to know which shot is
// which, and a missing angle has to be nameable ("foto kiri belum ada").
exports.COURIER_DOCUMENT_KIND = (0, pg_core_1.pgEnum)('courier_document_kind', [
    'face_front',
    'face_right',
    'face_left',
    'face_back',
    'stnk',
    'sim_c',
    'vehicle_front',
    'vehicle_right',
    'vehicle_left',
    'vehicle_back',
]);
exports.STATUS = (0, pg_core_1.pgEnum)('state', ['addToChart', 'checkout']);
exports.ORDER_STATUS = (0, pg_core_1.pgEnum)('order_status', [
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
// materials = bulky goods (besi, keramik, kulkas) the outlet delivers with its
// own driver. No courier either, but unlike service the goods have fixed prices
// and real stock — what the owner quotes is the haul, into orders.delivery_fee,
// capped by the products' [lowest_price, highest_price] band.
exports.ORDER_FULFILLMENT = (0, pg_core_1.pgEnum)('order_fulfillment', [
    'delivery',
    'service',
    'materials',
]);
// "Suruh Kurir": a courier hired directly, with no outlet and no products in
// the picture. Deliberately its OWN enum and its own table rather than a fourth
// ORDER_FULFILLMENT value — an errand has no outlet_id, no order_details and no
// cash-in, so folding it into orders would have meant making outlet_id nullable
// and auditing every innerJoin(outletsTable) in the codebase for rows that
// would otherwise vanish silently rather than error.
//
// Three distinct rejection states, not one 'cancelled' plus a reason string:
// the courier declining (before any price exists), the customer turning down
// the price he quoted, and the customer backing out of a job already under way
// have different consequences — only the last starts the customer's cooldown —
// and a status can be indexed where a reason cannot.
exports.ERRAND_STATUS = (0, pg_core_1.pgEnum)('errand_status', [
    'pending',
    'on_delivery',
    'delivered',
    'rejected_by_courier',
    'rejected_by_customer',
    'cancelled_by_customer',
]);
exports.RECIEPENT = (0, pg_core_1.pgEnum)('receipt', [
    'customer',
    'courier',
    'outlet',
    'product',
]);
exports.CASHFLOWS_TRANSACTION_TYPE = (0, pg_core_1.pgEnum)('cashflows_transaction_type', [
    'transfer',
    'cash',
]);
exports.REJECTED_BY = (0, pg_core_1.pgEnum)('rejected_by', [
    'courier',
    'customer',
    'owner',
]);
exports.AD_STATUS = (0, pg_core_1.pgEnum)('ad_status', [
    'pending',
    'approved',
    'rejected',
]);
// --- Invoicing & inventory ---
// sales = faktur penjualan (stock OUT, becomes cash IN when paid)
// purchase = faktur pembelian (stock IN, becomes cash OUT when paid)
exports.INVOICE_TYPE = (0, pg_core_1.pgEnum)('invoice_type', ['sales', 'purchase']);
// draft  -> nothing posted yet (editable, no stock/no receivable)
// posted -> finalised: stock moved, amount owed/owing recorded, not yet paid
// partial-> partially paid
// paid   -> fully paid (cashflow entry created)
// void   -> cancelled: stock movements reversed
exports.INVOICE_STATUS = (0, pg_core_1.pgEnum)('invoice_status', [
    'draft',
    'posted',
    'partial',
    'paid',
    'void',
]);
exports.STOCK_MOVEMENT_REASON = (0, pg_core_1.pgEnum)('stock_movement_reason', [
    'purchase',
    'sales',
    'adjustment',
    'void',
]);
exports.usersTable = (0, pg_core_1.pgTable)('users', {
    id: (0, pg_core_1.text)('id').primaryKey(),
    name: (0, pg_core_1.varchar)('name', { length: 255 }).notNull(),
    // Canonical 628… form — see lib/utils/phone.ts. Everything that writes here
    // must go through normalizeIndonesianPhone, or the column drifts back into
    // holding six spellings of one number.
    // Unique since "Suruh Kurir": a courier identifies the customer he is about
    // to deal with by looking their number up, and a number shared by two
    // accounts makes that lookup meaningless.
    //
    // The DEFAULT is gone on purpose. It used to be the literal '082222222222',
    // which under a unique constraint means the first signup succeeds and every
    // signup after it dies on a constraint violation. Nullable rather than
    // notNull because Postgres allows unlimited NULLs under UNIQUE — that is what
    // the placeholder rows were migrated to. A user with a null phone simply
    // cannot be reached, and cannot use Suruh Kurir until they set one.
    phone: (0, pg_core_1.varchar)('phone', { length: 255 }).unique(),
    // When the user last CHANGED their number, gating the one-per-month limit.
    // Null means never changed, so the first edit is free: a typo caught right
    // after signup shouldn't cost someone a month of being uncontactable.
    phone_changed_at: (0, pg_core_1.timestamp)('phone_changed_at', { withTimezone: true }),
    email: (0, pg_core_1.varchar)('email', { length: 255 }).notNull().unique(),
    address: (0, pg_core_1.varchar)('address', { length: 255 }).default('Jl. Contoh'),
    emailVerified: (0, pg_core_1.boolean)('email_verified').default(false).notNull(),
    image: (0, pg_core_1.text)('image').default('avatar.png'),
    ...columns_helper_1.timestamps,
});
exports.locationsTable = (0, pg_core_1.pgTable)('locations', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    user_id: (0, pg_core_1.text)('user_id')
        .notNull()
        .references(() => exports.usersTable.id),
    label: (0, pg_core_1.varchar)('label', { length: 100 }).notNull().default('Rumah'),
    address: (0, pg_core_1.varchar)('address', { length: 255 }).notNull(),
    lat: (0, pg_core_1.varchar)('lat', { length: 255 }).notNull(),
    lon: (0, pg_core_1.varchar)('lon', { length: 255 }).notNull(),
    note: (0, pg_core_1.varchar)('note', { length: 255 }).default(''),
    is_default: (0, pg_core_1.boolean)('is_default').default(false).notNull(),
    ...columns_helper_1.timestamps,
});
exports.outletsTable = (0, pg_core_1.pgTable)('outlets', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedAlwaysAsIdentity(),
    name: (0, pg_core_1.varchar)('name', { length: 255 }).notNull(),
    address: (0, pg_core_1.varchar)('address', { length: 255 }).notNull(),
    lat: (0, pg_core_1.varchar)('lat', { length: 255 }).notNull(),
    lon: (0, pg_core_1.varchar)('lon', { length: 255 }).notNull(),
    phone: (0, pg_core_1.varchar)('phone', { length: 255 }).notNull(),
    email: (0, pg_core_1.varchar)('email', { length: 255 }).notNull().unique(),
    user_id: (0, pg_core_1.text)('user_id')
        .notNull()
        .references(() => exports.usersTable.id),
    avatar: (0, pg_core_1.varchar)('avatar', { length: 255 }).notNull().default('avatar.png'),
    ratings: (0, pg_core_1.numeric)('ratings', { precision: 3, scale: 2 }).default('5'),
    review_count: (0, pg_core_1.integer)('review_count').default(0).notNull(),
    tags: (0, pg_core_1.text)('tags').array().default([]).notNull(),
    features: (0, pg_core_1.text)('features').array().default([]).notNull(),
    is_open: (0, pg_core_1.boolean)('is_open').default(true).notNull(),
    // Can a courier actually reach this outlet? Cached, not derived on read: the
    // order lobby polls four endpoints every two seconds, and the answer only
    // changes when the outlet moves or an admin redraws the coverage circle.
    //
    // Deliberately overridable by an admin. The circle approximates where couriers
    // go — it is not the territory — so a shop just outside the line that is in
    // fact served should be markable without distorting the geometry for everyone.
    //
    // Defaults true: inert until an admin configures an area, matching the
    // "unset means permissive" rule the rest of this feature follows.
    courier_reachable: (0, pg_core_1.boolean)('courier_reachable').default(true).notNull(),
    ...columns_helper_1.timestamps,
});
exports.adminsTable = (0, pg_core_1.pgTable)('admins', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    user_id: (0, pg_core_1.text)('user_id')
        .notNull()
        .references(() => exports.usersTable.id),
    name: (0, pg_core_1.varchar)('name', { length: 255 }).notNull(),
    email: (0, pg_core_1.varchar)('email', { length: 255 }).notNull().unique(),
    ...columns_helper_1.timestamps,
});
exports.customersTable = (0, pg_core_1.pgTable)('customers', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    user_id: (0, pg_core_1.text)('user_id')
        .notNull()
        .references(() => exports.usersTable.id),
    ratings: (0, pg_core_1.numeric)('ratings', { precision: 3, scale: 2 }).default('5'),
    review_count: (0, pg_core_1.integer)('review_count').default(0).notNull(),
    ...columns_helper_1.timestamps,
}, (table) => [
    // One LIVE customer row per account, enforced in the database rather than
    // only in the handler. /api/register-role checks first, but that is
    // check-then-insert: two submits landing together can both pass the check.
    // The form's disabled button and the endpoint's guard are the friendly
    // errors; this is the one that cannot be raced.
    //
    // Partial, because removal is soft here. A full unique index would outlaw
    // the perfectly normal history of "registered, removed by an admin,
    // registered again" — real rows in the dev database look exactly like that.
    (0, pg_core_1.uniqueIndex)('customers_user_id_uq')
        .on(table.user_id)
        .where((0, drizzle_orm_1.sql) `deleted_at IS NULL`),
]);
/**
 * The area Ulun Pesan's couriers actually serve, as a centre + radius.
 *
 * Single logical row — read as "the newest one wins" rather than enforced by a
 * constraint, so changing it leaves an audit trail of who moved the centre and
 * when instead of silently overwriting.
 *
 * Straight-line radius, deliberately. This answers "do we operate here at all",
 * a coarse business question, and a circle is something an admin can reason
 * about and draw on a map. The per-order 50 km cap is separate and measured by
 * ROAD (see MAX_DELIVERY_KM in routes/orders.ts) — that one decides whether a
 * specific delivery is viable.
 *
 * numeric, not varchar: empty strings and the literal 'NaN' are how coordinates
 * got poisoned before (see migration 0041 and the repair preceding it).
 */
exports.serviceAreaTable = (0, pg_core_1.pgTable)('service_area', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    center_lat: (0, pg_core_1.numeric)('center_lat', { precision: 10, scale: 7 }).notNull(),
    center_lon: (0, pg_core_1.numeric)('center_lon', { precision: 10, scale: 7 }).notNull(),
    radius_km: (0, pg_core_1.integer)('radius_km').notNull().default(50),
    // Who last moved it. Null-safe on user deletion — the history of the change
    // matters more than being able to name the admin forever.
    updated_by: (0, pg_core_1.text)('updated_by').references(() => exports.usersTable.id, { onDelete: 'set null' }),
    ...columns_helper_1.timestamps,
});
exports.couriersTable = (0, pg_core_1.pgTable)('couriers', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    user_id: (0, pg_core_1.text)('user_id')
        .notNull()
        .references(() => exports.usersTable.id),
    avatar: (0, pg_core_1.varchar)('avatar', { length: 255 })
        .notNull()
        .default('avatar-courier.png'),
    vehicle_plate: (0, pg_core_1.varchar)('vehicle_plate', { length: 255 }).notNull(),
    vehicle_type: (0, exports.VEHICLE_TYPE)('vehicle_type').notNull(),
    ratings: (0, pg_core_1.numeric)('ratings', { precision: 3, scale: 2 }).default('5'),
    review_count: (0, pg_core_1.integer)('review_count').default(0).notNull(),
    // Last reported position, for the customer's live delivery ETA. Only written
    // while the courier has an order in flight — this is not a movement history,
    // just "where are they now", overwritten in place.
    //
    // numeric, NOT varchar like outlets.lat/locations.lat. Those are strings, and
    // a varchar happily stored '' and the literal text 'NaN', which is exactly how
    // coordinates poisoned the map picker (see migration 0041). Postgres rejects
    // both here.
    last_lat: (0, pg_core_1.numeric)('last_lat', { precision: 10, scale: 7 }),
    last_lon: (0, pg_core_1.numeric)('last_lon', { precision: 10, scale: 7 }),
    // Staleness marker: a position from 40 minutes ago is not "live", and the ETA
    // must fall back rather than quietly present it as current.
    last_location_at: (0, pg_core_1.timestamp)('last_location_at', { withTimezone: true }),
    // Document review. Defaults to 'pending' so every future applicant goes
    // through an admin; migration 0048 backfills the couriers who already exist
    // to 'approved', because they were vetted by whatever process predates this
    // and taking them off the road on deploy day would be an outage, not a policy.
    verification_status: (0, exports.COURIER_VERIFICATION_STATUS)('verification_status')
        .notNull()
        .default('pending'),
    // Why an application was rejected, shown verbatim to the applicant — a
    // rejection they can't act on just produces the same photos again.
    verification_note: (0, pg_core_1.varchar)('verification_note', { length: 500 }),
    verified_at: (0, pg_core_1.timestamp)('verified_at', { withTimezone: true }),
    verified_by: (0, pg_core_1.text)('verified_by').references(() => exports.usersTable.id),
    ...columns_helper_1.timestamps,
}, (table) => [
    // Same reasoning, same partial condition as customers_user_id_uq. The
    // register-role guard applies the identical "live rows only" rule: the two
    // must never disagree, or a submit the handler waves through dies on a
    // constraint violation instead of getting a readable 409.
    (0, pg_core_1.uniqueIndex)('couriers_user_id_uq')
        .on(table.user_id)
        .where((0, drizzle_orm_1.sql) `deleted_at IS NULL`),
]);
/**
 * The photos an applicant submits, one row per required slot.
 *
 * Unique on (courier_id, kind) so re-uploading a rejected angle replaces it
 * rather than piling up: an admin must always be looking at the current answer
 * for each slot, never at a stack they have to date-sort first.
 */
exports.courierDocumentsTable = (0, pg_core_1.pgTable)('courier_documents', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    courier_id: (0, pg_core_1.integer)('courier_id')
        .notNull()
        .references(() => exports.couriersTable.id, { onDelete: 'cascade' }),
    kind: (0, exports.COURIER_DOCUMENT_KIND)('kind').notNull(),
    image: (0, pg_core_1.varchar)('image', { length: 255 }).notNull(),
    ...columns_helper_1.timestamps,
}, (table) => [
    (0, pg_core_1.uniqueIndex)('courier_documents_courier_kind_uq').on(table.courier_id, table.kind),
]);
exports.productsTable = (0, pg_core_1.pgTable)('products', {
    id: (0, pg_core_1.text)('id').primaryKey(),
    product_name: (0, pg_core_1.varchar)('product_name', { length: 255 }).notNull(),
    price: (0, pg_core_1.varchar)('price', { length: 10 }).notNull(),
    price_mark_down: (0, pg_core_1.varchar)('price_mark_down', { length: 10 }).notNull(),
    // Service products are priced as a negotiable range instead of a fixed price.
    // When these are set the product is a "service product": the customer sees
    // "mulai dari" lowest_price (price is mirrored to lowest_price), and the owner
    // picks the actual price within [lowest, highest] when confirming the order.
    lowest_price: (0, pg_core_1.varchar)('lowest_price', { length: 15 }),
    highest_price: (0, pg_core_1.varchar)('highest_price', { length: 15 }),
    buying_price: (0, pg_core_1.varchar)('buying_price', { length: 15 })
        .notNull()
        .default('0'),
    outlet_id: (0, pg_core_1.integer)('outlet_id')
        .notNull()
        .references(() => exports.outletsTable.id),
    ratings: (0, pg_core_1.numeric)('ratings', { precision: 3, scale: 2 }).default('5'),
    image: (0, pg_core_1.varchar)('image', { length: 255 }).notNull().default('avatar.png'),
    category: (0, pg_core_1.varchar)('category', { length: 255 })
        .notNull(),
    // Owner's own menu section for the public /menu page (see menuGroupsTable).
    // NOT a replacement for `category` above: that one is a fixed platform list
    // driving the marketplace feature browse. Null = ungrouped, which the menu
    // page falls back to rendering under the product's category.
    // onDelete: set null — deleting a section must ungroup its products, never
    // delete them. Lazy thunk because menuGroupsTable is declared further down.
    menu_group_id: (0, pg_core_1.integer)('menu_group_id').references(() => exports.menuGroupsTable.id, { onDelete: 'set null' }),
    isAvailable: (0, pg_core_1.boolean)('is_available').default(true).notNull(),
    // false = inventory-only item: tracked in stock and usable on invoices, but
    // hidden from the customer ordering flow (customers can't pick it).
    is_for_sale: (0, pg_core_1.boolean)('is_for_sale').default(true).notNull(),
    // false = this product has no countable stock of its own (a recipe/menu item
    // made from ingredients, or a service). Invoice posting only moves stock for
    // track_stock products; the Stok page only lists them.
    track_stock: (0, pg_core_1.boolean)('track_stock').default(true).notNull(),
    // false = a courier can NOT carry this (besi, keramik, wastafel, a fridge).
    // Set by the owner in the product form — they're the one who knows the
    // goods. Building materials are deliberately NOT uniformly courier-less:
    // semen/cat/paku ride a motorcycle fine. Read at checkout to decide the
    // order's fulfillment (all items deliverable -> courier flow; any item not
    // -> the no-courier flow), never by the customer. Default true so every
    // existing product keeps its current behaviour.
    courier_deliverable: (0, pg_core_1.boolean)('courier_deliverable').default(true).notNull(),
    description: (0, pg_core_1.varchar)('description', { length: 255 }).default(''),
    unit: (0, pg_core_1.varchar)('unit', { length: 10 }).notNull().default('pcs'),
    // Optional — mainly for "mart"/retail goods, but available on any category
    // (packaged drinks, building materials, etc. can carry a real barcode too).
    // Unique per outlet (see products_outlet_barcode_uq below) so a future
    // barcode-scanner checkout can look a code up unambiguously; NULL is exempt
    // from the constraint, so any number of products can go without one.
    barcode: (0, pg_core_1.varchar)('barcode', { length: 64 }),
    features: (0, pg_core_1.text)('features').array().default([]).notNull(),
    is_recommended: (0, pg_core_1.boolean)('is_recommended').default(false).notNull(),
    discount_percent: (0, pg_core_1.integer)('discount_percent'),
    review_count: (0, pg_core_1.integer)('review_count').default(0).notNull(),
    // Cached on-hand quantity. Source of truth is the stockMovementsTable ledger;
    // this column is the running balance kept in sync when a movement is posted.
    // numeric (not integer) so weight/volume units (kg, liter) can be fractional.
    // Scale 3 matches recipe_items.qty so gram/ml-size recipe decrements
    // (e.g. 0.005 kg per portion) survive the write without rounding.
    stock: (0, pg_core_1.numeric)('stock', { precision: 12, scale: 3 }).notNull().default('0'),
    ...columns_helper_1.timestamps,
}, (table) => [
    (0, pg_core_1.index)('products_available_deleted_idx').on(table.isAvailable, table.deletedAt),
    (0, pg_core_1.index)('products_outlet_id_idx').on(table.outlet_id),
    (0, pg_core_1.uniqueIndex)('products_outlet_barcode_uq').on(table.outlet_id, table.barcode),
]);
exports.ordersTable = (0, pg_core_1.pgTable)('orders', {
    id: (0, pg_core_1.text)('id').primaryKey(),
    customer_id: (0, pg_core_1.integer)('customer_id')
        .notNull()
        .references(() => exports.customersTable.id),
    courier_id: (0, pg_core_1.integer)('courier_id').references(() => exports.couriersTable.id),
    outlet_id: (0, pg_core_1.integer)('outlet_id')
        .notNull()
        .references(() => exports.outletsTable.id),
    fulfillment: (0, exports.ORDER_FULFILLMENT)('fulfillment').default('delivery').notNull(),
    status: (0, exports.ORDER_STATUS)('status').default('pending').notNull(),
    promo_id: (0, pg_core_1.integer)('promo_id').references(() => exports.promosTable.id),
    discount_amount: (0, pg_core_1.varchar)('discount_amount', { length: 15 }),
    delivery_fee: (0, pg_core_1.varchar)('delivery_fee', { length: 15 }),
    scheduled_at: (0, pg_core_1.timestamp)('scheduled_at', { withTimezone: true }),
    note: (0, pg_core_1.json)('note'),
    rejected_by: (0, exports.REJECTED_BY)('rejected_by'),
    rejected_reason: (0, pg_core_1.varchar)('rejected_reason', { length: 255 }),
    // Set when sequential dispatch has run out of couriers to offer this order
    // to. From that moment it falls back to the old free-for-all lobby, visible
    // to everyone who is online — a stuck order helps nobody, so exhausting the
    // queue must degrade to "anyone can take it", never to silence.
    offer_pool_opened_at: (0, pg_core_1.timestamp)('offer_pool_opened_at', { withTimezone: true }),
    ...columns_helper_1.timestamps,
}, (table) => [
    (0, pg_core_1.index)('id_idx').on(table.id),
    (0, pg_core_1.index)('costomer_id_idx').on(table.customer_id),
    (0, pg_core_1.index)('courier_id_idx').on(table.courier_id),
    (0, pg_core_1.index)('outlet_id_idx').on(table.outlet_id),
    (0, pg_core_1.index)('orders_outlet_status_idx').on(table.outlet_id, table.status),
    (0, pg_core_1.index)('orders_courier_status_idx').on(table.courier_id, table.status),
]);
/**
 * One order offered to one courier, with a clock on it.
 *
 * This replaces first-come-first-served. Under the old rule every online
 * courier saw every confirmed order and the fastest tap won, which meant the
 * only way to earn was to sit staring at the lobby — the exact behaviour that
 * makes couriers keep the app open in traffic.
 *
 * Offers are sequential: at most one live offer per order, enforced by the
 * partial unique index below. When it expires or is declined the next courier
 * gets it, and when the queue is exhausted the order falls back to the open
 * pool (orders.offer_pool_opened_at).
 *
 * Rows are kept after they resolve. Who was offered what, and who let the clock
 * run out, is the record behind any later argument about fairness.
 */
exports.orderOffersTable = (0, pg_core_1.pgTable)('order_offers', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    order_id: (0, pg_core_1.text)('order_id')
        .notNull()
        .references(() => exports.ordersTable.id, { onDelete: 'cascade' }),
    courier_id: (0, pg_core_1.integer)('courier_id')
        .notNull()
        .references(() => exports.couriersTable.id, { onDelete: 'cascade' }),
    state: (0, exports.OFFER_STATE)('state').notNull().default('offered'),
    // Which pass through the courier list this was. A second round happens only
    // after everyone has been asked once, so it doubles as "how hard is this
    // order to place" — useful when an outlet keeps getting passed over.
    round: (0, pg_core_1.integer)('round').notNull().default(1),
    offered_at: (0, pg_core_1.timestamp)('offered_at', { withTimezone: true }).defaultNow().notNull(),
    expires_at: (0, pg_core_1.timestamp)('expires_at', { withTimezone: true }).notNull(),
    responded_at: (0, pg_core_1.timestamp)('responded_at', { withTimezone: true }),
    ...columns_helper_1.timestamps,
}, (table) => [
    // The core invariant: an order can have only one offer in flight. Two live
    // offers would recreate the race this whole table exists to remove.
    (0, pg_core_1.uniqueIndex)('order_offers_one_live_per_order')
        .on(table.order_id)
        .where((0, drizzle_orm_1.sql) `${table.state} = 'offered'`),
    (0, pg_core_1.index)('order_offers_courier_state_idx').on(table.courier_id, table.state),
    (0, pg_core_1.index)('order_offers_expiry_idx').on(table.state, table.expires_at),
]);
/**
 * A courier hired directly by a customer — "Suruh Kurir".
 *
 * Mirrors ordersTable in spirit but shares none of its machinery. There is no
 * outlet, no products, no order_details, no promo and no cash-in: the courier
 * names his own price, collects it himself, and the platform takes nothing.
 * That is why errands are absent from every revenue and outlet report — not an
 * oversight, a deliberate exclusion.
 *
 * It also never enters dispatch. Regular orders are broadcast to a ranked queue
 * of couriers (see orderOffersTable); an errand is aimed at ONE courier the
 * customer picked by name, so there is nothing to rank and no queue to exhaust.
 *
 * The negotiation itself happens on WhatsApp, outside the app. What lands here
 * is only the outcome: the courier accepts with a price, or declines.
 */
exports.errandOrdersTable = (0, pg_core_1.pgTable)('errand_orders', {
    id: (0, pg_core_1.text)('id').primaryKey(),
    // Straight to users, not customers. An errand needs a name, a phone and a
    // saved address — all of which live on users — and nothing customersTable
    // adds. Skipping it also means a courier can hire another courier.
    user_id: (0, pg_core_1.text)('user_id')
        .notNull()
        .references(() => exports.usersTable.id),
    courier_id: (0, pg_core_1.integer)('courier_id')
        .notNull()
        .references(() => exports.couriersTable.id),
    status: (0, exports.ERRAND_STATUS)('status').notNull().default('pending'),
    // What the customer wants done, in their own words.
    note: (0, pg_core_1.text)('note'),
    // The courier's own quote, written when he accepts. Null while pending —
    // nobody, including the system, knows the price before then. varchar to
    // match orders.delivery_fee rather than introduce a second money type.
    price: (0, pg_core_1.varchar)('price', { length: 15 }),
    rejected_reason: (0, pg_core_1.varchar)('rejected_reason', { length: 255 }),
    // SNAPSHOT of the customer's default saved location (locationsTable), not a
    // reference to it. A location row is editable: pointing at it would let a
    // customer renaming "Rumah" months later silently rewrite where a finished
    // errand was delivered.
    //
    // numeric, like couriers.last_lat/lon and deliberately NOT the varchar used
    // by outlets and locations — those columns accepted '' and the literal
    // 'NaN', which is how coordinates poisoned the map picker (migration 0041).
    pickup_address: (0, pg_core_1.varchar)('pickup_address', { length: 255 }),
    pickup_lat: (0, pg_core_1.numeric)('pickup_lat', { precision: 10, scale: 7 }),
    pickup_lon: (0, pg_core_1.numeric)('pickup_lon', { precision: 10, scale: 7 }),
    accepted_at: (0, pg_core_1.timestamp)('accepted_at', { withTimezone: true }),
    delivered_at: (0, pg_core_1.timestamp)('delivered_at', { withTimezone: true }),
    ...columns_helper_1.timestamps,
}, (table) => [
    // Exclusivity, enforced by Postgres rather than by a handler. A courier
    // holds at most one pending request at a time, so two customers tapping the
    // same courier in the same instant resolve to one winner and one 409. A
    // read-then-write check in application code cannot win that race.
    //
    // Only 'pending' is constrained: once accepted the job moves to
    // on_delivery, and the courier is then held busy by getCourierAvailability
    // instead — see lib/utils/courier-availability.ts.
    (0, pg_core_1.uniqueIndex)('errand_orders_courier_pending_uq')
        .on(table.courier_id)
        .where((0, drizzle_orm_1.sql) `status = 'pending'`),
    (0, pg_core_1.index)('errand_orders_user_status_idx').on(table.user_id, table.status),
    (0, pg_core_1.index)('errand_orders_courier_status_idx').on(table.courier_id, table.status),
]);
exports.orderDetailsTable = (0, pg_core_1.pgTable)('orderDetails', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    order_id: (0, pg_core_1.text)('order_id')
        .notNull()
        .references(() => exports.ordersTable.id),
    product_id: (0, pg_core_1.text)('product_id')
        .notNull()
        .references(() => exports.productsTable.id),
    quantity: (0, pg_core_1.integer)('quantity').notNull(),
    note_product: (0, pg_core_1.text)('note_product'),
    extra: (0, pg_core_1.json)('extra'),
    summary_price: (0, pg_core_1.varchar)('summary_price', { length: 10 }).notNull(),
    created_at: (0, pg_core_1.timestamp)('created_at', { withTimezone: true })
        .defaultNow()
        .notNull(),
    status: (0, exports.STATUS)('status'),
}, (table) => [
    (0, pg_core_1.index)('order_details_created_at_idx').on(table.created_at),
    (0, pg_core_1.index)('order_details_order_id_idx').on(table.order_id),
]);
exports.ratingsTable = (0, pg_core_1.pgTable)('ratings', {
    id: (0, pg_core_1.text)('id').primaryKey(),
    // Nullable since errands were added: an errand has no products, therefore
    // no orderDetails row to hang a rating on. Exactly one of
    // order_details_id / errand_order_id is set, enforced by a CHECK in the
    // migration.
    //
    // Errand ratings deliberately live in THIS table rather than one of their
    // own, because getCourierRatingInfo() reads the last N rows here to decide
    // probation. A separate table would have meant either a UNION in that hot
    // path or — far worse, and silently — errand behaviour never counting
    // against a courier at all.
    order_details_id: (0, pg_core_1.integer)('order_details_id').references(() => exports.orderDetailsTable.id),
    errand_order_id: (0, pg_core_1.text)('errand_order_id').references(() => exports.errandOrdersTable.id),
    ratings: (0, pg_core_1.numeric)('ratings', { precision: 3, scale: 2 }).default('5'),
    comment: (0, pg_core_1.text)('comment'),
    reviewer: (0, pg_core_1.text)('reviewer_id')
        .notNull()
        .references(() => exports.usersTable.id),
    reciepent: (0, pg_core_1.text)('reciepent_id').references(() => exports.usersTable.id),
    outlet_id: (0, pg_core_1.integer)('outlet_id').references(() => exports.outletsTable.id),
    product_id: (0, pg_core_1.text)('product_id').references(() => exports.productsTable.id),
    reciepent_as: (0, exports.RECIEPENT)('reciepent_as'),
    ...columns_helper_1.timestamps,
}, (table) => [
    // Exactly one target, never both and never neither. order_details_id was
    // mandatory until errands existed; making it nullable without this would
    // quietly permit ratings attached to nothing at all.
    (0, pg_core_1.check)('ratings_one_target_chk', (0, drizzle_orm_1.sql) `(${table.order_details_id} IS NOT NULL AND ${table.errand_order_id} IS NULL)
        OR (${table.order_details_id} IS NULL AND ${table.errand_order_id} IS NOT NULL)`),
    (0, pg_core_1.index)('ratings_errand_order_id_idx').on(table.errand_order_id),
    (0, pg_core_1.index)('ratings_outlet_id_idx').on(table.outlet_id),
    (0, pg_core_1.index)('ratings_product_id_idx').on(table.product_id),
    (0, pg_core_1.index)('ratings_reciepent_idx').on(table.reciepent),
]);
exports.cashInCategoryTable = (0, pg_core_1.pgTable)('cashInCategory', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    category: (0, pg_core_1.varchar)('category', { length: 50 }),
});
exports.cashOutCategoryTable = (0, pg_core_1.pgTable)('cashOutCategory', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    category: (0, pg_core_1.varchar)('category', { length: 50 }),
});
exports.cashInDetailTable = (0, pg_core_1.pgTable)('cashInDetailTable', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    category_id: (0, pg_core_1.integer)('category_id')
        .notNull()
        .references(() => exports.cashInCategoryTable.id),
    money_amount: (0, pg_core_1.varchar)('money_amount', { length: 15 }).notNull(),
    type: (0, exports.CASHFLOWS_TRANSACTION_TYPE)('type')
        .$default(() => 'cash')
        .notNull(),
    created_at: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
}, (table) => [(0, pg_core_1.index)('cash_in_detail_created_at_idx').on(table.created_at)]);
exports.cashOutDetailTable = (0, pg_core_1.pgTable)('cashOutDetailTable', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    category_id: (0, pg_core_1.integer)('category_id')
        .notNull()
        .references(() => exports.cashOutCategoryTable.id),
    money_amount: (0, pg_core_1.varchar)('money_amount', { length: 15 }).notNull(),
    type: (0, exports.CASHFLOWS_TRANSACTION_TYPE)('type')
        .$default(() => 'cash')
        .notNull(),
    created_at: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
}, (table) => [(0, pg_core_1.index)('cash_out_detail_created_at_idx').on(table.created_at)]);
exports.cashFlows = (0, pg_core_1.pgTable)('cashFlows', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    outlet_id: (0, pg_core_1.integer)('outlet_id')
        .notNull()
        .references(() => exports.outletsTable.id),
    cash_opname: (0, pg_core_1.varchar)('cash_opname', { length: 15 })
        .notNull()
        .$default(() => 'cash'),
    cash_in_detail_id: (0, pg_core_1.integer)('cash_in_detail_id').references(() => exports.cashInDetailTable.id),
    cash_out_detail_id: (0, pg_core_1.integer)('cash_out_detail_id').references(() => exports.cashOutDetailTable.id),
});
exports.promosTable = (0, pg_core_1.pgTable)('promos', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    code: (0, pg_core_1.varchar)('code', { length: 20 }).notNull().unique(),
    title: (0, pg_core_1.varchar)('title', { length: 255 }).notNull(),
    description: (0, pg_core_1.varchar)('description', { length: 500 }).notNull(),
    discount_percent: (0, pg_core_1.integer)('discount_percent').notNull(),
    min_order: (0, pg_core_1.integer)('min_order').notNull().default(0),
    max_discount: (0, pg_core_1.integer)('max_discount'),
    valid_until: (0, pg_core_1.timestamp)('valid_until', { withTimezone: true }).notNull(),
    gradient: (0, pg_core_1.varchar)('gradient', { length: 255 })
        .notNull()
        .default('from-rose-500 to-pink-600'),
    features: (0, pg_core_1.text)('features').array().default([]).notNull(),
    is_active: (0, pg_core_1.boolean)('is_active').default(true).notNull(),
    image: (0, pg_core_1.varchar)('image', { length: 255 })
        .notNull()
        .default('/promos/default-promo.png'),
    ...columns_helper_1.timestamps,
});
exports.scheduleProductAdsTable = (0, pg_core_1.pgTable)('schedule_product_ads', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    time: (0, pg_core_1.json)('time_display').$type(),
});
exports.productAdsSchedule = (0, pg_core_1.pgTable)('product_ads_schedule', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedAlwaysAsIdentity(),
    scheduleProductAdsTable_id: (0, pg_core_1.integer)('schedule_products_ads_id').notNull().references(() => exports.scheduleProductAdsTable.id),
    productAdsSchedule_id: (0, pg_core_1.integer)('products_ads_id').notNull().references(() => exports.productAdsTable.id)
});
exports.productAdsTable = (0, pg_core_1.pgTable)('product_ads', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    outlet_id: (0, pg_core_1.integer)('outlet_id')
        .notNull()
        .references(() => exports.outletsTable.id),
    product_id: (0, pg_core_1.text)('product_id')
        .notNull()
        .references(() => exports.productsTable.id),
    title: (0, pg_core_1.varchar)('title', { length: 255 }).notNull(),
    description: (0, pg_core_1.varchar)('description', { length: 500 }).default(''),
    banner_image: (0, pg_core_1.varchar)('banner_image', { length: 255 }).notNull(),
    status: (0, exports.AD_STATUS)('status').default('pending').notNull(),
    is_active: (0, pg_core_1.boolean)('is_active').default(true).notNull(),
    rejection_reason: (0, pg_core_1.varchar)('rejection_reason', { length: 255 }),
    starts_at: (0, pg_core_1.timestamp)('starts_at', { withTimezone: true })
        .defaultNow()
        .notNull(),
    ends_at: (0, pg_core_1.timestamp)('ends_at', { withTimezone: true }),
    ...columns_helper_1.timestamps,
});
exports.courierSessionsTable = (0, pg_core_1.pgTable)('courier_sessions', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    courier_id: (0, pg_core_1.integer)('courier_id')
        .notNull()
        .references(() => exports.couriersTable.id),
    started_at: (0, pg_core_1.timestamp)('started_at', { withTimezone: true })
        .defaultNow()
        .notNull(),
    ended_at: (0, pg_core_1.timestamp)('ended_at', { withTimezone: true }),
});
exports.session = (0, pg_core_1.pgTable)('session', {
    id: (0, pg_core_1.text)('id').primaryKey(),
    expiresAt: (0, pg_core_1.timestamp)('expires_at', { withTimezone: true }).notNull(),
    token: (0, pg_core_1.text)('token').notNull().unique(),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true })
        .defaultNow()
        .notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true })
        .$onUpdate(() => new Date())
        .notNull(),
    ipAddress: (0, pg_core_1.text)('ip_address'),
    userAgent: (0, pg_core_1.text)('user_agent'),
    userId: (0, pg_core_1.text)('user_id')
        .notNull()
        .references(() => exports.usersTable.id, { onDelete: 'cascade' }),
});
exports.account = (0, pg_core_1.pgTable)('account', {
    id: (0, pg_core_1.text)('id').primaryKey(),
    accountId: (0, pg_core_1.text)('account_id').notNull(),
    providerId: (0, pg_core_1.text)('provider_id').notNull(),
    userId: (0, pg_core_1.text)('user_id')
        .notNull()
        .references(() => exports.usersTable.id, { onDelete: 'cascade' }),
    accessToken: (0, pg_core_1.text)('access_token'),
    refreshToken: (0, pg_core_1.text)('refresh_token'),
    idToken: (0, pg_core_1.text)('id_token'),
    accessTokenExpiresAt: (0, pg_core_1.timestamp)('access_token_expires_at', {
        withTimezone: true,
    }),
    refreshTokenExpiresAt: (0, pg_core_1.timestamp)('refresh_token_expires_at', {
        withTimezone: true,
    }),
    scope: (0, pg_core_1.text)('scope'),
    password: (0, pg_core_1.text)('password'),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true })
        .defaultNow()
        .notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true })
        .$onUpdate(() => new Date())
        .notNull(),
});
exports.verification = (0, pg_core_1.pgTable)('verification', {
    id: (0, pg_core_1.text)('id').primaryKey(),
    identifier: (0, pg_core_1.text)('identifier').notNull(),
    value: (0, pg_core_1.text)('value').notNull(),
    expiresAt: (0, pg_core_1.timestamp)('expires_at', { withTimezone: true }).notNull(),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true })
        .defaultNow()
        .notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true })
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
exports.suppliersTable = (0, pg_core_1.pgTable)('suppliers', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    outlet_id: (0, pg_core_1.integer)('outlet_id')
        .notNull()
        .references(() => exports.outletsTable.id),
    name: (0, pg_core_1.varchar)('name', { length: 255 }).notNull(),
    phone: (0, pg_core_1.varchar)('phone', { length: 50 }).default(''),
    email: (0, pg_core_1.varchar)('email', { length: 255 }).default(''),
    address: (0, pg_core_1.varchar)('address', { length: 255 }).default(''),
    note: (0, pg_core_1.varchar)('note', { length: 255 }).default(''),
    ...columns_helper_1.timestamps,
}, (table) => [(0, pg_core_1.index)('suppliers_outlet_id_idx').on(table.outlet_id)]);
exports.invoicesTable = (0, pg_core_1.pgTable)('invoices', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    outlet_id: (0, pg_core_1.integer)('outlet_id')
        .notNull()
        .references(() => exports.outletsTable.id),
    type: (0, exports.INVOICE_TYPE)('type').notNull(),
    // Human-facing number, unique per outlet (e.g. "INV/2026/0001").
    number: (0, pg_core_1.varchar)('number', { length: 50 }).notNull(),
    status: (0, exports.INVOICE_STATUS)('status').notNull().default('draft'),
    // Counterparty: supplier for purchase, customer for sales; party_name is a
    // free-text fallback when neither is a saved record.
    supplier_id: (0, pg_core_1.integer)('supplier_id').references(() => exports.suppliersTable.id),
    customer_id: (0, pg_core_1.integer)('customer_id').references(() => exports.customersTable.id),
    party_name: (0, pg_core_1.varchar)('party_name', { length: 255 }).default(''),
    // Dates: issue_date = created/terbit, due_date = jatuh tempo / expired.
    issue_date: (0, pg_core_1.timestamp)('issue_date', { withTimezone: true })
        .defaultNow()
        .notNull(),
    due_date: (0, pg_core_1.timestamp)('due_date', { withTimezone: true }),
    // Money. tax_rate is a percentage (e.g. 11.00 for PPN 11%); tax_amount is
    // the computed value. tax_inclusive flags whether unit prices already
    // include tax. total = subtotal - discount + tax_amount.
    subtotal: (0, pg_core_1.numeric)('subtotal', { precision: 14, scale: 2 })
        .notNull()
        .default('0'),
    tax_rate: (0, pg_core_1.numeric)('tax_rate', { precision: 5, scale: 2 })
        .notNull()
        .default('0'),
    tax_amount: (0, pg_core_1.numeric)('tax_amount', { precision: 14, scale: 2 })
        .notNull()
        .default('0'),
    tax_inclusive: (0, pg_core_1.boolean)('tax_inclusive').notNull().default(false),
    discount: (0, pg_core_1.numeric)('discount', { precision: 14, scale: 2 })
        .notNull()
        .default('0'),
    total: (0, pg_core_1.numeric)('total', { precision: 14, scale: 2 }).notNull().default('0'),
    amount_paid: (0, pg_core_1.numeric)('amount_paid', { precision: 14, scale: 2 })
        .notNull()
        .default('0'),
    // Down payment (uang muka) agreed on the draft; auto-recorded as the first
    // payment when the invoice is posted (amount_paid stays 0 until then).
    down_payment: (0, pg_core_1.numeric)('down_payment', { precision: 14, scale: 2 })
        .notNull()
        .default('0'),
    notes: (0, pg_core_1.varchar)('notes', { length: 500 }).default(''),
    // Who created the invoice (owner or employee) — staff attribution for the
    // "dibuat oleh" line. Nullable: rows predating the column stay unattributed.
    created_by: (0, pg_core_1.text)('created_by').references(() => exports.usersTable.id),
    // Link back to the cashflow detail this invoice generated when paid, so a
    // void can reverse it. Exactly one is set depending on type.
    cash_in_detail_id: (0, pg_core_1.integer)('cash_in_detail_id').references(() => exports.cashInDetailTable.id),
    cash_out_detail_id: (0, pg_core_1.integer)('cash_out_detail_id').references(() => exports.cashOutDetailTable.id),
    ...columns_helper_1.timestamps,
}, (table) => [
    (0, pg_core_1.index)('invoices_outlet_type_idx').on(table.outlet_id, table.type),
    (0, pg_core_1.index)('invoices_status_idx').on(table.status),
    (0, pg_core_1.index)('invoices_due_date_idx').on(table.due_date),
    (0, pg_core_1.uniqueIndex)('invoices_outlet_number_uq').on(table.outlet_id, table.number),
]);
exports.invoiceItemsTable = (0, pg_core_1.pgTable)('invoice_items', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    invoice_id: (0, pg_core_1.integer)('invoice_id')
        .notNull()
        .references(() => exports.invoicesTable.id),
    // Nullable: lines like delivery/jasa have no product and don't move stock.
    product_id: (0, pg_core_1.text)('product_id').references(() => exports.productsTable.id),
    description: (0, pg_core_1.varchar)('description', { length: 255 }).notNull(),
    quantity: (0, pg_core_1.numeric)('quantity', { precision: 12, scale: 2 })
        .notNull()
        .default('1'),
    unit_price: (0, pg_core_1.numeric)('unit_price', { precision: 14, scale: 2 })
        .notNull()
        .default('0'),
    // Per-line discount as a percentage (e.g. 10.00 = 10% off this line).
    // line_total already reflects it: qty * unit_price * (1 - discount_pct/100).
    discount_pct: (0, pg_core_1.numeric)('discount_pct', { precision: 5, scale: 2 })
        .notNull()
        .default('0'),
    line_total: (0, pg_core_1.numeric)('line_total', { precision: 14, scale: 2 })
        .notNull()
        .default('0'),
    ...columns_helper_1.timestamps,
}, (table) => [(0, pg_core_1.index)('invoice_items_invoice_id_idx').on(table.invoice_id)]);
// One row per payment received/made on an invoice (down payment, installment,
// settlement). Links the invoice to the cashflow detail each payment created so
// a void can reverse ALL of them — invoices.cash_in/out_detail_id only remembers
// the latest one.
exports.invoicePaymentsTable = (0, pg_core_1.pgTable)('invoice_payments', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    invoice_id: (0, pg_core_1.integer)('invoice_id')
        .notNull()
        .references(() => exports.invoicesTable.id),
    cash_in_detail_id: (0, pg_core_1.integer)('cash_in_detail_id').references(() => exports.cashInDetailTable.id),
    cash_out_detail_id: (0, pg_core_1.integer)('cash_out_detail_id').references(() => exports.cashOutDetailTable.id),
    amount: (0, pg_core_1.numeric)('amount', { precision: 14, scale: 2 }).notNull(),
    created_at: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
}, (table) => [(0, pg_core_1.index)('invoice_payments_invoice_id_idx').on(table.invoice_id)]);
exports.stockMovementsTable = (0, pg_core_1.pgTable)('stock_movements', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    outlet_id: (0, pg_core_1.integer)('outlet_id')
        .notNull()
        .references(() => exports.outletsTable.id),
    product_id: (0, pg_core_1.text)('product_id')
        .notNull()
        .references(() => exports.productsTable.id),
    // Signed: positive = stock in (purchase), negative = stock out (sales).
    // Scale 3 to carry recipe-precision decrements losslessly.
    qty_change: (0, pg_core_1.numeric)('qty_change', { precision: 12, scale: 3 }).notNull(),
    reason: (0, exports.STOCK_MOVEMENT_REASON)('reason').notNull(),
    // The invoice that caused this movement (null for manual adjustments).
    invoice_id: (0, pg_core_1.integer)('invoice_id').references(() => exports.invoicesTable.id),
    note: (0, pg_core_1.varchar)('note', { length: 255 }).default(''),
    created_at: (0, pg_core_1.timestamp)('created_at', { withTimezone: true })
        .defaultNow()
        .notNull(),
}, (table) => [
    (0, pg_core_1.index)('stock_movements_product_idx').on(table.product_id),
    (0, pg_core_1.index)('stock_movements_outlet_idx').on(table.outlet_id),
    (0, pg_core_1.index)('stock_movements_invoice_idx').on(table.invoice_id),
    // Opname history: filter by outlet + reason, range/sort on created_at.
    (0, pg_core_1.index)('stock_movements_outlet_reason_created_idx').on(table.outlet_id, table.reason, table.created_at),
]);
// Optional bill-of-materials: what one sold unit of `product_id` consumes.
// Only consulted when the sold product has track_stock=false (a menu item with
// no countable stock of its own); a menu item with no rows here moves no stock
// at all — recipes are strictly opt-in per product. Rows are kept (dormant) if
// the owner toggles track_stock back on. Hard-deleted, replace-on-save.
exports.recipeItemsTable = (0, pg_core_1.pgTable)('recipe_items', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    outlet_id: (0, pg_core_1.integer)('outlet_id')
        .notNull()
        .references(() => exports.outletsTable.id),
    // The menu item being sold (track_stock = false).
    product_id: (0, pg_core_1.text)('product_id')
        .notNull()
        .references(() => exports.productsTable.id, { onDelete: 'cascade' }),
    // The ingredient consumed (track_stock = true), in its own stock unit.
    ingredient_id: (0, pg_core_1.text)('ingredient_id')
        .notNull()
        .references(() => exports.productsTable.id, { onDelete: 'cascade' }),
    // Consumed per ONE unit sold. Scale 3 (not 2) so gram/ml-size amounts of
    // kg/L-stocked ingredients fit, e.g. 0.005 kg of garlic per portion.
    qty: (0, pg_core_1.numeric)('qty', { precision: 12, scale: 3 }).notNull(),
    created_at: (0, pg_core_1.timestamp)('created_at', { withTimezone: true })
        .defaultNow()
        .notNull(),
}, (table) => [
    (0, pg_core_1.uniqueIndex)('recipe_items_product_ingredient_idx').on(table.product_id, table.ingredient_id),
    (0, pg_core_1.index)('recipe_items_outlet_idx').on(table.outlet_id),
]);
// ============================================================================
// Outlet employees ("Karyawan"): staff accounts an OWNER creates for their
// outlet. An employee is a real users-row (own login) linked here with a
// page-level permission map the owner controls. One employment per account
// (user_id unique) keeps role resolution unambiguous. The number of ACTIVE
// employees is capped by the subscription plan's features.maxEmployees.
// Billing, employee management, and outlet settings are owner-only by
// construction — no permission key can grant them.
// ============================================================================
exports.employeesTable = (0, pg_core_1.pgTable)('employees', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    outlet_id: (0, pg_core_1.integer)('outlet_id')
        .notNull()
        .references(() => exports.outletsTable.id),
    user_id: (0, pg_core_1.text)('user_id')
        .notNull()
        .references(() => exports.usersTable.id),
    // Page-level toggles, e.g. { cashier: true, reports: false } — keys are
    // the EMPLOYEE_PERMISSIONS list in lib/outlet-access.ts. Missing key =
    // no access.
    permissions: (0, pg_core_1.json)('permissions')
        .$type()
        .notNull()
        .default({}),
    is_active: (0, pg_core_1.boolean)('is_active').notNull().default(true),
    ...columns_helper_1.timestamps,
}, (t) => [
    (0, pg_core_1.uniqueIndex)('employees_user_id_uq').on(t.user_id),
    (0, pg_core_1.index)('employees_outlet_idx').on(t.outlet_id),
]);
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
exports.SUBSCRIPTION_TIER = (0, pg_core_1.pgEnum)('subscription_tier', [
    'basic',
    'pro',
    'max_lite',
    'max',
]);
exports.BILLING_INTERVAL = (0, pg_core_1.pgEnum)('billing_interval', [
    'monthly',
    'yearly',
]);
exports.SUBSCRIPTION_STATUS = (0, pg_core_1.pgEnum)('subscription_status', [
    'trialing',
    'active',
    'past_due',
    'expired',
    'canceled',
]);
// manual_transfer = merchant transfers + admin confirms (now).
// xendit = hosted invoice / gateway settlement (later).
exports.SUBSCRIPTION_PAYMENT_METHOD = (0, pg_core_1.pgEnum)('subscription_payment_method', ['manual_transfer', 'xendit']);
// Covers both the manual flow (pending -> paid | rejected | expired) and the
// Xendit flow (pending -> paid | expired | failed | refunded).
exports.SUBSCRIPTION_PAYMENT_STATUS = (0, pg_core_1.pgEnum)('subscription_payment_status', ['pending', 'paid', 'rejected', 'expired', 'failed', 'refunded']);
exports.SUBSCRIPTION_ACTOR = (0, pg_core_1.pgEnum)('subscription_actor', [
    'system',
    'admin',
    'merchant',
]);
exports.NOTIFICATION_CHANNEL = (0, pg_core_1.pgEnum)('notification_channel', [
    'email',
    'whatsapp',
    'in_app',
]);
exports.NOTIFICATION_STATUS = (0, pg_core_1.pgEnum)('notification_status', [
    'pending',
    'sent',
    'failed',
]);
// A purchasable plan = one (tier × interval) row with its price + feature caps.
exports.subscriptionPlansTable = (0, pg_core_1.pgTable)('subscription_plans', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    tier: (0, exports.SUBSCRIPTION_TIER)('tier').notNull(),
    interval: (0, exports.BILLING_INTERVAL)('interval').notNull(),
    name: (0, pg_core_1.varchar)('name', { length: 100 }).notNull(),
    // Base price in IDR. The amount a merchant actually transfers gets a small
    // unique suffix at payment time (subscription_payments.unique_code).
    price: (0, pg_core_1.numeric)('price', { precision: 14, scale: 2 }).notNull(),
    currency: (0, pg_core_1.varchar)('currency', { length: 3 }).notNull().default('IDR'),
    // Trial length granted on first subscribe (0 = no trial for this plan).
    trial_days: (0, pg_core_1.integer)('trial_days').notNull().default(0),
    // Feature flags / usage caps this tier unlocks, read by the gating
    // middleware. e.g. { "maxOutlets": 3, "desktopCashier": true }.
    features: (0, pg_core_1.json)('features')
        .$type()
        .notNull()
        .default({}),
    is_active: (0, pg_core_1.boolean)('is_active').notNull().default(true),
    sort_order: (0, pg_core_1.integer)('sort_order').notNull().default(0),
    ...columns_helper_1.timestamps,
}, (t) => [
    (0, pg_core_1.uniqueIndex)('subscription_plans_tier_interval_idx').on(t.tier, t.interval),
]);
// One subscription per account/owner. Access is granted while
// now() < current_period_end (the gating middleware may add a grace window).
exports.subscriptionsTable = (0, pg_core_1.pgTable)('subscriptions', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    // Per ACCOUNT/OWNER (a user may own several outlets) — hangs off users.id,
    // NOT outlets.id. Middleware maps outlet -> outlets.user_id -> here.
    user_id: (0, pg_core_1.text)('user_id')
        .notNull()
        .references(() => exports.usersTable.id),
    plan_id: (0, pg_core_1.integer)('plan_id').references(() => exports.subscriptionPlansTable.id),
    // Cached tier so gating doesn't join subscription_plans on every request.
    tier: (0, exports.SUBSCRIPTION_TIER)('tier'),
    status: (0, exports.SUBSCRIPTION_STATUS)('status').notNull().default('trialing'),
    trial_ends_at: (0, pg_core_1.timestamp)('trial_ends_at', { withTimezone: true }),
    current_period_start: (0, pg_core_1.timestamp)('current_period_start', {
        withTimezone: true,
    }),
    current_period_end: (0, pg_core_1.timestamp)('current_period_end', { withTimezone: true }),
    // Merchant asked to stop renewing; access still runs until period_end.
    cancel_at_period_end: (0, pg_core_1.boolean)('cancel_at_period_end')
        .notNull()
        .default(false),
    canceled_at: (0, pg_core_1.timestamp)('canceled_at', { withTimezone: true }),
    // Scheduled DOWNGRADE (Model 2): a confirmed lower-tier payment does not
    // flip the tier immediately — the merchant keeps what they paid for until
    // next_tier_at (the old period's end), when a lazy read applies next_* and
    // clears them. Upgrades never sit here (they apply instantly, converting
    // remaining value into bonus days at the new tier's daily rate).
    next_plan_id: (0, pg_core_1.integer)('next_plan_id').references(() => exports.subscriptionPlansTable.id),
    next_tier: (0, exports.SUBSCRIPTION_TIER)('next_tier'),
    next_tier_at: (0, pg_core_1.timestamp)('next_tier_at', { withTimezone: true }),
    // Marketing deal: percentage off, optionally scoped to one tier and/or one
    // interval (NULL scope = applies to any). 0 = no deal. Applied at payment
    // creation and snapshotted onto the payment row.
    discount_pct: (0, pg_core_1.numeric)('discount_pct', { precision: 5, scale: 2 })
        .notNull()
        .default('0'),
    discount_tier: (0, exports.SUBSCRIPTION_TIER)('discount_tier'),
    discount_interval: (0, exports.BILLING_INTERVAL)('discount_interval'),
    discount_note: (0, pg_core_1.varchar)('discount_note', { length: 255 }).default(''),
    // Xendit-ready (nullable until the gateway migration): maps this account to
    // a Xendit customer for hosted invoices / future recurring plans.
    xendit_customer_id: (0, pg_core_1.varchar)('xendit_customer_id', { length: 255 }),
    ...columns_helper_1.timestamps,
}, (t) => [
    (0, pg_core_1.uniqueIndex)('subscriptions_user_id_idx').on(t.user_id),
    (0, pg_core_1.index)('subscriptions_status_period_idx').on(t.status, t.current_period_end),
]);
// One row per payment attempt/renewal. Manual bank-transfer columns and the
// (nullable) Xendit columns coexist so the gateway path reuses this table.
exports.subscriptionPaymentsTable = (0, pg_core_1.pgTable)('subscription_payments', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    subscription_id: (0, pg_core_1.integer)('subscription_id')
        .notNull()
        .references(() => exports.subscriptionsTable.id),
    // Denormalised owner for the admin queue / direct lookups.
    user_id: (0, pg_core_1.text)('user_id')
        .notNull()
        .references(() => exports.usersTable.id),
    plan_id: (0, pg_core_1.integer)('plan_id')
        .notNull()
        .references(() => exports.subscriptionPlansTable.id),
    // Snapshots so a later plan price/def change can't rewrite history.
    tier: (0, exports.SUBSCRIPTION_TIER)('tier').notNull(),
    interval: (0, exports.BILLING_INTERVAL)('interval').notNull(),
    currency: (0, pg_core_1.varchar)('currency', { length: 3 }).notNull().default('IDR'),
    // Base plan price...
    amount: (0, pg_core_1.numeric)('amount', { precision: 14, scale: 2 }).notNull(),
    // Marketing-deal percentage applied to THIS payment (snapshot; the live
    // deal lives on subscriptions). amount stays the base plan price.
    discount_pct: (0, pg_core_1.numeric)('discount_pct', { precision: 5, scale: 2 })
        .notNull()
        .default('0'),
    // ...and the unique-amount matching trick: unique_code (e.g. 237) is added
    // to the discounted price so admin can auto-match a bank transfer to THIS
    // record. amount_due = discounted amount + unique_code = actual transfer.
    unique_code: (0, pg_core_1.integer)('unique_code').notNull().default(0),
    amount_due: (0, pg_core_1.numeric)('amount_due', { precision: 14, scale: 2 }).notNull(),
    method: (0, exports.SUBSCRIPTION_PAYMENT_METHOD)('method')
        .notNull()
        .default('manual_transfer'),
    status: (0, exports.SUBSCRIPTION_PAYMENT_STATUS)('status').notNull().default('pending'),
    // The access window this payment grants; on confirm the subscription's
    // current_period_end is set/extended to period_end.
    period_start: (0, pg_core_1.timestamp)('period_start', { withTimezone: true }),
    period_end: (0, pg_core_1.timestamp)('period_end', { withTimezone: true }),
    // Set when an UPGRADE consumed this segment's remaining value (converted to
    // bonus days on the new plan) — consumed segments never count twice.
    converted_at: (0, pg_core_1.timestamp)('converted_at', { withTimezone: true }),
    // After this an unpaid pending payment is void (manual quote / Xendit invoice
    // expiry).
    expires_at: (0, pg_core_1.timestamp)('expires_at', { withTimezone: true }),
    paid_at: (0, pg_core_1.timestamp)('paid_at', { withTimezone: true }),
    // --- Manual bank-transfer fields (method = manual_transfer) ---
    proof_image: (0, pg_core_1.varchar)('proof_image', { length: 255 }),
    sender_bank: (0, pg_core_1.varchar)('sender_bank', { length: 100 }),
    sender_name: (0, pg_core_1.varchar)('sender_name', { length: 255 }),
    transfer_date: (0, pg_core_1.timestamp)('transfer_date', { withTimezone: true }),
    merchant_note: (0, pg_core_1.varchar)('merchant_note', { length: 500 }),
    // --- Admin review / audit (manual confirm) ---
    reviewed_by: (0, pg_core_1.text)('reviewed_by').references(() => exports.usersTable.id),
    reviewed_at: (0, pg_core_1.timestamp)('reviewed_at', { withTimezone: true }),
    review_note: (0, pg_core_1.varchar)('review_note', { length: 500 }),
    // --- Xendit-ready (all nullable until the gateway migration) ---
    // external_id = OUR idempotency key sent to Xendit (e.g. "subpay-<id>").
    external_id: (0, pg_core_1.varchar)('external_id', { length: 255 }),
    xendit_invoice_id: (0, pg_core_1.varchar)('xendit_invoice_id', { length: 255 }),
    xendit_payment_request_id: (0, pg_core_1.varchar)('xendit_payment_request_id', {
        length: 255,
    }),
    // Hosted checkout URL Xendit returns; where the merchant pays.
    invoice_url: (0, pg_core_1.text)('invoice_url'),
    // Concrete rail Xendit settled on (BCA VA, QRIS, OVO, ...).
    payment_channel: (0, pg_core_1.varchar)('payment_channel', { length: 50 }),
    // Raw webhook body kept verbatim for audit / dispute.
    gateway_payload: (0, pg_core_1.json)('gateway_payload'),
    ...columns_helper_1.timestamps,
}, (t) => [
    (0, pg_core_1.index)('subscription_payments_user_idx').on(t.user_id),
    (0, pg_core_1.index)('subscription_payments_subscription_idx').on(t.subscription_id),
    (0, pg_core_1.index)('subscription_payments_status_idx').on(t.status),
    // Manual reconciliation: look up a pending payment by the exact transfer.
    (0, pg_core_1.index)('subscription_payments_amount_due_idx').on(t.amount_due),
    // Nullable + unique: Postgres treats NULLs as distinct, so manual rows
    // (external_id/xendit_invoice_id = NULL) never collide.
    (0, pg_core_1.uniqueIndex)('subscription_payments_external_id_idx').on(t.external_id),
    (0, pg_core_1.uniqueIndex)('subscription_payments_xendit_invoice_idx').on(t.xendit_invoice_id),
]);
// Append-only audit trail: every lifecycle change (submit/confirm/reject/renew/
// upgrade/expire/cancel), who did it, and what changed.
exports.subscriptionEventsTable = (0, pg_core_1.pgTable)('subscription_events', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    subscription_id: (0, pg_core_1.integer)('subscription_id')
        .notNull()
        .references(() => exports.subscriptionsTable.id),
    user_id: (0, pg_core_1.text)('user_id')
        .notNull()
        .references(() => exports.usersTable.id),
    payment_id: (0, pg_core_1.integer)('payment_id').references(() => exports.subscriptionPaymentsTable.id),
    // Freeform verb, e.g. 'payment_submitted','payment_confirmed','renewed',
    // 'upgraded','expired','trial_started'. String (not enum) so new event kinds
    // don't each need a migration.
    type: (0, pg_core_1.varchar)('type', { length: 50 }).notNull(),
    actor: (0, exports.SUBSCRIPTION_ACTOR)('actor').notNull().default('system'),
    // users.id of the acting admin/merchant when actor != system.
    actor_id: (0, pg_core_1.text)('actor_id').references(() => exports.usersTable.id),
    detail: (0, pg_core_1.json)('detail'),
    created_at: (0, pg_core_1.timestamp)('created_at', { withTimezone: true })
        .defaultNow()
        .notNull(),
}, (t) => [
    (0, pg_core_1.index)('subscription_events_subscription_idx').on(t.subscription_id, t.created_at),
]);
// Notify outbox: durable, retryable record of merchant-facing notifications
// (payment confirmed/rejected, expiring soon, expired). A dispatcher drains
// status = 'pending'; in_app rows are also read straight from here.
exports.subscriptionNotificationsTable = (0, pg_core_1.pgTable)('subscription_notifications', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    user_id: (0, pg_core_1.text)('user_id')
        .notNull()
        .references(() => exports.usersTable.id),
    subscription_id: (0, pg_core_1.integer)('subscription_id').references(() => exports.subscriptionsTable.id),
    event_id: (0, pg_core_1.integer)('event_id').references(() => exports.subscriptionEventsTable.id),
    channel: (0, exports.NOTIFICATION_CHANNEL)('channel').notNull().default('in_app'),
    // e.g. 'payment_confirmed','payment_rejected','expiring_soon','expired'.
    type: (0, pg_core_1.varchar)('type', { length: 50 }).notNull(),
    title: (0, pg_core_1.varchar)('title', { length: 255 }),
    body: (0, pg_core_1.varchar)('body', { length: 1000 }),
    status: (0, exports.NOTIFICATION_STATUS)('status').notNull().default('pending'),
    // email/wa: when dispatched. in_app: read_at is when the merchant saw it.
    sent_at: (0, pg_core_1.timestamp)('sent_at', { withTimezone: true }),
    read_at: (0, pg_core_1.timestamp)('read_at', { withTimezone: true }),
    payload: (0, pg_core_1.json)('payload'),
    created_at: (0, pg_core_1.timestamp)('created_at', { withTimezone: true })
        .defaultNow()
        .notNull(),
}, (t) => [
    (0, pg_core_1.index)('subscription_notifications_user_idx').on(t.user_id, t.status),
]);
// Web Push endpoints, one row per browser/device a user has opted in from. The
// endpoint URL is the push service's own handle for that device and is unique,
// so it doubles as the natural key for upserts — a browser re-subscribing after
// a key rotation hands back the same endpoint rather than piling up rows.
exports.pushSubscriptionsTable = (0, pg_core_1.pgTable)('push_subscriptions', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    user_id: (0, pg_core_1.text)('user_id')
        .notNull()
        .references(() => exports.usersTable.id, { onDelete: 'cascade' }),
    endpoint: (0, pg_core_1.text)('endpoint').notNull().unique(),
    // Encryption material handed over by the browser at subscribe time.
    p256dh: (0, pg_core_1.text)('p256dh').notNull(),
    auth: (0, pg_core_1.text)('auth').notNull(),
    user_agent: (0, pg_core_1.varchar)('user_agent', { length: 500 }),
    created_at: (0, pg_core_1.timestamp)('created_at', { withTimezone: true })
        .defaultNow()
        .notNull(),
}, (t) => [(0, pg_core_1.index)('push_subscriptions_user_idx').on(t.user_id)]);
/**
 * One install of the courier app.
 *
 * Two credentials live here and they do different jobs. `fcm_token` is how the
 * server reaches the phone. `device_token_hash` is how the phone proves who it
 * is on the few endpoints the native side calls WITHOUT the WebView — the
 * location service outlives the WebView by design, so it cannot borrow that
 * component's session cookie.
 *
 * The device token is stored hashed, never in the clear. It is a bearer
 * credential sitting in app storage on a phone that gets lost, so the database
 * should not be a second place it can leak from; the plaintext is returned once
 * at registration and never again.
 */
exports.courierDevicesTable = (0, pg_core_1.pgTable)('courier_devices', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    courier_id: (0, pg_core_1.integer)('courier_id')
        .notNull()
        .references(() => exports.couriersTable.id, { onDelete: 'cascade' }),
    // Rotated by FCM whenever it feels like it; the app re-registers on
    // onNewToken, which moves this row rather than creating a second one.
    fcm_token: (0, pg_core_1.text)('fcm_token').notNull(),
    device_token_hash: (0, pg_core_1.text)('device_token_hash').notNull(),
    platform: (0, pg_core_1.varchar)('platform', { length: 20 }).notNull().default('android'),
    app_version: (0, pg_core_1.varchar)('app_version', { length: 30 }),
    last_seen_at: (0, pg_core_1.timestamp)('last_seen_at', { withTimezone: true }),
    // Set on logout. Kept rather than deleted so "this phone was signed out at
    // 14:02" is answerable when a courier says they never got an offer.
    revoked_at: (0, pg_core_1.timestamp)('revoked_at', { withTimezone: true }),
    ...columns_helper_1.timestamps,
}, (table) => [
    // A physical phone belongs to one courier. If a device is handed over, the
    // new courier's registration MOVES the row instead of leaving the previous
    // owner subscribed to offers they can no longer see.
    (0, pg_core_1.uniqueIndex)('courier_devices_fcm_token_uq').on(table.fcm_token),
    (0, pg_core_1.uniqueIndex)('courier_devices_token_hash_uq').on(table.device_token_hash),
    (0, pg_core_1.index)('courier_devices_courier_idx').on(table.courier_id),
]);
// Owner-defined menu sections for the public /menu/[outlet_id] page, e.g.
// "Nasi", "Mie", "Minuman Dingin". Deliberately SEPARATE from products.category:
// category is a fixed platform list wired to the marketplace feature browse
// (see FEATURE_CATEGORY in routes/public.ts) and must not become free text.
// This is display-only grouping owned by the outlet.
//
// A real table rather than a string on the product so a rename or a reorder is
// one row instead of an edit per product, and so the owner picks from a list
// (no "Kopi" / "kopi" / "KOPI" drift).
exports.menuGroupsTable = (0, pg_core_1.pgTable)('menu_groups', {
    id: (0, pg_core_1.integer)('id').primaryKey().generatedByDefaultAsIdentity(),
    outlet_id: (0, pg_core_1.integer)('outlet_id')
        .notNull()
        .references(() => exports.outletsTable.id, { onDelete: 'cascade' }),
    name: (0, pg_core_1.varchar)('name', { length: 60 }).notNull(),
    // Owner-controlled display order; ties fall back to name.
    sort_order: (0, pg_core_1.integer)('sort_order').default(0).notNull(),
    ...columns_helper_1.timestamps,
}, (t) => [
    (0, pg_core_1.index)('menu_groups_outlet_idx').on(t.outlet_id, t.sort_order),
    // One group name per outlet — the picker relies on names being distinct.
    (0, pg_core_1.uniqueIndex)('menu_groups_outlet_name_uq').on(t.outlet_id, t.name),
]);
