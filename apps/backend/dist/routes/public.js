"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicRoutes = publicRoutes;
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const ad_schedule_1 = require("../lib/utils/ad-schedule");
const auth_1 = require("../auth");
const web_headers_1 = require("../lib/web-headers");
const geo_1 = require("../lib/utils/geo");
const coords_1 = require("../lib/utils/coords");
const road_distance_1 = require("../lib/utils/road-distance");
const service_area_1 = require("../lib/service-area");
// Scopes get-all-product?feature=... to that feature's own products. Shared with
// recalcOutletFeatures so the outlet gate (outlets.features) and the product
// gate (products.category) below are derived from one identical map — the local
// copy that used to live here is what let "bahan bangunan" go missing and drop
// out of browse while its outlets still advertised the feature.
const outlet_features_1 = require("../lib/outlet-features");
// Must not exceed the delivery cap in deliveryFeeFromDistance (orders.ts) —
// listing an outlet nobody can actually order from is worse than omitting it.
const MAX_DELIVERY_KM = 30;
// How many nearest outlets get real routing. One /table call either way, so this
// is about response size and OSRM's max-table-size, not request count. Well
// above the page size so ranking has room to reorder.
const ROUTING_CANDIDATES = 25;
const OUTLET_PAGE_SIZE = 10;
// Baseline preparation + courier-pickup allowance, on top of the outlet -> door
// drive. The drive alone would badly under-promise: nothing is cooked, packed or
// collected in zero minutes. A guess, but a stated one — the value it replaces
// was a flat "~15 min" shown for every outlet at every distance.
const PREP_MINUTES = 15;
function formatEta(driveMinutes) {
    // No routing, no honest estimate. Null so the UI can omit the chip entirely
    // rather than print a fabricated number.
    if (driveMinutes === null)
        return null;
    const total = Math.round(PREP_MINUTES + driveMinutes);
    // Rounded to 5 so it reads as the estimate it is, not false precision.
    return `~${Math.max(5, Math.round(total / 5) * 5)} min`;
}
/**
 * The signed-in customer's saved delivery address, or null.
 *
 * This endpoint is public — anonymous browsing has to keep working — so the
 * session is read opportunistically and every failure just means "no location".
 * Uses the same default-address rule as computeDeliveryFee, so the outlet a
 * customer sees ranked nearest is measured from the address they'll be charged
 * against.
 */
async function customerHomeCoords(request) {
    try {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return null;
        const [loc] = await db_1.db
            .select({ lat: schema_1.locationsTable.lat, lon: schema_1.locationsTable.lon })
            .from(schema_1.locationsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.locationsTable.user_id, session.user.id), (0, drizzle_orm_1.eq)(schema_1.locationsTable.is_default, true)))
            .limit(1);
        return loc ? (0, coords_1.parseCoordPair)(loc.lat, loc.lon) : null;
    }
    catch {
        return null;
    }
}
function mapProductRow(row) {
    return {
        id: row.products.id,
        product_name: row.products.product_name,
        image: row.products.image,
        price: Number(row.products.price),
        price_mark_down: Number(row.products.price_mark_down),
        // Service products carry a negotiable range; null for normal products.
        lowest_price: row.products.lowest_price != null ? Number(row.products.lowest_price) : null,
        highest_price: row.products.highest_price != null ? Number(row.products.highest_price) : null,
        category: row.products.category,
        isAvailable: row.products.isAvailable,
        description: row.products.description ?? "",
        ratings: Number(row.products.ratings),
        unit: row.products.unit,
        isRecommended: row.products.is_recommended,
        // Whether a courier can carry it — the cart/checkout reads this to pick the
        // order's fulfillment; it is not a customer-facing choice.
        courierDeliverable: row.products.courier_deliverable,
        // The owner's own section name ("Besi & Baja", "Semen"), which the browse
        // tabs prefer over the raw platform category — "bahan bangunan" is a
        // marketplace filing term, not something a shop would put on a shelf.
        // Null when ungrouped; the tabs fall back to `category` for those.
        menuGroup: row.menu_groups?.name ?? null,
        menuGroupOrder: row.menu_groups?.sort_order ?? null,
        discountPercent: row.products.discount_percent ?? undefined,
        outlet: row.outlets.name,
        outleid: row.outlets.id,
        reviewCount: String(row.outlets.review_count ?? 0),
        features: row.outlets.features ?? [],
    };
}
async function publicRoutes(app) {
    // Public menu for an outlet: the outlet's public info + its available products.
    // { outlet: null } => the page renders Not Found.
    app.get("/api/get-menu", async (request) => {
        const { outlet_id } = request.query;
        const id = Number(outlet_id);
        if (!outlet_id || Number.isNaN(id))
            return { outlet: null, products: [] };
        const [outlet] = await db_1.db
            .select({
            id: schema_1.outletsTable.id,
            name: schema_1.outletsTable.name,
            address: schema_1.outletsTable.address,
            phone: schema_1.outletsTable.phone,
            lat: schema_1.outletsTable.lat,
            lon: schema_1.outletsTable.lon,
            avatar: schema_1.outletsTable.avatar,
            tags: schema_1.outletsTable.tags,
            is_open: schema_1.outletsTable.is_open,
            ratings: schema_1.outletsTable.ratings,
            review_count: schema_1.outletsTable.review_count,
        })
            .from(schema_1.outletsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.outletsTable.id, id), (0, drizzle_orm_1.isNull)(schema_1.outletsTable.deletedAt)))
            .limit(1);
        if (!outlet)
            return { outlet: null, products: [] };
        const products = await db_1.db
            .select({
            id: schema_1.productsTable.id,
            product_name: schema_1.productsTable.product_name,
            price: schema_1.productsTable.price,
            price_mark_down: schema_1.productsTable.price_mark_down,
            category: schema_1.productsTable.category,
            image: schema_1.productsTable.image,
            description: schema_1.productsTable.description,
            unit: schema_1.productsTable.unit,
            ratings: schema_1.productsTable.ratings,
            review_count: schema_1.productsTable.review_count,
            is_recommended: schema_1.productsTable.is_recommended,
            isAvailable: schema_1.productsTable.isAvailable,
            discount_percent: schema_1.productsTable.discount_percent,
            // Owner-defined menu section. Left join: ungrouped products keep a null
            // here and the page falls back to grouping them by `category`.
            menu_group: schema_1.menuGroupsTable.name,
            menu_group_order: schema_1.menuGroupsTable.sort_order,
            // Drives the "Pesan" deep link on the menu detail sheet: an outlet can
            // offer several features, so the product's OWN feature decides which
            // /dashboard/order/[feature] page to open (same rule as "Order Lagi").
            features: schema_1.productsTable.features,
        })
            .from(schema_1.productsTable)
            .leftJoin(schema_1.menuGroupsTable, (0, drizzle_orm_1.eq)(schema_1.productsTable.menu_group_id, schema_1.menuGroupsTable.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, id), (0, drizzle_orm_1.eq)(schema_1.productsTable.isAvailable, true), (0, drizzle_orm_1.eq)(schema_1.productsTable.is_for_sale, true), (0, outlet_features_1.notInternalCategory)(), (0, drizzle_orm_1.isNull)(schema_1.productsTable.deletedAt)));
        return { outlet, products };
    });
    // Lightweight, UNLIMITED outlet id+updatedAt list for the frontend sitemap
    // (get-all-outlet above is a search/browse list capped at 10 — wrong shape
    // for enumerating every page that should exist in search results). Not
    // filtered by is_open: that flag is real-time "open now" status, not
    // whether the outlet's menu page is valid content — filtering by it would
    // churn the sitemap in and out all day as outlets open/close.
    app.get("/api/sitemap-outlets", async () => {
        const rows = await db_1.db
            .select({ id: schema_1.outletsTable.id, updatedAt: schema_1.outletsTable.updatedAt })
            .from(schema_1.outletsTable)
            .where((0, drizzle_orm_1.isNull)(schema_1.outletsTable.deletedAt));
        return { data: rows };
    });
    app.get("/api/get-all-outlet", async (request) => {
        const { search } = request.query;
        // Coordinates come along now: the list is ranked by how far away each outlet
        // actually is, not just by rating. Rating-only ordering with a hard limit of
        // 10 meant a shop 2 km away could be invisible behind ten better-rated ones
        // 25 km away — unorderable in practice, since delivery is capped at 50 km.
        const rows = await db_1.db
            .select({
            id: schema_1.outletsTable.id,
            name: schema_1.outletsTable.name,
            image: schema_1.outletsTable.avatar,
            tags: schema_1.outletsTable.tags,
            reviewCount: schema_1.outletsTable.review_count,
            coverImage: schema_1.outletsTable.avatar,
            address: schema_1.outletsTable.address,
            phone: schema_1.outletsTable.phone,
            features: schema_1.outletsTable.features,
            isOpen: schema_1.outletsTable.is_open,
            ratings: (0, drizzle_orm_1.sql) `COALESCE(${schema_1.outletsTable.ratings}::numeric, 0)`,
            lat: schema_1.outletsTable.lat,
            lon: schema_1.outletsTable.lon,
        })
            .from(schema_1.outletsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.isNull)(schema_1.outletsTable.deletedAt), search ? (0, drizzle_orm_1.like)(schema_1.outletsTable.name, `%${search}%`) : (0, drizzle_orm_1.sql) `true`))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.outletsTable.is_open), (0, drizzle_orm_1.desc)((0, drizzle_orm_1.sql) `${schema_1.outletsTable.ratings}::numeric`));
        const here = await customerHomeCoords(request);
        // Signed-out visitors, or a customer who hasn't saved an address yet, keep
        // the old rating-ordered list — there is nothing to measure distance from.
        if (!here) {
            return {
                data: rows.slice(0, OUTLET_PAGE_SIZE).map(({ lat, lon, ...r }) => ({
                    ...r,
                    distanceKm: null,
                    estimatedTime: r.isOpen ? null : "Tutup",
                })),
            };
        }
        // Straight-line first, as a filter rather than a ranking. Road distance is
        // always >= straight-line, so anything beyond the delivery cap in a straight
        // line is certainly beyond it by road — safe to drop before paying for
        // routing. Then route only the nearest handful.
        const reachable = rows
            .map((r) => {
            const coords = (0, coords_1.parseCoordPair)(r.lat, r.lon);
            return coords ? { row: r, coords, crow: (0, geo_1.haversineKm)(here.lat, here.lon, coords.lat, coords.lon) } : null;
        })
            .filter((c) => c !== null && c.crow <= MAX_DELIVERY_KM)
            .sort((a, b) => a.crow - b.crow)
            .slice(0, ROUTING_CANDIDATES);
        const table = await (0, road_distance_1.roadTable)(here, reachable.map((c) => c.coords));
        return {
            data: reachable
                .map((c, i) => ({ c, d: table[i] }))
                // Second pass, now on ROAD distance. The straight-line filter above only
                // narrows the routing candidates — it can't be the final word, because
                // road distance runs ~1.7x here: an outlet 40 km as the crow flies is
                // ~68 km of driving and over the cap. Listing it would let a customer
                // browse and fill a basket, then be refused at checkout when
                // deliveryFeeFromDistance throws. Better never to offer it.
                //
                // A straight-line fallback (routing unavailable) is kept rather than
                // dropped: it already passed the crow-flies test, and hiding outlets
                // because OSRM blinked would be worse than showing an optimistic one.
                .filter(({ d }) => d.source !== "road" || d.km <= MAX_DELIVERY_KM)
                .sort((a, b) => {
                // Open outlets first — a closer shop that's shut is not a better
                // answer than an open one slightly further away.
                if (a.c.row.isOpen !== b.c.row.isOpen)
                    return a.c.row.isOpen ? -1 : 1;
                // Then by travel time where routing gave us one, distance otherwise.
                const at = a.d.minutes ?? a.d.km;
                const bt = b.d.minutes ?? b.d.km;
                return at - bt;
            })
                .slice(0, OUTLET_PAGE_SIZE)
                .map(({ c, d }) => {
                const { lat, lon, ...r } = c.row;
                return {
                    ...r,
                    distanceKm: Math.round(d.km * 10) / 10,
                    estimatedTime: r.isOpen ? formatEta(d.minutes) : "Tutup",
                };
            }),
        };
    });
    app.get("/api/get-all-product", async (request) => {
        const { name, id, feature } = request.query;
        const outletId = id ? Number(id) : NaN;
        const nameFilter = name
            ? (0, drizzle_orm_1.or)((0, drizzle_orm_1.ilike)(schema_1.productsTable.product_name, `%${name}%`), (0, drizzle_orm_1.ilike)(schema_1.outletsTable.name, `%${name}%`))
            : (0, drizzle_orm_1.sql) `true`;
        const featureFilter = feature
            ? (0, drizzle_orm_1.sql) `${schema_1.outletsTable.features} @> ARRAY[${feature}]::text[]`
            : (0, drizzle_orm_1.sql) `true`;
        // The customer browses by feature slug (e.g. "service"), but products are
        // stored by category (e.g. "jasa"). Without this, feature=service returns
        // every product of a service-offering outlet (its food/drink too) instead of
        // the actual services. Map the slug to its category and scope by it.
        const categoryFilter = feature && outlet_features_1.FEATURE_CATEGORY[feature]
            ? (0, drizzle_orm_1.eq)(schema_1.productsTable.category, outlet_features_1.FEATURE_CATEGORY[feature])
            : (0, drizzle_orm_1.sql) `true`;
        const baseWhere = (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productsTable.isAvailable, true), (0, drizzle_orm_1.eq)(schema_1.productsTable.is_for_sale, true), (0, outlet_features_1.notInternalCategory)(), (0, drizzle_orm_1.isNull)(schema_1.productsTable.deletedAt), nameFilter, featureFilter, categoryFilter, (0, drizzle_orm_1.eq)(schema_1.outletsTable.is_open, true));
        if (!isNaN(outletId) && outletId > 0) {
            const rows = await db_1.db.select().from(schema_1.productsTable)
                .innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, schema_1.outletsTable.id))
                .leftJoin(schema_1.menuGroupsTable, (0, drizzle_orm_1.eq)(schema_1.productsTable.menu_group_id, schema_1.menuGroupsTable.id))
                .where((0, drizzle_orm_1.and)(baseWhere, (0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, outletId)));
            return { data: rows.map(mapProductRow) };
        }
        const rows = await db_1.db.select().from(schema_1.productsTable)
            .innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, schema_1.outletsTable.id))
            .leftJoin(schema_1.menuGroupsTable, (0, drizzle_orm_1.eq)(schema_1.productsTable.menu_group_id, schema_1.menuGroupsTable.id))
            .where(baseWhere)
            .orderBy((0, drizzle_orm_1.desc)(schema_1.productsTable.ratings))
            .limit(25);
        return { data: rows.map(mapProductRow) };
    });
    /**
     * Marketplace-wide product search (the /dashboard/search-order page).
     *
     * Distinct from get-all-product, which is the browse feed: that one is scoped
     * to one feature or one outlet and hides anything that isn't in an open shop.
     * Search is the opposite contract — a customer typing "bebek goreng" wants
     * every match there is, so closed outlets stay in the results and are simply
     * sorted last and flagged, rather than silently missing.
     *
     * Public on purpose: it reads the session only to measure distance, so
     * anonymous browsing keeps working (with distanceKm null).
     */
    app.get("/api/search-products", async (request) => {
        const { q, limit, offset } = request.query;
        const term = (q ?? "").trim();
        const take = Math.min(Math.max(Number(limit) || 24, 1), 48);
        const skip = Math.max(Number(offset) || 0, 0);
        const pattern = `%${term}%`;
        // An empty query isn't an error — it's the state the page opens in, and it
        // answers with the best-rated things on the marketplace so the list is never
        // a blank rectangle.
        const match = term
            ? (0, drizzle_orm_1.or)((0, drizzle_orm_1.ilike)(schema_1.productsTable.product_name, pattern), (0, drizzle_orm_1.ilike)(schema_1.productsTable.description, pattern), (0, drizzle_orm_1.ilike)(schema_1.productsTable.category, pattern), (0, drizzle_orm_1.ilike)(schema_1.outletsTable.name, pattern), (0, drizzle_orm_1.sql) `EXISTS (SELECT 1 FROM unnest(${schema_1.outletsTable.tags}) AS tag WHERE tag ILIKE ${pattern})`)
            : (0, drizzle_orm_1.sql) `true`;
        // Name-starts-with beats name-contains beats matched-on-the-shop-name. Without
        // this, "kebab" puts every product of a stall called "Kebab Turki" above the
        // actual kebabs. Omitted entirely when there's no term — a constant in ORDER
        // BY is read by Postgres as a column ordinal, not a value, and errors out.
        const relevance = term
            ? [
                (0, drizzle_orm_1.sql) `CASE
            WHEN ${schema_1.productsTable.product_name} ILIKE ${term + "%"} THEN 0
            WHEN ${schema_1.productsTable.product_name} ILIKE ${pattern} THEN 1
            WHEN ${schema_1.outletsTable.name} ILIKE ${pattern} THEN 2
            ELSE 3
          END`,
            ]
            : [];
        const rows = await db_1.db
            .select({
            id: schema_1.productsTable.id,
            name: schema_1.productsTable.product_name,
            image: schema_1.productsTable.image,
            description: schema_1.productsTable.description,
            category: schema_1.productsTable.category,
            price: schema_1.productsTable.price,
            priceMarkDown: schema_1.productsTable.price_mark_down,
            lowestPrice: schema_1.productsTable.lowest_price,
            highestPrice: schema_1.productsTable.highest_price,
            discountPercent: schema_1.productsTable.discount_percent,
            unit: schema_1.productsTable.unit,
            ratings: schema_1.productsTable.ratings,
            reviewCount: schema_1.productsTable.review_count,
            outletId: schema_1.outletsTable.id,
            outletName: schema_1.outletsTable.name,
            outletAvatar: schema_1.outletsTable.avatar,
            outletRatings: schema_1.outletsTable.ratings,
            outletIsOpen: schema_1.outletsTable.is_open,
            outletFeatures: schema_1.outletsTable.features,
            lat: schema_1.outletsTable.lat,
            lon: schema_1.outletsTable.lon,
        })
            .from(schema_1.productsTable)
            .innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, schema_1.outletsTable.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productsTable.isAvailable, true), (0, drizzle_orm_1.eq)(schema_1.productsTable.is_for_sale, true), (0, outlet_features_1.notInternalCategory)(), (0, drizzle_orm_1.isNull)(schema_1.productsTable.deletedAt), (0, drizzle_orm_1.isNull)(schema_1.outletsTable.deletedAt), match))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.outletsTable.is_open), ...relevance, (0, drizzle_orm_1.desc)((0, drizzle_orm_1.sql) `COALESCE(${schema_1.productsTable.ratings}::numeric, 0)`), (0, drizzle_orm_1.desc)(schema_1.productsTable.review_count))
            .limit(take)
            .offset(skip);
        const here = await customerHomeCoords(request);
        const data = rows
            .map((r) => {
            const coords = (0, coords_1.parseCoordPair)(r.lat, r.lon);
            // Straight-line, not routed: a search page turns over dozens of rows per
            // keystroke and one OSRM table call per query would be paid on every one
            // of them. The browse list still routes — this number is a rough "how far
            // is this from me", and the outlet page recomputes it properly.
            const distanceKm = here && coords
                ? Math.round((0, geo_1.haversineKm)(here.lat, here.lon, coords.lat, coords.lon) * 10) / 10
                : null;
            const feature = outlet_features_1.CATEGORY_FEATURE[r.category] ?? r.outletFeatures[0] ?? "food";
            return {
                id: r.id,
                name: r.name,
                image: r.image,
                description: r.description ?? "",
                category: r.category,
                feature,
                isService: r.category === outlet_features_1.FEATURE_CATEGORY.service,
                price: Number(r.price),
                priceMarkDown: Number(r.priceMarkDown),
                lowestPrice: r.lowestPrice != null ? Number(r.lowestPrice) : null,
                highestPrice: r.highestPrice != null ? Number(r.highestPrice) : null,
                discountPercent: r.discountPercent ?? null,
                unit: r.unit,
                ratings: Number(r.ratings ?? 0),
                reviewCount: r.reviewCount ?? 0,
                outletId: r.outletId,
                outletName: r.outletName,
                outletAvatar: r.outletAvatar,
                outletRatings: Number(r.outletRatings ?? 0),
                outletIsOpen: r.outletIsOpen,
                distanceKm,
            };
        })
            // Nothing beyond the delivery cap can be ordered, so offering it is a dead
            // end. Jasa is exempt for the same reason the outlet page exempts it:
            // nothing is transported, so distance doesn't disqualify the listing.
            .filter((p) => p.isService || p.distanceKm === null || p.distanceKm <= MAX_DELIVERY_KM);
        // Measured on the rows the query returned, not on `data` — the distance
        // filter above can empty a page that still has pages behind it.
        return { success: true, data, hasMore: rows.length === take };
    });
    app.get("/api/get-outlet-id", async (request, reply) => {
        const { outletId } = request.query;
        if (!outletId)
            return reply.status(400).send({ error: "outletId is required" });
        const rows = await db_1.db
            .select({
            id: schema_1.outletsTable.id,
            name: schema_1.outletsTable.name,
            image: schema_1.outletsTable.avatar,
            tags: schema_1.outletsTable.tags,
            reviewCount: schema_1.outletsTable.review_count,
            coverImage: schema_1.outletsTable.avatar,
            address: schema_1.outletsTable.address,
            phone: schema_1.outletsTable.phone,
            features: schema_1.outletsTable.features,
            isOpen: schema_1.outletsTable.is_open,
            ratings: (0, drizzle_orm_1.sql) `COALESCE(${schema_1.outletsTable.ratings}::numeric, 0)`,
            lat: schema_1.outletsTable.lat,
            lon: schema_1.outletsTable.lon,
        })
            .from(schema_1.outletsTable)
            .where((0, drizzle_orm_1.eq)(schema_1.outletsTable.id, Number(outletId)))
            .limit(1);
        if (!rows[0])
            return reply.status(404).send({ error: "Outlet not found" });
        const { lat, lon, ...outlet } = rows[0];
        // Same real ETA as the browse list. This header used to read "~15 min" for
        // every outlet regardless of distance — the customer's first and most
        // prominent time signal, and it was the same number 500 m away or 25 km away.
        const here = await customerHomeCoords(request);
        const there = (0, coords_1.parseCoordPair)(lat, lon);
        const distance = here && there ? (await (0, road_distance_1.roadTable)(here, [there]))[0] : null;
        return {
            data: {
                ...outlet,
                distanceKm: distance ? Math.round(distance.km * 10) / 10 : null,
                estimatedTime: outlet.isOpen ? formatEta(distance?.minutes ?? null) : "Tutup",
                // Beyond the delivery cap by ROAD. The browse list already hides these,
                // but this page is reachable by direct link, bookmark, or an old order —
                // so it has to know, and say so up front instead of letting someone
                // build a basket that checkout will refuse.
                //
                // Only asserted on a real routed measurement: with no session, no saved
                // address, or routing down, "too far" is not something we know.
                outOfRange: distance?.source === "road" && distance.km > MAX_DELIVERY_KM,
            },
        };
    });
    app.get("/api/get-outlet-ads", async (request, reply) => {
        const { outletId: outletIdParam } = request.query;
        const outletId = Number(outletIdParam);
        if (!outletId || isNaN(outletId)) {
            return reply.status(400).send({ success: false, data: [] });
        }
        const { now, day, hour } = (0, ad_schedule_1.getCurrentAdSlot)();
        const rows = await db_1.db
            .select({
            id: schema_1.productAdsTable.id,
            title: schema_1.productAdsTable.title,
            description: schema_1.productAdsTable.description,
            banner_image: schema_1.productAdsTable.banner_image,
            product_id: schema_1.productAdsTable.product_id,
        })
            .from(schema_1.productAdsTable)
            .innerJoin(schema_1.productAdsSchedule, (0, drizzle_orm_1.eq)(schema_1.productAdsSchedule.productAdsSchedule_id, schema_1.productAdsTable.id))
            .innerJoin(schema_1.scheduleProductAdsTable, (0, drizzle_orm_1.eq)(schema_1.scheduleProductAdsTable.id, schema_1.productAdsSchedule.scheduleProductAdsTable_id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productAdsTable.outlet_id, outletId), (0, drizzle_orm_1.eq)(schema_1.productAdsTable.status, "approved"), (0, drizzle_orm_1.eq)(schema_1.productAdsTable.is_active, true), (0, drizzle_orm_1.lte)(schema_1.productAdsTable.starts_at, now), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.productAdsTable.ends_at), (0, drizzle_orm_1.gte)(schema_1.productAdsTable.ends_at, now)), (0, drizzle_orm_1.sql) `${schema_1.scheduleProductAdsTable.time}->>'day' = ${day}`, (0, drizzle_orm_1.sql) `${schema_1.scheduleProductAdsTable.time}->>'hour' = ${hour}`));
        return { success: true, data: rows };
    });
    /**
     * The courier coverage circle, for surfaces that need to warn about it.
     *
     * Returns the shape rather than answering "is this point covered", so the
     * registration form can evaluate it locally as the owner moves their pin —
     * a round-trip per drag would make the warning lag behind the map.
     *
     * Public: it's a business boundary an outlet owner needs before signing up,
     * not a secret. `area: null` means unconfigured, which every caller treats as
     * "no restriction" rather than "nothing is covered".
     */
    app.get("/api/service-area", async () => {
        return { success: true, area: await (0, service_area_1.getServiceArea)() };
    });
    app.get("/api/get-categories", async (request, reply) => {
        const { outletId: outletIdParam } = request.query;
        if (!outletIdParam)
            return reply.status(400).send({ success: false, message: "Missing outletId" });
        try {
            const categories = await db_1.db
                .selectDistinct({ category: schema_1.productsTable.category })
                .from(schema_1.productsTable)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, parseInt(outletIdParam, 10)), (0, drizzle_orm_1.eq)(schema_1.productsTable.is_for_sale, true), (0, outlet_features_1.notInternalCategory)(), (0, drizzle_orm_1.isNull)(schema_1.productsTable.deletedAt)));
            return { success: true, message: "Categories fetched successfully", data: categories };
        }
        catch (error) {
            app.log.error(error, "Failed to fetch categories");
            return reply.status(500).send({ success: false, error: { message: error.message } });
        }
    });
}
