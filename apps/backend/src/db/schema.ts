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
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { timestamps } from './columns.helper';

export const VEHICLE_TYPE = pgEnum('vechile_type', ['car', 'motorcycle']);

// A courier carries other people's money and goods to strangers' front doors,
// so joining is an application an admin decides on, not a signup that completes
// itself. 'rejected' is a real state rather than a deletion: the applicant is
// told why and can replace the offending photos.
export const COURIER_VERIFICATION_STATUS = pgEnum('courier_verification_status', [
  'pending',
  'approved',
  'rejected',
]);

// A dispatch offer's life. 'superseded' is separate from 'expired' on purpose:
// expired means a courier was given the order and let the clock run out (which
// belongs in their record), superseded means dispatch moved on for a reason
// that isn't their fault — the order was cancelled, or somebody else got there
// first through the open pool.
export const OFFER_STATE = pgEnum('offer_state', [
  'offered',
  'accepted',
  'declined',
  'expired',
  'superseded',
]);

// The exact set an applicant must produce. Fixed slots, not a free-form gallery:
// an admin comparing a face against a SIM photo needs to know which shot is
// which, and a missing angle has to be nameable ("foto kiri belum ada").
export const COURIER_DOCUMENT_KIND = pgEnum('courier_document_kind', [
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
// Where the order was rung up. pos = the cashier screen; app = a customer
// ordering for themselves.
//
// This exists because "is it a cashier order?" was previously answered by
// joining out to users.email and comparing it to the hardcoded offline-customer
// address (routes/admin.ts, routes/owner.ts). That test is fine for a read-only
// filter tab, but cancellation is destructive and must not depend on a string
// literal that four files keep their own copy of — nor on the `|| 1` fallback
// in add-order-detail, which silently attaches POS orders to customer id 1 on
// any database where that email was never seeded. Those orders do not match
// the email test and would be undeletable.
//
// The old email checks are deliberately left in place for now; this column is
// the identity test for new work only.
export const ORDER_SOURCE = pgEnum('order_source', ['app', 'pos']);
// delivery = courier-fulfilled order (food/drink/mart): goes through the courier
// lobby + on_delivery leg. service = no courier: owner drives the whole flow and
// the customer accepts at the end (see the service order endpoints).
// materials = bulky goods (besi, keramik, kulkas) the outlet delivers with its
// own driver. No courier either, but unlike service the goods have fixed prices
// and real stock — what the owner quotes is the haul, into orders.delivery_fee,
// capped by the products' [lowest_price, highest_price] band.
export const ORDER_FULFILLMENT = pgEnum('order_fulfillment', [
  'delivery',
  'service',
  'materials',
]);
// "Tugaskan Kurir": a courier hired directly, with no outlet and no products in
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
export const ERRAND_STATUS = pgEnum('errand_status', [
  'pending',
  'on_delivery',
  'delivered',
  'rejected_by_courier',
  'rejected_by_customer',
  'cancelled_by_customer',
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
// How an invoice payment actually came in. Finer than the cash/transfer split
// the cashflow ledger needs — every non-cash method still books as 'transfer'
// there (see cashflowTypeFor), this enum just keeps the real-world label so the
// owner can tell a QRIS settlement from a bank transfer on the invoice.
export const INVOICE_PAYMENT_METHOD = pgEnum('invoice_payment_method', [
  'cash',
  'transfer',
  'qris',
  'debit',
  'credit',
  'ewallet',
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
  // An in-house production batch: the ingredients go out, the batch comes in.
  // Not 'purchase' (no cash moved — it moved when the ingredients were bought)
  // and not 'adjustment' (nothing was recounted).
  'production',
]);

export const usersTable = pgTable('users', {
  id: text('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  // Canonical 628… form — see lib/utils/phone.ts. Everything that writes here
  // must go through normalizeIndonesianPhone, or the column drifts back into
  // holding six spellings of one number.
  // Unique since "Tugaskan Kurir": a courier identifies the customer he is about
  // to deal with by looking their number up, and a number shared by two
  // accounts makes that lookup meaningless.
  //
  // The DEFAULT is gone on purpose. It used to be the literal '082222222222',
  // which under a unique constraint means the first signup succeeds and every
  // signup after it dies on a constraint violation. Nullable rather than
  // notNull because Postgres allows unlimited NULLs under UNIQUE — that is what
  // the placeholder rows were migrated to. A user with a null phone simply
  // cannot be reached, and cannot use Tugaskan Kurir until they set one.
  phone: varchar('phone', { length: 255 }).unique(),
  // Proof the number is actually reachable on WhatsApp, established by the OTP
  // flow in routes/phone-verification.ts. Resets to false on every change of
  // `phone` — a verified flag left standing over a new number certifies nothing.
  phone_verified: boolean('phone_verified').default(false).notNull(),
  // When the user last CHANGED their number, gating the one-per-month limit.
  // Null means never changed, so the first edit is free: a typo caught right
  // after signup shouldn't cost someone a month of being uncontactable.
  phone_changed_at: timestamp('phone_changed_at', { withTimezone: true }),
  email: varchar('email', { length: 255 }).notNull().unique(),
  address: varchar('address', { length: 255 }).default('Jl. Contoh'),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image').default('avatar.png'),
  ...timestamps,
});

/**
 * Pending WhatsApp verification links, mirroring how email verification works:
 * we send a one-time link, the user taps it, the number is proven reachable.
 *
 * The token is stored HASHED. It is a bearer secret — whoever holds it can mark
 * a number verified — so a dump of this table in plaintext would hand over every
 * pending verification. The link carries the raw token; only its SHA-256 lands
 * here, exactly like a password reset token.
 *
 * Rows are kept after use (consumed_at set) rather than deleted: `sent_at` is
 * what the resend cooldown and the daily send cap are counted from, and deleting
 * the row would reset both — which is the whole cost control, since every send
 * is a billed WhatsApp template message.
 */
export const phoneVerificationsTable = pgTable(
  'phone_verifications',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => usersTable.id),
    // The number this link was sent to, canonical 628…. Checked again when the
    // link is opened: a user who edits their number after requesting a link
    // must not be able to verify the new one with the old link.
    phone: varchar('phone', { length: 255 }).notNull(),
    token_hash: varchar('token_hash', { length: 128 }).notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumed_at: timestamp('consumed_at', { withTimezone: true }),
    sent_at: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    index('phone_verifications_user_idx').on(table.user_id, table.sent_at),
    // The lookup the verify endpoint does: hash the token from the URL, find
    // its row. Unique because a collision here would be two users' links
    // resolving to one record.
    uniqueIndex('phone_verifications_token_uq').on(table.token_hash),
  ],
);

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
  courier_reachable: boolean('courier_reachable').default(true).notNull(),

  // --- Counter tax (PB1 / PPN), configured per outlet ---
  //
  // Never hardcoded: PB1 (pajak restoran) is set by each kabupaten/kota and PPN
  // for goods is different again, so the rate is the merchant's to enter. The
  // label rides along so the receipt can print what was actually charged
  // ("PB1 10%") instead of a generic "Pajak".
  //
  // tax_inclusive is the whole reason this is three columns and not one. It
  // says which side of the menu price the tax sits on:
  //   false — prices are net, tax is ADDED at checkout (total goes up)
  //   true  — "harga sudah termasuk pajak": the price already contains the tax,
  //           and checkout EXTRACTS it so the books can tell revenue from the
  //           portion being held for the tax office. The customer pays the same
  //           either way; what changes is what counts as income.
  //
  // Same model as invoicesTable, deliberately — one tax convention in this
  // codebase, not two.
  tax_enabled: boolean('tax_enabled').default(false).notNull(),
  tax_rate: numeric('tax_rate', { precision: 5, scale: 2 })
    .default('0')
    .notNull(),
  tax_inclusive: boolean('tax_inclusive').default(false).notNull(),
  tax_label: varchar('tax_label', { length: 20 }).default('Pajak').notNull(),

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

export const customersTable = pgTable(
  'customers',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    user_id: text('user_id')
      .notNull()
      .references(() => usersTable.id),
    ratings: numeric('ratings', { precision: 3, scale: 2 }).default('5'),
    review_count: integer('review_count').default(0).notNull(),
    ...timestamps,
  },
  (table) => [
    // One LIVE customer row per account, enforced in the database rather than
    // only in the handler. /api/register-role checks first, but that is
    // check-then-insert: two submits landing together can both pass the check.
    // The form's disabled button and the endpoint's guard are the friendly
    // errors; this is the one that cannot be raced.
    //
    // Partial, because removal is soft here. A full unique index would outlaw
    // the perfectly normal history of "registered, removed by an admin,
    // registered again" — real rows in the dev database look exactly like that.
    uniqueIndex('customers_user_id_uq')
      .on(table.user_id)
      .where(sql`deleted_at IS NULL`),
  ],
);

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
export const serviceAreaTable = pgTable('service_area', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  center_lat: numeric('center_lat', { precision: 10, scale: 7 }).notNull(),
  center_lon: numeric('center_lon', { precision: 10, scale: 7 }).notNull(),
  radius_km: integer('radius_km').notNull().default(50),
  // Who last moved it. Null-safe on user deletion — the history of the change
  // matters more than being able to name the admin forever.
  updated_by: text('updated_by').references(() => usersTable.id, { onDelete: 'set null' }),
  ...timestamps,
});

export const couriersTable = pgTable(
  'couriers',
  {
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
  // Last reported position, for the customer's live delivery ETA. Only written
  // while the courier has an order in flight — this is not a movement history,
  // just "where are they now", overwritten in place.
  //
  // numeric, NOT varchar like outlets.lat/locations.lat. Those are strings, and
  // a varchar happily stored '' and the literal text 'NaN', which is exactly how
  // coordinates poisoned the map picker (see migration 0041). Postgres rejects
  // both here.
  last_lat: numeric('last_lat', { precision: 10, scale: 7 }),
  last_lon: numeric('last_lon', { precision: 10, scale: 7 }),
  // Staleness marker: a position from 40 minutes ago is not "live", and the ETA
  // must fall back rather than quietly present it as current.
  last_location_at: timestamp('last_location_at', { withTimezone: true }),
  // Document review. Defaults to 'pending' so every future applicant goes
  // through an admin; migration 0048 backfills the couriers who already exist
  // to 'approved', because they were vetted by whatever process predates this
  // and taking them off the road on deploy day would be an outage, not a policy.
  verification_status: COURIER_VERIFICATION_STATUS('verification_status')
    .notNull()
    .default('pending'),
  // Why an application was rejected, shown verbatim to the applicant — a
  // rejection they can't act on just produces the same photos again.
  verification_note: varchar('verification_note', { length: 500 }),
  verified_at: timestamp('verified_at', { withTimezone: true }),
  verified_by: text('verified_by').references((): AnyPgColumn => usersTable.id),
  ...timestamps,
},
  (table) => [
    // Same reasoning, same partial condition as customers_user_id_uq. The
    // register-role guard applies the identical "live rows only" rule: the two
    // must never disagree, or a submit the handler waves through dies on a
    // constraint violation instead of getting a readable 409.
    uniqueIndex('couriers_user_id_uq')
      .on(table.user_id)
      .where(sql`deleted_at IS NULL`),
  ],
);

/**
 * The photos an applicant submits, one row per required slot.
 *
 * Unique on (courier_id, kind) so re-uploading a rejected angle replaces it
 * rather than piling up: an admin must always be looking at the current answer
 * for each slot, never at a stack they have to date-sort first.
 */
export const courierDocumentsTable = pgTable(
  'courier_documents',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    courier_id: integer('courier_id')
      .notNull()
      .references(() => couriersTable.id, { onDelete: 'cascade' }),
    kind: COURIER_DOCUMENT_KIND('kind').notNull(),
    image: varchar('image', { length: 255 }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('courier_documents_courier_kind_uq').on(table.courier_id, table.kind),
  ],
);

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
    // Owner's own menu section for the public /menu page (see menuGroupsTable).
    // NOT a replacement for `category` above: that one is a fixed platform list
    // driving the marketplace feature browse. Null = ungrouped, which the menu
    // page falls back to rendering under the product's category.
    // onDelete: set null — deleting a section must ungroup its products, never
    // delete them. Lazy thunk because menuGroupsTable is declared further down.
    menu_group_id: integer('menu_group_id').references(
      (): AnyPgColumn => menuGroupsTable.id,
      { onDelete: 'set null' },
    ),
    isAvailable: boolean('is_available').default(true).notNull(),
    // false = inventory-only item: tracked in stock and usable on invoices, but
    // hidden from the customer ordering flow (customers can't pick it).
    is_for_sale: boolean('is_for_sale').default(true).notNull(),
    // false = this product has no countable stock of its own (a recipe/menu item
    // made from ingredients, or a service). Invoice posting only moves stock for
    // track_stock products; the Stok page only lists them.
    track_stock: boolean('track_stock').default(true).notNull(),
    // false = a courier can NOT carry this (besi, keramik, wastafel, a fridge).
    // Set by the owner in the product form — they're the one who knows the
    // goods. Building materials are deliberately NOT uniformly courier-less:
    // semen/cat/paku ride a motorcycle fine. Read at checkout to decide the
    // order's fulfillment (all items deliverable -> courier flow; any item not
    // -> the no-courier flow), never by the customer. Default true so every
    // existing product keeps its current behaviour.
    courier_deliverable: boolean('courier_deliverable').default(true).notNull(),
    description: varchar('description', { length: 255 }).default(''),
    unit: varchar('unit', { length: 10 }).notNull().default('pcs'),
    // Optional — mainly for "mart"/retail goods, but available on any category
    // (packaged drinks, building materials, etc. can carry a real barcode too).
    // Unique per outlet (see products_outlet_barcode_uq below) so a future
    // barcode-scanner checkout can look a code up unambiguously; NULL is exempt
    // from the constraint, so any number of products can go without one.
    barcode: varchar('barcode', { length: 64 }),
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
    // How many stock units ONE production batch of this product yields
    // ("sekali masak sambal jadi 2.5 kg"). Only meaningful for a product that
    // both tracks stock and has recipe rows — an in-house intermediate.
    // This is a DEFAULT FOR THE PRODUCTION FORM, nothing else reads it:
    // recipe_items.qty stays "per one output unit" for every kind of product,
    // so lib/stock.ts can expand any recipe without asking what it is looking at.
    yield_qty: numeric('yield_qty', { precision: 12, scale: 3 })
      .notNull()
      .default('1'),
    // Running weighted-average unit cost, maintained by the cost ledger
    // (lib/cost.ts). Cached balance derived from stock_movements.cost_change,
    // exactly as `stock` above is derived from qty_change.
    //
    // This is what the goods on the shelf are actually worth, as opposed to
    // buying_price, which is what the owner last typed into the form. For a
    // produced intermediate it is the only honest figure there is — nobody ever
    // bought a batch of sambal. Scale 4 so per-gram costs do not round to zero.
    avg_cost: numeric('avg_cost', { precision: 14, scale: 4 })
      .notNull()
      .default('0'),
    // ── Variants (migration 0071) ──────────────────────────────────────────
    // A VARIANT IS NOT AN ADD-ON. An add-on adds a line to the order; a variant
    // decides WHICH THING the line is. "Large" is not a Kopi Susu with
    // something added — it is a different drink, at its own price, made of
    // different amounts of the same milk.
    //
    // So a variant is a products row like any other, pointed at its base by
    // variant_of, and it therefore carries its own price, stock, recipe,
    // avg_cost, barcode and availability. Nothing in the sale path knows the
    // word: lib/cogs.ts freezes the variant's own unit_cost, lib/stock.ts
    // expands the variant's own recipe, and every per-product report already
    // groups by product_id, so "Kopi Susu (Large) x37" needs no reporting
    // change at all. Same trade that made add-on options real products (0069).
    //
    // NULL = an ordinary product, and adding variants does not stop it being
    // one: the base stays sellable and is the FIRST option in its own picker.
    // That is what makes the feature free for an existing catalogue — a
    // product with no variants behaves exactly as it did before 0071.
    //
    // ONE LEVEL DEEP: a variant is never itself a base. The database only
    // blocks self-reference (products_variant_not_self); the real rule lives in
    // the write path, exactly as it does for add-on children.
    variant_of: text('variant_of').references(
      (): AnyPgColumn => productsTable.id,
      // NOT cascade: a variant's row is referenced by orderDetails, invoiceItems
      // and the stock ledger, and deleting a product must never rewrite
      // financial history. routes/products.ts archives a base's variants
      // alongside it; this is only the floor under that.
      { onDelete: 'set null' },
    ),
    // This row's short label among its siblings — "Reguler", "Large", "Dingin".
    // Set on the base too, naming the base's own option.
    //
    // NOT the product's name. product_name stays the full "Kopi Susu (Large)",
    // because that is the string receipts, kitchen tickets, the stock page and
    // every sales report print, and none of them have a base to read context
    // from. This column is only ever rendered beside its siblings.
    variant_name: varchar('variant_name', { length: 40 }),
    // The question the picker asks, on the BASE row only: "Ukuran", "Suhu".
    // Per product, not per outlet the way addon_groups are shared — a variant
    // set is not reusable, because the options ARE this product's own rows.
    // NULL falls back to "Varian" in the UI.
    variant_label: varchar('variant_label', { length: 40 }),
    // Menu order, not price order. The base always sorts first: it is the
    // default, whatever the owner charges for it.
    variant_sort: integer('variant_sort').default(0).notNull(),
    ...timestamps,
  },
  (table) => [
    index('products_available_deleted_idx').on(
      table.isAvailable,
      table.deletedAt,
    ),
    index('products_outlet_id_idx').on(table.outlet_id),
    uniqueIndex('products_outlet_barcode_uq').on(
      table.outlet_id,
      table.barcode,
    ),
    // Every read is "this base's variants, in menu order".
    index('products_variant_of_idx').on(table.variant_of, table.variant_sort),
  ],
);

/**
 * One cashier's stint at the drawer: opened with a float, closed with a count.
 *
 * The shift exists so the three things a closing report needs can be FACTS
 * rather than guesses. Without it: "modal awal" is unrecorded, "jam buka/tutup"
 * has to be faked from the first and last order of the day, and nothing ever
 * compares the money in the drawer against the money the system thinks is in
 * it — which is the only part of the report that catches anything.
 *
 * Sales and cash movements point AT the shift (orders.shift_id,
 * cashFlows.shift_id) instead of being gathered by a time window. A window
 * would have to answer "which local day?" for a shift that closes after
 * midnight and would silently re-bucket a sale if anyone's clock drifted; a
 * foreign key just says which stint rang it up. See lib/timezone.ts for why
 * date maths is the thing to avoid here.
 *
 * opening_float is deliberately NOT a cashflow row. It is drawer float — money
 * moved from a safe or yesterday's takings into a till — not income, and
 * booking it as cash-in would inflate both the day's revenue and this report's
 * own "Total Tunai Masuk" (which sums the ledger, so the float would land in it
 * twice). It lives here and nowhere else.
 *
 * The closing figures (expected/counted/variance) are frozen columns rather
 * than derived at read time, because the whole point of a count is what it said
 * AT THE MOMENT it was counted. A later cancellation or backdated cash entry
 * must not quietly rewrite a discrepancy someone already signed off on.
 */
export const cashierShiftsTable = pgTable(
  'cashier_shifts',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    outlet_id: integer('outlet_id')
      .notNull()
      .references(() => outletsTable.id),
    // Who opened it. The name is frozen alongside because the report is a
    // record: renaming the user account later must not rewrite shifts they
    // already closed, and an employee row can be deactivated and gone.
    user_id: text('user_id')
      .notNull()
      .references(() => usersTable.id),
    cashier_name: varchar('cashier_name', { length: 100 }).notNull(),
    opening_float: numeric('opening_float', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    opened_at: timestamp('opened_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    // NULL means open. That is the whole status model — a separate status
    // column would be a second source of truth for the same fact, and the
    // partial unique index below already depends on this one.
    closed_at: timestamp('closed_at', { withTimezone: true }),
    counted_cash: numeric('counted_cash', { precision: 14, scale: 2 }),
    expected_cash: numeric('expected_cash', { precision: 14, scale: 2 }),
    // counted - expected. Stored rather than computed on read so it stays the
    // number that was on the printed slip: negative = short, positive = over.
    variance: numeric('variance', { precision: 14, scale: 2 }),
    closing_note: varchar('closing_note', { length: 255 }),
  },
  (table) => [
    // One open shift per outlet: a single physical drawer cannot be two
    // stints at once, and without this a second "Buka Shift" tap (or two
    // devices at the same counter) silently splits the day's takings across
    // two shifts, neither of which reconciles.
    uniqueIndex('cashier_shifts_one_open_per_outlet')
      .on(table.outlet_id)
      .where(sql`closed_at is null`),
    index('cashier_shifts_outlet_opened_idx').on(
      table.outlet_id,
      table.opened_at,
    ),
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
    source: ORDER_SOURCE('source').default('app').notNull(),
    status: ORDER_STATUS('status').default('pending').notNull(),
    promo_id: integer('promo_id').references(() => promosTable.id),
    discount_amount: varchar('discount_amount', { length: 15 }),
    delivery_fee: varchar('delivery_fee', { length: 15 }),
    scheduled_at: timestamp('scheduled_at', { withTimezone: true }),
    note: json('note'),
    rejected_by: REJECTED_BY('rejected_by'),
    rejected_reason: varchar('rejected_reason', { length: 255 }),
    // The cashier stint that rang this up, for counter sales taken while a
    // shift was open. Nullable and never enforced: a POS sale must not fail
    // because someone forgot to tap "Buka Shift", so an unattributed sale is a
    // real state. Those simply do not appear on any closing report.
    //
    // App orders never carry one — nobody is standing at the drawer for them.
    shift_id: integer('shift_id').references(() => cashierShiftsTable.id),

    // --- Tax, frozen at the moment of sale ---
    //
    // All three are NULL when no tax applied: every order taken before this
    // existed, and every order taken while the outlet has tax switched off.
    // NULL is not zero — "no tax was charged" and "tax was charged at 0%" are
    // different claims, and only one of them should print a tax line.
    //
    // Frozen rather than derived from the outlet's current settings for the
    // same reason orderDetails.unit_cost is frozen: changing the rate today
    // must not rewrite what was charged on a sale that closed last month.
    // Re-deriving would make every historical receipt a liability.
    //
    // *** orderDetails.summary_price is NOT adjusted for any of this. *** It is
    // the price the line was sold at and stays the app's revenue column — 47
    // read sites across 16 files depend on that meaning. See lib/tax.ts for
    // what each mode implies for revenue, and note the asymmetry: with
    // tax_inclusive = false, summary_price is already net of tax and every
    // reader is correct untouched; with tax_inclusive = true the price contains
    // the tax, so revenue readers must SUBTRACT tax_amount.
    tax_rate: numeric('tax_rate', { precision: 5, scale: 2 }),
    tax_amount: numeric('tax_amount', { precision: 14, scale: 2 }),
    tax_inclusive: boolean('tax_inclusive'),

    // Set when sequential dispatch has run out of couriers to offer this order
    // to. From that moment it falls back to the old free-for-all lobby, visible
    // to everyone who is online — a stuck order helps nobody, so exhausting the
    // queue must degrade to "anyone can take it", never to silence.
    offer_pool_opened_at: timestamp('offer_pool_opened_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('id_idx').on(table.id),
    index('costomer_id_idx').on(table.customer_id),
    index('courier_id_idx').on(table.courier_id),
    index('outlet_id_idx').on(table.outlet_id),
    index('orders_outlet_status_idx').on(table.outlet_id, table.status),
    // NOTE: migration 0059 adds four more indexes on this table by hand —
    // expression indexes over note ->> 'paymentMethod' / 'cashierName' /
    // 'customerName' plus (outlet_id, created_at, source), all partial on
    // deleted_at IS NULL. They are what makes the segmented reports in
    // routes/reports.ts affordable. Deliberately NOT declared here: drizzle-kit
    // cannot round-trip them, and a generate would drop them. Do not remove the
    // migration.

    index('orders_courier_status_idx').on(table.courier_id, table.status),
    // The closing report reads every order of one shift, several ways over.
    index('orders_shift_id_idx').on(table.shift_id),
  ],
);

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
export const orderOffersTable = pgTable(
  'order_offers',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    order_id: text('order_id')
      .notNull()
      .references(() => ordersTable.id, { onDelete: 'cascade' }),
    courier_id: integer('courier_id')
      .notNull()
      .references(() => couriersTable.id, { onDelete: 'cascade' }),
    state: OFFER_STATE('state').notNull().default('offered'),
    // Which pass through the courier list this was. A second round happens only
    // after everyone has been asked once, so it doubles as "how hard is this
    // order to place" — useful when an outlet keeps getting passed over.
    round: integer('round').notNull().default(1),
    offered_at: timestamp('offered_at', { withTimezone: true }).defaultNow().notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    responded_at: timestamp('responded_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    // The core invariant: an order can have only one offer in flight. Two live
    // offers would recreate the race this whole table exists to remove.
    uniqueIndex('order_offers_one_live_per_order')
      .on(table.order_id)
      .where(sql`${table.state} = 'offered'`),
    index('order_offers_courier_state_idx').on(table.courier_id, table.state),
    index('order_offers_expiry_idx').on(table.state, table.expires_at),
  ],
);

/**
 * A courier hired directly by a customer — "Tugaskan Kurir".
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
export const errandOrdersTable = pgTable(
  'errand_orders',
  {
    id: text('id').primaryKey(),
    // Straight to users, not customers. An errand needs a name, a phone and a
    // saved address — all of which live on users — and nothing customersTable
    // adds. Skipping it also means a courier can hire another courier.
    user_id: text('user_id')
      .notNull()
      .references(() => usersTable.id),
    courier_id: integer('courier_id')
      .notNull()
      .references(() => couriersTable.id),
    status: ERRAND_STATUS('status').notNull().default('pending'),
    // What the customer wants done, in their own words.
    note: text('note'),
    // The courier's own quote, written when he accepts. Null while pending —
    // nobody, including the system, knows the price before then. varchar to
    // match orders.delivery_fee rather than introduce a second money type.
    price: varchar('price', { length: 15 }),
    rejected_reason: varchar('rejected_reason', { length: 255 }),
    // Where the courier rides TO: a SNAPSHOT of the customer's default saved
    // location (locationsTable), not a reference to it. A location row is
    // editable: pointing at it would let a customer renaming "Rumah" months
    // later silently rewrite where a finished errand was delivered.
    //
    // Named pickup_* until migration 0054, which was a misnomer — an errand has
    // no outlet to collect from, so this is the destination and nothing else.
    //
    // numeric, like couriers.last_lat/lon and deliberately NOT the varchar used
    // by outlets and locations — those columns accepted '' and the literal
    // 'NaN', which is how coordinates poisoned the map picker (migration 0041).
    destination_address: varchar('destination_address', { length: 255 }),
    destination_lat: numeric('destination_lat', { precision: 10, scale: 7 }),
    destination_lon: numeric('destination_lon', { precision: 10, scale: 7 }),
    accepted_at: timestamp('accepted_at', { withTimezone: true }),
    delivered_at: timestamp('delivered_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    // Exclusivity, enforced by Postgres rather than by a handler. A courier
    // holds at most one pending request at a time, so two customers tapping the
    // same courier in the same instant resolve to one winner and one 409. A
    // read-then-write check in application code cannot win that race.
    //
    // Only 'pending' is constrained: once accepted the job moves to
    // on_delivery, and the courier is then held busy by getCourierAvailability
    // instead — see lib/utils/courier-availability.ts.
    uniqueIndex('errand_orders_courier_pending_uq')
      .on(table.courier_id)
      .where(sql`status = 'pending'`),
    index('errand_orders_user_status_idx').on(table.user_id, table.status),
    index('errand_orders_courier_status_idx').on(table.courier_id, table.status),
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
    summary_price: varchar('summary_price', { length: 10 }).notNull(),
    // Set on an ADD-ON line, pointing at the line it was added to. NULL on an
    // ordinary line, which is the overwhelming majority — see migration 0069
    // for why an add-on is a child line rather than a table of its own.
    //
    // Readers split two ways on this column and getting it wrong is silent:
    //   summing money  (order total, revenue, COGS) -> include children
    //   counting items ("3 item", a receipt's tally) -> parents only
    //
    // Exactly one level deep. A child is never itself a parent; the write path
    // refuses it rather than the schema, since a depth check in SQL costs more
    // than it protects.
    parent_detail_id: integer('parent_detail_id').references(
      (): AnyPgColumn => orderDetailsTable.id,
      { onDelete: 'cascade' },
    ),
    // What ONE unit of this line cost, frozen when the line was written.
    //
    // The cost ledger (stock_movements) covers a line only if the line MOVED
    // something. A track_stock=false product with no recipe never does — a
    // service, a fee, an item nobody counts — so its cost has always come from
    // products.buying_price, joined LIVE at report time. That join is the
    // problem this column fixes: editing a purchase price today silently
    // rewrote the profit on every sale ever made, and flipping a product's
    // track_stock changed the cost of orders that closed months ago.
    //
    // NULL means "no price was on record when this line was written" — either
    // it predates this column, or buying_price was blank/zero, which is a
    // routine state (see lib/money-sql.ts). NULL is NOT zero: readers fall back
    // to the live buying_price for those, exactly as before, so a line with no
    // cost on record starts telling the truth the day a real price is entered.
    // A frozen zero never would. Same reasoning as 0064_backfill_cost_ledger.
    //
    // Written on EVERY line, but only ever READ for the lines the ledger cannot
    // see (lib/cogs.ts). Summing it across all lines would double count every
    // line the ledger already covers.
    unit_cost: numeric('unit_cost', { precision: 14, scale: 4 }),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    status: STATUS('status'),
  },
  (table) => [
    index('order_details_created_at_idx').on(table.created_at),
    index('order_details_order_id_idx').on(table.order_id),
    index('order_details_parent_idx').on(table.parent_detail_id),
  ],
);

export const ratingsTable = pgTable(
  'ratings',
  {
    id: text('id').primaryKey(),
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
    order_details_id: integer('order_details_id').references(
      () => orderDetailsTable.id,
    ),
    errand_order_id: text('errand_order_id').references(
      () => errandOrdersTable.id,
    ),
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
    // Exactly one target, never both and never neither. order_details_id was
    // mandatory until errands existed; making it nullable without this would
    // quietly permit ratings attached to nothing at all.
    check(
      'ratings_one_target_chk',
      sql`(${table.order_details_id} IS NOT NULL AND ${table.errand_order_id} IS NULL)
        OR (${table.order_details_id} IS NULL AND ${table.errand_order_id} IS NOT NULL)`,
    ),
    index('ratings_errand_order_id_idx').on(table.errand_order_id),
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
    explanation: text('explanation'),
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
    explanation: text('explanation'),
    created_at: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('cash_out_detail_created_at_idx').on(table.created_at)],
);

export const cashFlows = pgTable(
  'cashFlows',
  {
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
    // The order this row was caused by, when there was one. Sales invoices got
    // invoicePaymentsTable to tie a payment back to its invoice; POS orders had
    // no such link at all, so the cash-in a cashier order wrote was
    // unreachable from the order.
    //
    // Cancellation needs it twice over: to book the reversal against the same
    // order, and — because the reversal is money — to answer "has this already
    // been reversed?" from the ledger itself rather than trusting the caller
    // not to double-submit.
    order_id: text('order_id').references(() => ordersTable.id),
    // The cashier stint this movement happened during, stamped at insert from
    // whichever shift was open at the outlet. This is what makes "Total Tunai
    // Masuk / Keluar" on a closing report the drawer's own arithmetic rather
    // than a time-window guess — including the cash-out a cashier books for
    // petty spending mid-shift.
    //
    // Nullable for the same reason orders.shift_id is: money still moves when
    // no shift is open (the owner posting an invoice payment from the office),
    // and that is not a failure.
    shift_id: integer('shift_id').references(() => cashierShiftsTable.id),
  },
  (table) => [
    index('cash_flows_order_id_idx').on(table.order_id),
    index('cash_flows_shift_id_idx').on(table.shift_id),
  ],
);

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
    // How that DP will be received. Lives on the header because the draft is
    // agreed before /post books the actual invoice_payments row.
    down_payment_method: INVOICE_PAYMENT_METHOD('down_payment_method')
      .notNull()
      .default('cash'),
    notes: varchar('notes', { length: 500 }).default(''),
    // Who created the invoice (owner or employee) — staff attribution for the
    // "dibuat oleh" line. Nullable: rows predating the column stay unattributed.
    created_by: text('created_by').references(() => usersTable.id),

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
    // Rows predating this column were all booked as cash, which is what the
    // default records — so the backfill is a no-op and the history stays honest.
    method: INVOICE_PAYMENT_METHOD('method').notNull().default('cash'),
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
    // ── Cost ledger ────────────────────────────────────────────────────────
    // The money side of this movement. Null on rows written before migration
    // 0063; readers must treat null as "unknown", never as zero.
    //
    // Stock coming IN carries the price it came in at (purchase price, or a
    // batch's computed cost); stock going OUT carries the weighted-average cost
    // at that moment. Frozen at write time on purpose: editing a price or a
    // recipe today must not rewrite the profit on sales that already happened.
    unit_cost: numeric('unit_cost', { precision: 14, scale: 4 }),
    // Signed money, qty_change * unit_cost. Positive = value in, negative =
    // value out. COGS over a period is -sum(cost_change) where reason='sales';
    // voids net themselves out, carrying the opposite sign.
    cost_change: numeric('cost_change', { precision: 14, scale: 2 }),
    // The invoice that caused this movement (null for manual adjustments).
    invoice_id: integer('invoice_id').references(() => invoicesTable.id),
    // The POS order that caused this movement — the cashier-side twin of
    // invoice_id above, and null for everything that did not come from a POS
    // sale. Cancelling a cashier order replays these rows (flip the sign) rather
    // than re-expanding the recipe, so a recipe edited after the sale cannot
    // change how much comes back. Movements written before migration 0062 have
    // no order_id; applySaleStockReturn keeps a re-expansion fallback for them.
    order_id: text('order_id').references((): AnyPgColumn => ordersTable.id),
    // WHICH LINE of that order caused this movement.
    //
    // order_id above says the sale happened; this says which item in it. The
    // difference matters for a composition, whose movements are written against
    // its INGREDIENTS: without this there is no way back from "3 kg of beras
    // left" to the Nasi Goreng line that took it, and lib/cogs.ts had to guess
    // which lines the ledger covered by re-reading products.track_stock and
    // recipe_items as they stand TODAY. Flip either one after the sale and the
    // guess changes: the line gets counted twice, or dropped entirely, on an
    // order that closed months ago.
    //
    // With the line recorded, "did this line leave a cost trail?" is answered by
    // history instead of by current config. A line with no rows here never moved
    // anything (a service, a fee) and is costed from orderDetails.unit_cost.
    //
    // Null for: movements from a sales INVOICE (invoice_id carries those, and
    // invoice lines are not orderDetails), and everything written before
    // migration 0066 — which is why lib/cogs.ts keeps the pre-0066 expression
    // for orders that have no tagged movement.
    order_detail_id: integer('order_detail_id').references(
      (): AnyPgColumn => orderDetailsTable.id,
    ),
    note: varchar('note', { length: 255 }).default(''),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('stock_movements_product_idx').on(table.product_id),
    index('stock_movements_outlet_idx').on(table.outlet_id),
    index('stock_movements_invoice_idx').on(table.invoice_id),
    // Serves the cancellation replay: "the sales movements of THIS order".
    index('stock_movements_order_idx').on(table.order_id),
    // Serves the reports' per-order cost drill-down.
    index('stock_movements_order_reason_idx').on(table.order_id, table.reason),
    // Serves the per-LINE cost lookup in lib/cogs.ts, which runs once per line
    // of every order on the page. Partial: only tagged rows are ever looked up
    // this way, and every row written before 0066 is null.
    index('stock_movements_order_detail_idx')
      .on(table.order_detail_id)
      .where(sql`order_detail_id IS NOT NULL`),
    // Opname history: filter by outlet + reason, range/sort on created_at.
    index('stock_movements_outlet_reason_created_idx').on(
      table.outlet_id,
      table.reason,
      table.created_at,
    ),
  ],
);

// Optional bill-of-materials: what ONE unit of `product_id` consumes. A product
// with no rows here moves no stock through a recipe at all — recipes are
// strictly opt-in. Hard-deleted, replace-on-save.
//
// Recipes NEST: an ingredient may itself have a recipe. Expansion (lib/stock.ts)
// walks down and stops at the first ingredient that tracks its own stock:
//
//   * ingredient tracks stock  -> LEAF. Decrement it and stop. This is the
//     prep-batch boundary: you count sambal, so a sold dish just draws sambal
//     down, and the chilies left stock when the batch was PRODUCED.
//   * ingredient does not      -> pass-through. Recurse into its recipe. This is
//     a "bumbu dasar" you define once and never count.
//
// So the same edge table carries both levels, and which kind of node something
// is falls out of products.track_stock rather than a separate flag. Cycles and
// depth are rejected at write time (routes/products.ts), with a second guard at
// expansion time so bad data can never spin inside a transaction.
export const recipeItemsTable = pgTable(
  'recipe_items',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    outlet_id: integer('outlet_id')
      .notNull()
      .references(() => outletsTable.id),
    // The product being made: a sold menu item, or an in-house intermediate
    // that is itself produced in batches.
    product_id: text('product_id')
      .notNull()
      .references(() => productsTable.id, { onDelete: 'cascade' }),
    // What it consumes, in that ingredient's own stock unit. May itself have a
    // recipe (see the nesting rules above).
    ingredient_id: text('ingredient_id')
      .notNull()
      .references(() => productsTable.id, { onDelete: 'cascade' }),
    // Consumed per ONE unit of product_id — never per batch, even for a product
    // with a yield_qty. Scale 3 (not 2) so gram/ml-size amounts of
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

// Web Push endpoints, one row per browser/device a user has opted in from. The
// endpoint URL is the push service's own handle for that device and is unique,
// so it doubles as the natural key for upserts — a browser re-subscribing after
// a key rotation hands back the same endpoint rather than piling up rows.
export const pushSubscriptionsTable = pgTable(
  'push_subscriptions',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    user_id: text('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    // Encryption material handed over by the browser at subscribe time.
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    user_agent: varchar('user_agent', { length: 500 }),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index('push_subscriptions_user_idx').on(t.user_id)],
);

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
export const courierDevicesTable = pgTable(
  'courier_devices',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    courier_id: integer('courier_id')
      .notNull()
      .references(() => couriersTable.id, { onDelete: 'cascade' }),
    // Rotated by FCM whenever it feels like it; the app re-registers on
    // onNewToken, which moves this row rather than creating a second one.
    fcm_token: text('fcm_token').notNull(),
    device_token_hash: text('device_token_hash').notNull(),
    platform: varchar('platform', { length: 20 }).notNull().default('android'),
    app_version: varchar('app_version', { length: 30 }),
    last_seen_at: timestamp('last_seen_at', { withTimezone: true }),
    // Set on logout. Kept rather than deleted so "this phone was signed out at
    // 14:02" is answerable when a courier says they never got an offer.
    revoked_at: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    // A physical phone belongs to one courier. If a device is handed over, the
    // new courier's registration MOVES the row instead of leaving the previous
    // owner subscribed to offers they can no longer see.
    uniqueIndex('courier_devices_fcm_token_uq').on(table.fcm_token),
    uniqueIndex('courier_devices_token_hash_uq').on(table.device_token_hash),
    index('courier_devices_courier_idx').on(table.courier_id),
  ],
);

// Owner-defined menu sections for the public /menu/[outlet_id] page, e.g.
// "Nasi", "Mie", "Minuman Dingin". Deliberately SEPARATE from products.category:
// category is a fixed platform list wired to the marketplace feature browse
// (see FEATURE_CATEGORY in routes/public.ts) and must not become free text.
// This is display-only grouping owned by the outlet.
//
// A real table rather than a string on the product so a rename or a reorder is
// one row instead of an edit per product, and so the owner picks from a list
// (no "Kopi" / "kopi" / "KOPI" drift).
export const menuGroupsTable = pgTable(
  'menu_groups',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    outlet_id: integer('outlet_id')
      .notNull()
      .references(() => outletsTable.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 60 }).notNull(),
    // Owner-controlled display order; ties fall back to name.
    sort_order: integer('sort_order').default(0).notNull(),
    ...timestamps,
  },
  (t) => [
    index('menu_groups_outlet_idx').on(t.outlet_id, t.sort_order),
    // One group name per outlet — the picker relies on names being distinct.
    uniqueIndex('menu_groups_outlet_name_uq').on(t.outlet_id, t.name),
  ],
);

// Platform-wide maintenance windows. A row is a PLANNED window, not a flag:
// scheduling it ahead of time is what lets the app warn people before the doors
// close ("maintenance in 25 minutes") instead of vanishing under them mid-order.
//
// Rows are kept after they pass — the history of when the platform was down is
// worth more than the storage — so "are we in maintenance right now" is always
// a time comparison, never a stored boolean that can be left switched on.
export const maintenanceWindowsTable = pgTable(
  'maintenance_windows',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    starts_at: timestamp('starts_at', { withTimezone: true }).notNull(),
    ends_at: timestamp('ends_at', { withTimezone: true }).notNull(),
    // Shown verbatim on the banner and the maintenance page. Optional: the UI
    // has a sensible Indonesian default so an admin in a hurry can skip it.
    message: text('message'),
    // How long before starts_at the warning banner appears.
    notice_minutes: integer('notice_minutes').notNull().default(60),
    // Set when an admin calls it off, or ends it early (ends_at is moved to now
    // for an early finish; this column is only for "it never happened").
    cancelled_at: timestamp('cancelled_at', { withTimezone: true }),
    created_by: text('created_by').references(() => usersTable.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    // The public status lookup runs on every proxied request, so it must hit an
    // index: newest-first over the window bounds.
    index('maintenance_windows_window_idx').on(t.ends_at, t.starts_at),
    check('maintenance_windows_order_ck', sql`${t.ends_at} > ${t.starts_at}`),
  ],
);

// ============================================================================
// Product add-ons ("Topping", "Level Pedas", "Ukuran").
//
// An add-on is NOT a new kind of entity. The thing being added is an ordinary
// product — with its own stock, recipe, buying_price and avg_cost — and the
// sale of it is an ordinary order line, pointed at its parent by
// orderDetails.parent_detail_id. Everything the cost ledger already does for a
// line therefore happens for an add-on with no new code: see migration 0069.
//
// These three tables are only the CATALOGUE: which questions get asked about
// which dish, and what the answers cost the customer.
//
// Nothing here is ever consulted to settle a sale. The rules govern what a
// cashier may COMPOSE in the picker; checkout honours whatever a tab already
// holds. That split is why every table below soft-deletes — a held tab lives in
// a cashier's localStorage for days, and removing an option from the menu must
// never leave a parked cart unpayable.
// ============================================================================

// One question put to the cashier. Per OUTLET rather than per product, so
// "Topping" is defined once and attached to twenty dishes via
// productAddonGroupsTable — a rename is then one row, not twenty.
export const addonGroupsTable = pgTable(
  'addon_groups',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    outlet_id: integer('outlet_id')
      .notNull()
      .references(() => outletsTable.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 60 }).notNull(),
    // min_select >= 1 IS "wajib pilih" — there is no separate required flag to
    // fall out of sync with it. max_select null = unlimited.
    //
    // Enforced in the picker, never at checkout. Tightening a rule must not
    // make an already-parked tab unpayable.
    min_select: integer('min_select').default(0).notNull(),
    max_select: integer('max_select'),
    sort_order: integer('sort_order').default(0).notNull(),
    ...timestamps,
  },
  (t) => [index('addon_groups_outlet_idx').on(t.outlet_id, t.sort_order)],
);

// One pickable answer: a product, and what the customer pays for it here.
//
// The price lives on the option rather than on the product because the same
// telur is 5.000 on one dish and free on another. 0 is a real value, not a
// missing one — a free add-on that still consumes stock and still costs money
// is precisely the case a POS ought to be able to state, and the one most of
// them get wrong.
export const addonGroupOptionsTable = pgTable(
  'addon_group_options',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    group_id: integer('group_id')
      .notNull()
      .references(() => addonGroupsTable.id, { onDelete: 'cascade' }),
    // is_for_sale=false on this product keeps it out of the POS grid on its
    // own while leaving it a full product everywhere else: stock, recipe, cost.
    product_id: text('product_id')
      .notNull()
      .references(() => productsTable.id, { onDelete: 'cascade' }),
    // numeric, unlike the varchar money on productsTable — matching the newer
    // columns (unit_cost, tax_amount, opening_float) rather than the legacy
    // ones, so it needs no money() guard when read.
    price: numeric('price', { precision: 14, scale: 2 }).default('0').notNull(),
    sort_order: integer('sort_order').default(0).notNull(),
    ...timestamps,
  },
  (t) => [
    // Partial: archiving an option and later adding it back must be allowed,
    // which a plain unique index would forbid forever.
    uniqueIndex('addon_group_options_group_product_uq')
      .on(t.group_id, t.product_id)
      .where(sql`${t.deletedAt} is null`),
    index('addon_group_options_group_idx').on(t.group_id, t.sort_order),
  ],
);

// Which questions get asked about which dish.
export const productAddonGroupsTable = pgTable(
  'product_addon_groups',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    product_id: text('product_id')
      .notNull()
      .references(() => productsTable.id, { onDelete: 'cascade' }),
    group_id: integer('group_id')
      .notNull()
      .references(() => addonGroupsTable.id, { onDelete: 'cascade' }),
    sort_order: integer('sort_order').default(0).notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('product_addon_groups_uq')
      .on(t.product_id, t.group_id)
      .where(sql`${t.deleted_at} is null`),
    index('product_addon_groups_product_idx').on(t.product_id, t.sort_order),
  ],
);
