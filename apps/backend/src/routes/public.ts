import type { FastifyInstance } from "fastify";
import { and, eq, isNull, desc, sql, like, ilike, or, gte, lte } from "drizzle-orm";
import { db } from "../db";
import { outletsTable, productsTable, productAdsTable, productAdsSchedule, scheduleProductAdsTable, menuGroupsTable, locationsTable } from "../db/schema";
import { getCurrentAdSlot } from "../lib/utils/ad-schedule";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";
import { haversineKm } from "../lib/utils/geo";
import { parseCoordPair } from "../lib/utils/coords";
import { roadTable } from "../lib/utils/road-distance";
import { getServiceArea } from "../lib/service-area";
// Scopes get-all-product?feature=... to that feature's own products. Shared with
// recalcOutletFeatures so the outlet gate (outlets.features) and the product
// gate (products.category) below are derived from one identical map — the local
// copy that used to live here is what let "bahan bangunan" go missing and drop
// out of browse while its outlets still advertised the feature.
import { CATEGORY_FEATURE, FEATURE_CATEGORY, notInternalCategory } from "../lib/outlet-features";

// Must not exceed the delivery cap in deliveryFeeFromDistance (orders.ts) —
// listing an outlet nobody can actually order from is worse than omitting it.
const MAX_DELIVERY_KM = 50;

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

function formatEta(driveMinutes: number | null): string | null {
  // No routing, no honest estimate. Null so the UI can omit the chip entirely
  // rather than print a fabricated number.
  if (driveMinutes === null) return null;
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
async function customerHomeCoords(request: any): Promise<{ lat: number; lon: number } | null> {
  try {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return null;

    const [loc] = await db
      .select({ lat: locationsTable.lat, lon: locationsTable.lon })
      .from(locationsTable)
      .where(and(eq(locationsTable.user_id, session.user.id), eq(locationsTable.is_default, true)))
      .limit(1);

    return loc ? parseCoordPair(loc.lat, loc.lon) : null;
  } catch {
    return null;
  }
}

type JoinRow = {
  products: typeof productsTable.$inferSelect;
  outlets: typeof outletsTable.$inferSelect;
  // Left-joined, so null for products the owner hasn't put in a section.
  menu_groups?: typeof menuGroupsTable.$inferSelect | null;
};

function mapProductRow(row: JoinRow) {
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

export async function publicRoutes(app: FastifyInstance) {
  // Public menu for an outlet: the outlet's public info + its available products.
  // { outlet: null } => the page renders Not Found.
  app.get("/api/get-menu", async (request) => {
    const { outlet_id } = request.query as { outlet_id?: string };
    const id = Number(outlet_id);
    if (!outlet_id || Number.isNaN(id)) return { outlet: null, products: [] };

    const [outlet] = await db
      .select({
        id: outletsTable.id,
        name: outletsTable.name,
        address: outletsTable.address,
        phone: outletsTable.phone,
        lat: outletsTable.lat,
        lon: outletsTable.lon,
        avatar: outletsTable.avatar,
        tags: outletsTable.tags,
        is_open: outletsTable.is_open,
        ratings: outletsTable.ratings,
        review_count: outletsTable.review_count,
      })
      .from(outletsTable)
      .where(and(eq(outletsTable.id, id), isNull(outletsTable.deletedAt)))
      .limit(1);

    if (!outlet) return { outlet: null, products: [] };

    const products = await db
      .select({
        id: productsTable.id,
        product_name: productsTable.product_name,
        price: productsTable.price,
        price_mark_down: productsTable.price_mark_down,
        category: productsTable.category,
        image: productsTable.image,
        description: productsTable.description,
        unit: productsTable.unit,
        ratings: productsTable.ratings,
        review_count: productsTable.review_count,
        is_recommended: productsTable.is_recommended,
        isAvailable: productsTable.isAvailable,
        discount_percent: productsTable.discount_percent,
        // Owner-defined menu section. Left join: ungrouped products keep a null
        // here and the page falls back to grouping them by `category`.
        menu_group: menuGroupsTable.name,
        menu_group_order: menuGroupsTable.sort_order,
        // Drives the "Pesan" deep link on the menu detail sheet: an outlet can
        // offer several features, so the product's OWN feature decides which
        // /dashboard/order/[feature] page to open (same rule as "Order Lagi").
        features: productsTable.features,
      })
      .from(productsTable)
      .leftJoin(menuGroupsTable, eq(productsTable.menu_group_id, menuGroupsTable.id))
      .where(
        and(
          eq(productsTable.outlet_id, id),
          eq(productsTable.isAvailable, true),
          eq(productsTable.is_for_sale, true),
          notInternalCategory(),
          isNull(productsTable.deletedAt),
        ),
      );

    return { outlet, products };
  });

  // Lightweight, UNLIMITED outlet id+updatedAt list for the frontend sitemap
  // (get-all-outlet above is a search/browse list capped at 10 — wrong shape
  // for enumerating every page that should exist in search results). Not
  // filtered by is_open: that flag is real-time "open now" status, not
  // whether the outlet's menu page is valid content — filtering by it would
  // churn the sitemap in and out all day as outlets open/close.
  app.get("/api/sitemap-outlets", async () => {
    const rows = await db
      .select({ id: outletsTable.id, updatedAt: outletsTable.updatedAt })
      .from(outletsTable)
      .where(isNull(outletsTable.deletedAt));
    return { data: rows };
  });

  app.get("/api/get-all-outlet", async (request) => {
    const { search } = request.query as { search?: string };

    // Coordinates come along now: the list is ranked by how far away each outlet
    // actually is, not just by rating. Rating-only ordering with a hard limit of
    // 10 meant a shop 2 km away could be invisible behind ten better-rated ones
    // 25 km away — unorderable in practice, since delivery is capped at 50 km.
    const rows = await db
      .select({
        id: outletsTable.id,
        name: outletsTable.name,
        image: outletsTable.avatar,
        tags: outletsTable.tags,
        reviewCount: outletsTable.review_count,
        coverImage: outletsTable.avatar,
        address: outletsTable.address,
        phone: outletsTable.phone,
        features: outletsTable.features,
        isOpen: outletsTable.is_open,
        ratings: sql<number>`COALESCE(${outletsTable.ratings}::numeric, 0)`,
        lat: outletsTable.lat,
        lon: outletsTable.lon,
      })
      .from(outletsTable)
      .where(and(
        isNull(outletsTable.deletedAt),
        search ? like(outletsTable.name, `%${search}%`) : sql`true`,
      ))
      .orderBy(desc(outletsTable.is_open), desc(sql`${outletsTable.ratings}::numeric`));

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
        const coords = parseCoordPair(r.lat, r.lon);
        return coords ? { row: r, coords, crow: haversineKm(here.lat, here.lon, coords.lat, coords.lon) } : null;
      })
      .filter((c): c is NonNullable<typeof c> => c !== null && c.crow <= MAX_DELIVERY_KM)
      .sort((a, b) => a.crow - b.crow)
      .slice(0, ROUTING_CANDIDATES);

    const table = await roadTable(here, reachable.map((c) => c.coords));

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
          if (a.c.row.isOpen !== b.c.row.isOpen) return a.c.row.isOpen ? -1 : 1;
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
    const { name, id, feature } = request.query as { name?: string; id?: string; feature?: string };
    const outletId = id ? Number(id) : NaN;

    const nameFilter = name
      ? or(ilike(productsTable.product_name, `%${name}%`), ilike(outletsTable.name, `%${name}%`))
      : sql`true`;

    const featureFilter = feature
      ? sql`${outletsTable.features} @> ARRAY[${feature}]::text[]`
      : sql`true`;

    // The customer browses by feature slug (e.g. "service"), but products are
    // stored by category (e.g. "jasa"). Without this, feature=service returns
    // every product of a service-offering outlet (its food/drink too) instead of
    // the actual services. Map the slug to its category and scope by it.
    const categoryFilter =
      feature && FEATURE_CATEGORY[feature]
        ? eq(productsTable.category, FEATURE_CATEGORY[feature])
        : sql`true`;

    const baseWhere = and(
      eq(productsTable.isAvailable, true),
      eq(productsTable.is_for_sale, true),
      notInternalCategory(),
      isNull(productsTable.deletedAt),
      nameFilter,
      featureFilter,
      categoryFilter,
      eq(outletsTable.is_open, true),
    );

    if (!isNaN(outletId) && outletId > 0) {
      const rows = await db.select().from(productsTable)
        .innerJoin(outletsTable, eq(productsTable.outlet_id, outletsTable.id))
        .leftJoin(menuGroupsTable, eq(productsTable.menu_group_id, menuGroupsTable.id))
        .where(and(baseWhere, eq(productsTable.outlet_id, outletId)));
      return { data: rows.map(mapProductRow) };
    }

    const rows = await db.select().from(productsTable)
      .innerJoin(outletsTable, eq(productsTable.outlet_id, outletsTable.id))
      .leftJoin(menuGroupsTable, eq(productsTable.menu_group_id, menuGroupsTable.id))
      .where(baseWhere)
      .orderBy(desc(productsTable.ratings))
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
    const { q, limit, offset } = request.query as {
      q?: string;
      limit?: string;
      offset?: string;
    };

    const term = (q ?? "").trim();
    const take = Math.min(Math.max(Number(limit) || 24, 1), 48);
    const skip = Math.max(Number(offset) || 0, 0);
    const pattern = `%${term}%`;

    // An empty query isn't an error — it's the state the page opens in, and it
    // answers with the best-rated things on the marketplace so the list is never
    // a blank rectangle.
    const match = term
      ? or(
          ilike(productsTable.product_name, pattern),
          ilike(productsTable.description, pattern),
          ilike(productsTable.category, pattern),
          ilike(outletsTable.name, pattern),
          sql`EXISTS (SELECT 1 FROM unnest(${outletsTable.tags}) AS tag WHERE tag ILIKE ${pattern})`,
        )
      : sql`true`;

    // Name-starts-with beats name-contains beats matched-on-the-shop-name. Without
    // this, "kebab" puts every product of a stall called "Kebab Turki" above the
    // actual kebabs. Omitted entirely when there's no term — a constant in ORDER
    // BY is read by Postgres as a column ordinal, not a value, and errors out.
    const relevance = term
      ? [
          sql`CASE
            WHEN ${productsTable.product_name} ILIKE ${term + "%"} THEN 0
            WHEN ${productsTable.product_name} ILIKE ${pattern} THEN 1
            WHEN ${outletsTable.name} ILIKE ${pattern} THEN 2
            ELSE 3
          END`,
        ]
      : [];

    const rows = await db
      .select({
        id: productsTable.id,
        name: productsTable.product_name,
        image: productsTable.image,
        description: productsTable.description,
        category: productsTable.category,
        price: productsTable.price,
        priceMarkDown: productsTable.price_mark_down,
        lowestPrice: productsTable.lowest_price,
        highestPrice: productsTable.highest_price,
        discountPercent: productsTable.discount_percent,
        unit: productsTable.unit,
        ratings: productsTable.ratings,
        reviewCount: productsTable.review_count,
        outletId: outletsTable.id,
        outletName: outletsTable.name,
        outletAvatar: outletsTable.avatar,
        outletRatings: outletsTable.ratings,
        outletIsOpen: outletsTable.is_open,
        outletFeatures: outletsTable.features,
        lat: outletsTable.lat,
        lon: outletsTable.lon,
      })
      .from(productsTable)
      .innerJoin(outletsTable, eq(productsTable.outlet_id, outletsTable.id))
      .where(
        and(
          eq(productsTable.isAvailable, true),
          eq(productsTable.is_for_sale, true),
          notInternalCategory(),
          isNull(productsTable.deletedAt),
          isNull(outletsTable.deletedAt),
          match,
        ),
      )
      .orderBy(
        desc(outletsTable.is_open),
        ...relevance,
        desc(sql`COALESCE(${productsTable.ratings}::numeric, 0)`),
        desc(productsTable.review_count),
      )
      .limit(take)
      .offset(skip);

    const here = await customerHomeCoords(request);

    const data = rows
      .map((r) => {
        const coords = parseCoordPair(r.lat, r.lon);
        // Straight-line, not routed: a search page turns over dozens of rows per
        // keystroke and one OSRM table call per query would be paid on every one
        // of them. The browse list still routes — this number is a rough "how far
        // is this from me", and the outlet page recomputes it properly.
        const distanceKm =
          here && coords
            ? Math.round(haversineKm(here.lat, here.lon, coords.lat, coords.lon) * 10) / 10
            : null;
        const feature = CATEGORY_FEATURE[r.category] ?? r.outletFeatures[0] ?? "food";

        return {
          id: r.id,
          name: r.name,
          image: r.image,
          description: r.description ?? "",
          category: r.category,
          feature,
          isService: r.category === FEATURE_CATEGORY.service,
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
    const { outletId } = request.query as { outletId?: string };
    if (!outletId) return reply.status(400).send({ error: "outletId is required" });

    const rows = await db
      .select({
        id: outletsTable.id,
        name: outletsTable.name,
        image: outletsTable.avatar,
        tags: outletsTable.tags,
        reviewCount: outletsTable.review_count,
        coverImage: outletsTable.avatar,
        address: outletsTable.address,
        phone: outletsTable.phone,
        features: outletsTable.features,
        isOpen: outletsTable.is_open,
        ratings: sql<number>`COALESCE(${outletsTable.ratings}::numeric, 0)`,
        lat: outletsTable.lat,
        lon: outletsTable.lon,
      })
      .from(outletsTable)
      .where(eq(outletsTable.id, Number(outletId)))
      .limit(1);

    if (!rows[0]) return reply.status(404).send({ error: "Outlet not found" });

    const { lat, lon, ...outlet } = rows[0];

    // Same real ETA as the browse list. This header used to read "~15 min" for
    // every outlet regardless of distance — the customer's first and most
    // prominent time signal, and it was the same number 500 m away or 25 km away.
    const here = await customerHomeCoords(request);
    const there = parseCoordPair(lat, lon);
    const distance =
      here && there ? (await roadTable(here, [there]))[0] : null;

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
        outOfRange:
          distance?.source === "road" && distance.km > MAX_DELIVERY_KM,
      },
    };
  });

  app.get("/api/get-outlet-ads", async (request, reply) => {
    const { outletId: outletIdParam } = request.query as { outletId?: string };
    const outletId = Number(outletIdParam);
    if (!outletId || isNaN(outletId)) {
      return reply.status(400).send({ success: false, data: [] });
    }

    const { now, day, hour } = getCurrentAdSlot();

    const rows = await db
      .select({
        id: productAdsTable.id,
        title: productAdsTable.title,
        description: productAdsTable.description,
        banner_image: productAdsTable.banner_image,
        product_id: productAdsTable.product_id,
      })
      .from(productAdsTable)
      .innerJoin(productAdsSchedule, eq(productAdsSchedule.productAdsSchedule_id, productAdsTable.id))
      .innerJoin(scheduleProductAdsTable, eq(scheduleProductAdsTable.id, productAdsSchedule.scheduleProductAdsTable_id))
      .where(
        and(
          eq(productAdsTable.outlet_id, outletId),
          eq(productAdsTable.status, "approved"),
          eq(productAdsTable.is_active, true),
          lte(productAdsTable.starts_at, now),
          or(isNull(productAdsTable.ends_at), gte(productAdsTable.ends_at, now)),
          sql`${scheduleProductAdsTable.time}->>'day' = ${day}`,
          sql`${scheduleProductAdsTable.time}->>'hour' = ${hour}`,
        ),
      );

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
    return { success: true, area: await getServiceArea() };
  });

  app.get("/api/get-categories", async (request, reply) => {
    const { outletId: outletIdParam } = request.query as { outletId?: string };
    if (!outletIdParam) return reply.status(400).send({ success: false, message: "Missing outletId" });

    try {
      const categories = await db
        .selectDistinct({ category: productsTable.category })
        .from(productsTable)
        .where(
          and(
            eq(productsTable.outlet_id, parseInt(outletIdParam, 10)),
            eq(productsTable.is_for_sale, true),
            notInternalCategory(),
            isNull(productsTable.deletedAt),
          ),
        );

      return { success: true, message: "Categories fetched successfully", data: categories };
    } catch (error) {
      app.log.error(error, "Failed to fetch categories");
      return reply.status(500).send({ success: false, error: { message: (error as Error).message } });
    }
  });
}
