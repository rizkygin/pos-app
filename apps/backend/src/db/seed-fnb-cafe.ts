/**
 * Demo data for an F&B / coffee-shop client presentation.
 *
 * Seeds one outlet with a complete, internally-consistent month of operation:
 *
 *   bahan     inventory-only products (category "bahan", is_for_sale=false,
 *             track_stock=true) — beans, milk, packaging, kitchen stock
 *   menu      sellable items grouped into the owner's menu sections, with
 *             track_stock=false + a recipe, so selling one decrements bahan
 *   faktur    purchase invoices (stock IN, cash OUT) and sales invoices
 *             (stock OUT via recipe, cash IN) spread over the last ~35 days,
 *             in a realistic mix of paid / partial / posted / draft
 *   kas       operational cash in & out (setoran kasir, gaji, sewa, listrik…)
 *             dated across the same window, so the cashflow report has shape
 *
 * Every number is written the way the app itself writes it — the same cashflow
 * detail + cashFlows link + invoice_payments rows the /post and /pay endpoints
 * produce — so the dashboard, laporan kas, stok and faktur pages all agree.
 *
 *   npm run db:seed-fnb -- --outlet 17
 *   npm run db:seed-fnb -- --outlet 17 --reset   # wipe this outlet's invoices
 *                                                # + cashflow first, then reseed
 *   npm run db:seed-fnb -- --new-outlet rizkygin2@gmail.com --name "Kopi Sinar Pagi"
 *                                                # create a fresh outlet for that
 *                                                # owner and seed onto it
 */
import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from './index';
import {
  cashFlows,
  cashInCategoryTable,
  cashInDetailTable,
  cashOutCategoryTable,
  cashOutDetailTable,
  invoiceItemsTable,
  invoicePaymentsTable,
  invoicesTable,
  menuGroupsTable,
  outletsTable,
  productsTable,
  recipeItemsTable,
  stockMovementsTable,
  suppliersTable,
} from './schema';
import { usersTable } from './schema';
import { recalcOutletFeatures } from '../lib/outlet-features';
import { DEFAULT_COORDS } from '../lib/utils/coords';

/**
 * This script deletes rows (--reset) and fabricates a month of books. It is for
 * a demo/development database only — refuse anything that isn't obviously local
 * unless the caller says out loud that they mean it.
 */
function assertDevelopmentDatabase() {
  const url = process.env.DATABASE_URL ?? '';
  const host = url.replace(/^[a-z]+:\/\/[^@]*@/, '').split('/')[0];
  const local = /^(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal|db|postgres)(:\d+)?$/.test(host);
  if (!local && !process.argv.includes('--i-know-this-is-not-local')) {
    throw new Error(
      `Refusing to seed demo data into a non-local database (${host}). ` +
        'Point DATABASE_URL at your dev database first.',
    );
  }
  console.log(`  database: ${host} ${local ? '(local dev)' : '(OVERRIDDEN)'}`);
}

// Mirrors routes/invoices.ts — the categories invoice payments book against.
const SALES_CASH_CATEGORY = 'Penjualan produk/jasa';
const PURCHASE_CASH_CATEGORY = 'Pembelian stok barang dagang';

// ---------------------------------------------------------------- katalog

type Ingredient = {
  name: string;
  unit: string;
  /** Cost per unit, rupiah. Also the value a purchase line is billed at. */
  cost: number;
  /** Opening stock before the month's purchases/sales are applied. */
  opening: number;
};

/** Inventory-only. Never appears on the customer menu (category "bahan"). */
const BAHAN: Ingredient[] = [
  { name: 'Biji Kopi Arabika Gayo', unit: 'kg', cost: 165_000, opening: 8 },
  { name: 'Biji Kopi Robusta Lampung', unit: 'kg', cost: 95_000, opening: 12 },
  { name: 'Susu UHT Full Cream', unit: 'liter', cost: 18_000, opening: 40 },
  { name: 'Susu Kental Manis', unit: 'kaleng', cost: 12_000, opening: 24 },
  { name: 'Gula Aren Cair', unit: 'liter', cost: 45_000, opening: 10 },
  { name: 'Sirup Vanila', unit: 'botol', cost: 78_000, opening: 4 },
  { name: 'Sirup Caramel', unit: 'botol', cost: 78_000, opening: 4 },
  { name: 'Bubuk Matcha', unit: 'kg', cost: 320_000, opening: 2 },
  { name: 'Bubuk Cokelat', unit: 'kg', cost: 145_000, opening: 3 },
  { name: 'Teh Melati Kering', unit: 'kg', cost: 85_000, opening: 2 },
  { name: 'Lemon Segar', unit: 'kg', cost: 28_000, opening: 6 },
  { name: 'Es Batu Kristal', unit: 'kg', cost: 4_000, opening: 400 },
  { name: 'Cup Plastik 16oz', unit: 'pcs', cost: 850, opening: 1_400 },
  { name: 'Tutup Cup 16oz', unit: 'pcs', cost: 350, opening: 1_400 },
  { name: 'Sedotan Kertas', unit: 'pcs', cost: 150, opening: 1_200 },
  { name: 'Paper Bag Takeaway', unit: 'pcs', cost: 900, opening: 700 },
  { name: 'Tisu Makan', unit: 'pack', cost: 9_000, opening: 30 },
  { name: 'Ayam Fillet', unit: 'kg', cost: 48_000, opening: 10 },
  { name: 'Daging Sapi Giling', unit: 'kg', cost: 118_000, opening: 5 },
  { name: 'Kentang Beku', unit: 'kg', cost: 32_000, opening: 15 },
  { name: 'Roti Burger', unit: 'pcs', cost: 3_500, opening: 60 },
  { name: 'Roti Tawar', unit: 'bungkus', cost: 16_000, opening: 60 },
  { name: 'Keju Slice', unit: 'lembar', cost: 1_800, opening: 900 },
  { name: 'Telur Ayam', unit: 'butir', cost: 2_400, opening: 260 },
  { name: 'Tepung Terigu', unit: 'kg', cost: 13_000, opening: 20 },
  { name: 'Beras Premium', unit: 'kg', cost: 14_000, opening: 50 },
  { name: 'Spaghetti Kering', unit: 'kg', cost: 26_000, opening: 8 },
  { name: 'Minyak Goreng', unit: 'liter', cost: 19_000, opening: 24 },
  { name: 'Saus Sambal', unit: 'botol', cost: 15_000, opening: 12 },
  { name: 'Pisang Kepok', unit: 'sisir', cost: 22_000, opening: 45 },
];

type MenuItem = {
  name: string;
  group: string;
  category: 'makanan' | 'minuman';
  price: number;
  /** Struck-through "before" price. Omit = no markdown shown. */
  before?: number;
  description: string;
  recommended?: boolean;
  /** Bahan consumed per one sold unit, keyed by ingredient name. */
  recipe: Record<string, number>;
};

// Prices are ballpark Banjarmasin cafe retail, mid-2026. The recipes are what
// make the demo hang together: sell 40 kopi susu and the gula aren stock in the
// Stok page actually drops.
const MENU: MenuItem[] = [
  // ── Kopi ───────────────────────────────────────────────────────────
  {
    name: 'Espresso',
    group: 'Kopi',
    category: 'minuman',
    price: 18_000,
    description: 'Single shot arabika Gayo, body tebal.',
    recipe: { 'Biji Kopi Arabika Gayo': 0.018, 'Cup Plastik 16oz': 1, 'Tutup Cup 16oz': 1 },
  },
  {
    name: 'Americano',
    group: 'Kopi',
    category: 'minuman',
    price: 22_000,
    description: 'Espresso + air, panas atau dingin.',
    recipe: {
      'Biji Kopi Arabika Gayo': 0.018,
      'Es Batu Kristal': 0.15,
      'Cup Plastik 16oz': 1,
      'Tutup Cup 16oz': 1,
      'Sedotan Kertas': 1,
    },
  },
  {
    name: 'Kopi Susu Gula Aren',
    group: 'Kopi',
    category: 'minuman',
    price: 25_000,
    before: 28_000,
    description: 'Best seller. Robusta, susu segar, gula aren asli.',
    recommended: true,
    recipe: {
      'Biji Kopi Robusta Lampung': 0.02,
      'Susu UHT Full Cream': 0.15,
      'Gula Aren Cair': 0.03,
      'Es Batu Kristal': 0.15,
      'Cup Plastik 16oz': 1,
      'Tutup Cup 16oz': 1,
      'Sedotan Kertas': 1,
    },
  },
  {
    name: 'Cappuccino',
    group: 'Kopi',
    category: 'minuman',
    price: 28_000,
    description: 'Espresso dengan microfoam tebal.',
    recipe: {
      'Biji Kopi Arabika Gayo': 0.018,
      'Susu UHT Full Cream': 0.18,
      'Cup Plastik 16oz': 1,
      'Tutup Cup 16oz': 1,
    },
  },
  {
    name: 'Caffe Latte',
    group: 'Kopi',
    category: 'minuman',
    price: 28_000,
    description: 'Espresso dengan susu steamed, lembut.',
    recommended: true,
    recipe: {
      'Biji Kopi Arabika Gayo': 0.018,
      'Susu UHT Full Cream': 0.22,
      'Cup Plastik 16oz': 1,
      'Tutup Cup 16oz': 1,
    },
  },
  {
    name: 'Caramel Macchiato',
    group: 'Kopi',
    category: 'minuman',
    price: 33_000,
    description: 'Latte berlapis dengan sirup caramel.',
    recipe: {
      'Biji Kopi Arabika Gayo': 0.018,
      'Susu UHT Full Cream': 0.22,
      'Sirup Caramel': 0.04,
      'Es Batu Kristal': 0.15,
      'Cup Plastik 16oz': 1,
      'Tutup Cup 16oz': 1,
      'Sedotan Kertas': 1,
    },
  },
  {
    name: 'Vanilla Latte',
    group: 'Kopi',
    category: 'minuman',
    price: 32_000,
    description: 'Latte dengan sirup vanila.',
    recipe: {
      'Biji Kopi Arabika Gayo': 0.018,
      'Susu UHT Full Cream': 0.22,
      'Sirup Vanila': 0.04,
      'Cup Plastik 16oz': 1,
      'Tutup Cup 16oz': 1,
    },
  },

  // ── Non-Kopi ───────────────────────────────────────────────────────
  {
    name: 'Matcha Latte',
    group: 'Non-Kopi',
    category: 'minuman',
    price: 30_000,
    description: 'Matcha premium dengan susu segar.',
    recommended: true,
    recipe: {
      'Bubuk Matcha': 0.008,
      'Susu UHT Full Cream': 0.22,
      'Es Batu Kristal': 0.15,
      'Cup Plastik 16oz': 1,
      'Tutup Cup 16oz': 1,
      'Sedotan Kertas': 1,
    },
  },
  {
    name: 'Cokelat Panas',
    group: 'Non-Kopi',
    category: 'minuman',
    price: 26_000,
    description: 'Cokelat pekat, susu full cream.',
    recipe: {
      'Bubuk Cokelat': 0.02,
      'Susu UHT Full Cream': 0.22,
      'Cup Plastik 16oz': 1,
      'Tutup Cup 16oz': 1,
    },
  },
  {
    name: 'Teh Melati',
    group: 'Non-Kopi',
    category: 'minuman',
    price: 15_000,
    description: 'Seduhan teh melati, panas atau es.',
    recipe: {
      'Teh Melati Kering': 0.005,
      'Es Batu Kristal': 0.15,
      'Cup Plastik 16oz': 1,
      'Tutup Cup 16oz': 1,
      'Sedotan Kertas': 1,
    },
  },
  {
    name: 'Lemon Tea',
    group: 'Non-Kopi',
    category: 'minuman',
    price: 18_000,
    description: 'Teh melati dengan perasan lemon segar.',
    recipe: {
      'Teh Melati Kering': 0.005,
      'Lemon Segar': 0.05,
      'Es Batu Kristal': 0.2,
      'Cup Plastik 16oz': 1,
      'Tutup Cup 16oz': 1,
      'Sedotan Kertas': 1,
    },
  },
  {
    name: 'Milkshake Vanila',
    group: 'Non-Kopi',
    category: 'minuman',
    price: 32_000,
    description: 'Susu, sirup vanila, es serut.',
    recipe: {
      'Susu UHT Full Cream': 0.25,
      'Sirup Vanila': 0.05,
      'Es Batu Kristal': 0.2,
      'Cup Plastik 16oz': 1,
      'Tutup Cup 16oz': 1,
      'Sedotan Kertas': 1,
    },
  },

  // ── Makanan Berat ──────────────────────────────────────────────────
  {
    name: 'Nasi Ayam Geprek',
    group: 'Makanan Berat',
    category: 'makanan',
    price: 28_000,
    description: 'Ayam crispy digeprek sambal, nasi hangat.',
    recommended: true,
    recipe: {
      'Ayam Fillet': 0.15,
      'Beras Premium': 0.15,
      'Tepung Terigu': 0.05,
      'Minyak Goreng': 0.05,
      'Saus Sambal': 0.05,
      'Tisu Makan': 0.05,
    },
  },
  {
    name: 'Chicken Katsu Curry',
    group: 'Makanan Berat',
    category: 'makanan',
    price: 35_000,
    description: 'Katsu ayam dengan saus kari Jepang.',
    recipe: {
      'Ayam Fillet': 0.16,
      'Beras Premium': 0.15,
      'Tepung Terigu': 0.06,
      'Telur Ayam': 1,
      'Minyak Goreng': 0.06,
      'Tisu Makan': 0.05,
    },
  },
  {
    name: 'Spaghetti Aglio Olio',
    group: 'Makanan Berat',
    category: 'makanan',
    price: 32_000,
    description: 'Spaghetti bawang putih, cabai kering, olive oil.',
    recipe: {
      'Spaghetti Kering': 0.12,
      'Minyak Goreng': 0.04,
      'Keju Slice': 1,
      'Tisu Makan': 0.05,
    },
  },
  {
    name: 'Beef Burger Keju',
    group: 'Makanan Berat',
    category: 'makanan',
    price: 38_000,
    before: 42_000,
    description: 'Patty sapi giling 100gr, keju leleh, roti brioche.',
    recommended: true,
    recipe: {
      'Daging Sapi Giling': 0.1,
      'Roti Burger': 1,
      'Keju Slice': 2,
      'Kentang Beku': 0.08,
      'Minyak Goreng': 0.04,
      'Paper Bag Takeaway': 1,
      'Tisu Makan': 0.05,
    },
  },
  {
    name: 'Chicken Wrap',
    group: 'Makanan Berat',
    category: 'makanan',
    price: 30_000,
    description: 'Ayam panggang, sayur segar, saus mayo.',
    recipe: {
      'Ayam Fillet': 0.12,
      'Tepung Terigu': 0.08,
      'Keju Slice': 1,
      'Paper Bag Takeaway': 1,
      'Tisu Makan': 0.05,
    },
  },

  // ── Snack ──────────────────────────────────────────────────────────
  {
    name: 'French Fries',
    group: 'Snack',
    category: 'makanan',
    price: 22_000,
    description: 'Kentang goreng renyah, saus sambal.',
    recipe: {
      'Kentang Beku': 0.18,
      'Minyak Goreng': 0.05,
      'Saus Sambal': 0.04,
      'Paper Bag Takeaway': 1,
    },
  },
  {
    name: 'Chicken Wings BBQ',
    group: 'Snack',
    category: 'makanan',
    price: 35_000,
    description: '6 potong sayap ayam saus BBQ.',
    recipe: {
      'Ayam Fillet': 0.22,
      'Tepung Terigu': 0.05,
      'Minyak Goreng': 0.06,
      'Paper Bag Takeaway': 1,
      'Tisu Makan': 0.05,
    },
  },
  {
    name: 'Roti Bakar Cokelat Keju',
    group: 'Snack',
    category: 'makanan',
    price: 20_000,
    description: 'Roti bakar isi cokelat dan keju parut.',
    recipe: {
      'Roti Tawar': 0.2,
      'Bubuk Cokelat': 0.01,
      'Keju Slice': 2,
      'Tisu Makan': 0.05,
    },
  },
  {
    name: 'Pisang Goreng Keju',
    group: 'Snack',
    category: 'makanan',
    price: 18_000,
    description: 'Pisang kepok goreng, topping keju & susu.',
    recipe: {
      'Pisang Kepok': 0.15,
      'Tepung Terigu': 0.05,
      'Minyak Goreng': 0.04,
      'Keju Slice': 1,
      'Susu Kental Manis': 0.1,
    },
  },

  // ── Dessert ────────────────────────────────────────────────────────
  {
    name: 'Cheesecake Slice',
    group: 'Dessert',
    category: 'makanan',
    price: 28_000,
    description: 'Baked cheesecake, satu potong.',
    recipe: { 'Keju Slice': 3, 'Telur Ayam': 1, 'Tepung Terigu': 0.04, 'Tisu Makan': 0.05 },
  },
  {
    name: 'Brownies Cokelat',
    group: 'Dessert',
    category: 'makanan',
    price: 22_000,
    description: 'Brownies fudgy, cokelat pekat.',
    recipe: {
      'Bubuk Cokelat': 0.03,
      'Telur Ayam': 1,
      'Tepung Terigu': 0.05,
      'Tisu Makan': 0.05,
    },
  },
  {
    name: 'Affogato',
    group: 'Dessert',
    category: 'minuman',
    price: 30_000,
    description: 'Es krim vanila disiram shot espresso.',
    recipe: {
      'Biji Kopi Arabika Gayo': 0.018,
      'Susu UHT Full Cream': 0.1,
      'Sirup Vanila': 0.03,
      'Cup Plastik 16oz': 1,
    },
  },
];

const MENU_GROUP_ORDER = ['Kopi', 'Non-Kopi', 'Makanan Berat', 'Snack', 'Dessert'];

/**
 * Menu photos, as Unsplash CDN ids.
 *
 * Stored as full https URLs rather than uploaded files: resolveProductImage()
 * passes any http(s) value straight through, and next.config.ts already lists
 * images.unsplash.com under images.remotePatterns — so this needs no upload
 * endpoint, no volume, and no frontend redeploy on either environment.
 *
 * The trade-off is a live internet dependency at render time. Swap this map for
 * the client's own uploaded photos ("/uploads/products/x.webp") when you have
 * them; nothing else in the seed has to change.
 *
 * Every id below was fetched and confirmed to return real image bytes.
 */
const MENU_PHOTO: Record<string, string> = {
  Espresso: '1447933601403-0c6688de566e',
  Americano: '1517701550927-30cf4ba1dba5',
  'Kopi Susu Gula Aren': '1461023058943-07fcbe16d735',
  Cappuccino: '1497636577773-f1231844b336',
  'Caffe Latte': '1512568400610-62da28bc8a13',
  'Caramel Macchiato': '1527156231393-7023794f363c',
  'Vanilla Latte': '1593443320739-77f74939d0da',
  'Matcha Latte': '1515823064-d6e0c04616a7',
  'Cokelat Panas': '1542990253-0d0f5be5f0ed',
  'Teh Melati': '1556679343-c7306c1976bc',
  'Lemon Tea': '1592099759599-24b131b8e824',
  'Milkshake Vanila': '1572490122747-3968b75cc699',
  'Nasi Ayam Geprek': '1569058242252-623df46b5025',
  'Chicken Katsu Curry': '1603133872878-684f208fb84b',
  'Spaghetti Aglio Olio': '1627042633145-b780d842ba45',
  'Beef Burger Keju': '1568901346375-23c9450c58cd',
  'Chicken Wrap': '1529006557810-274b9b2fc783',
  'French Fries': '1585109649139-366815a0d713',
  'Chicken Wings BBQ': '1567620832903-9fc6debc209f',
  'Roti Bakar Cokelat Keju': '1528736235302-52922df5c122',
  'Pisang Goreng Keju': '1540714605746-4f474eefc6d4',
  'Cheesecake Slice': '1631427574284-e51f812b05c7',
  'Brownies Cokelat': '1672456396068-772973406a5a',
  Affogato: '1481391032119-d89fee407e44',
};

/** Outlet cover/avatar. resolveOutletImage() passes http(s) through unchanged. */
const OUTLET_PHOTO =
  'https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&w=1200&q=80';

/** Card-sized crop. next/image re-optimises, so this is just a sane upper bound. */
const photoUrl = (name: string) => {
  const id = MENU_PHOTO[name];
  return id ? `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=800&q=80` : 'avatar.png';
};

const SUPPLIERS = [
  {
    name: 'CV Kopi Nusantara',
    phone: '081234500011',
    address: 'Jl. Ahmad Yani Km 5, Banjarmasin',
    note: 'Biji kopi, tempo 14 hari',
  },
  {
    name: 'PT Sumber Susu Segar',
    phone: '081234500022',
    address: 'Jl. Pramuka No. 88, Banjarmasin',
    note: 'Susu & dairy, kirim 2x seminggu',
  },
  {
    name: 'Toko Grosir Pratama',
    phone: '081234500033',
    address: 'Pasar Antasari Blok C, Banjarmasin',
    note: 'Packaging & sembako',
  },
  {
    name: 'UD Ayam Segar Banjar',
    phone: '081234500044',
    address: 'Jl. Veteran No. 12, Banjarmasin',
    note: 'Ayam, daging, frozen food',
  },
];

// ---------------------------------------------------------------- helpers

const DAY = 86_400_000;
const NOW = new Date();
/** `d` days ago, at `hour` local time. Keeps the demo timeline deterministic. */
const daysAgo = (d: number, hour = 10) => {
  const t = new Date(NOW.getTime() - d * DAY);
  t.setHours(hour, (d * 7) % 60, 0, 0);
  return t;
};
const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`;

const argOf = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

function parseOutletId(): number {
  const raw = argOf('--outlet') ?? process.env.SEED_OUTLET_ID;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Pass a target outlet: npm run db:seed-fnb -- --outlet 17');
  }
  return id;
}

/**
 * Create a brand-new outlet for an existing owner account, so the demo can live
 * beside whatever is already in the dev database instead of overwriting it. The
 * owner switches to it with the active-outlet picker.
 */
async function createOutletFor(ownerEmail: string, name: string) {
  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, ownerEmail))
    .limit(1);
  if (!user) throw new Error(`No user with email ${ownerEmail}`);

  // outlets.email is unique — derive one from the name so re-running with a new
  // outlet name doesn't collide with the owner's existing shops.
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const [row] = await db
    .insert(outletsTable)
    .values({
      name,
      address: 'Jl. Ahmad Yani Km 3,5 No. 21, Banjarmasin',
      lat: String(DEFAULT_COORDS.lat),
      lon: String(DEFAULT_COORDS.lon),
      phone: '081234567890',
      email: `${slug}@demo.local`,
      user_id: user.id,
      avatar: OUTLET_PHOTO,
      tags: ['kopi', 'cafe', 'brunch'],
      is_open: true,
    })
    .returning({ id: outletsTable.id, name: outletsTable.name });
  return row;
}

/**
 * Find-or-create a cashflow category, exactly as the invoice routes do.
 *
 * Memoised: the seed writes ~100 cash rows across a dozen categories, and
 * re-resolving the category every time turned into a couple hundred extra
 * round-trips — barely noticeable against a local socket, but enough to stall
 * the run against a remote database.
 */
const categoryCache = new Map<string, number>();
async function cashCategoryId(kind: 'in' | 'out', name: string) {
  const key = `${kind}:${name}`;
  const hit = categoryCache.get(key);
  if (hit !== undefined) return hit;

  const table = kind === 'in' ? cashInCategoryTable : cashOutCategoryTable;
  const [existing] = await db
    .select({ id: table.id })
    .from(table)
    .where(eq(table.category, name))
    .limit(1);
  const id =
    existing?.id ??
    (await db.insert(table).values({ category: name }).returning({ id: table.id }))[0].id;
  categoryCache.set(key, id);
  return id;
}

/** Cash IN: detail row + cashFlows link, backdated. Returns the detail id. */
async function cashIn(outletId: number, category: string, amount: number, at: Date, type: 'cash' | 'transfer' = 'cash') {
  const [detail] = await db
    .insert(cashInDetailTable)
    .values({
      category_id: await cashCategoryId('in', category),
      money_amount: String(Math.round(amount)),
      type,
      created_at: at,
    })
    .returning();
  await db.insert(cashFlows).values({ outlet_id: outletId, cash_in_detail_id: detail.id });
  return detail.id;
}

/** Cash OUT: detail row + cashFlows link, backdated. Returns the detail id. */
async function cashOut(outletId: number, category: string, amount: number, at: Date, type: 'cash' | 'transfer' = 'cash') {
  const [detail] = await db
    .insert(cashOutDetailTable)
    .values({
      category_id: await cashCategoryId('out', category),
      money_amount: String(Math.round(amount)),
      type,
      created_at: at,
    })
    .returning();
  await db.insert(cashFlows).values({ outlet_id: outletId, cash_out_detail_id: detail.id });
  return detail.id;
}

/**
 * Wipe every invoice, payment, stock movement and cashflow row belonging to the
 * outlet, in FK-safe order. Only reachable behind --reset: this is destructive
 * and meant for a demo outlet, never a live one.
 */
async function resetOutlet(outletId: number) {
  const invoices = await db
    .select({ id: invoicesTable.id })
    .from(invoicesTable)
    .where(eq(invoicesTable.outlet_id, outletId));
  const invoiceIds = invoices.map((i) => i.id);

  // The cashflow details the invoices produced, gathered before their payment
  // rows are deleted — they are the only trail back to those details.
  const payments = invoiceIds.length
    ? await db
        .select({
          in_id: invoicePaymentsTable.cash_in_detail_id,
          out_id: invoicePaymentsTable.cash_out_detail_id,
        })
        .from(invoicePaymentsTable)
        .where(inArray(invoicePaymentsTable.invoice_id, invoiceIds))
    : [];

  await db.delete(stockMovementsTable).where(eq(stockMovementsTable.outlet_id, outletId));
  if (invoiceIds.length) {
    await db.delete(invoicePaymentsTable).where(inArray(invoicePaymentsTable.invoice_id, invoiceIds));
    await db.delete(invoiceItemsTable).where(inArray(invoiceItemsTable.invoice_id, invoiceIds));
  }

  // invoices.cash_in/out_detail_id points at details we are about to delete.
  await db
    .update(invoicesTable)
    .set({ cash_in_detail_id: null, cash_out_detail_id: null })
    .where(eq(invoicesTable.outlet_id, outletId));
  await db.delete(invoicesTable).where(eq(invoicesTable.outlet_id, outletId));

  const links = await db
    .select({
      in_id: cashFlows.cash_in_detail_id,
      out_id: cashFlows.cash_out_detail_id,
    })
    .from(cashFlows)
    .where(eq(cashFlows.outlet_id, outletId));
  await db.delete(cashFlows).where(eq(cashFlows.outlet_id, outletId));

  const inIds = [...new Set([...links, ...payments].map((r) => r.in_id).filter(Boolean))] as number[];
  const outIds = [...new Set([...links, ...payments].map((r) => r.out_id).filter(Boolean))] as number[];
  if (inIds.length) await db.delete(cashInDetailTable).where(inArray(cashInDetailTable.id, inIds));
  if (outIds.length) await db.delete(cashOutDetailTable).where(inArray(cashOutDetailTable.id, outIds));

  console.log(
    `  reset: ${invoiceIds.length} faktur, ${inIds.length} kas masuk, ${outIds.length} kas keluar dihapus`,
  );
}

// ---------------------------------------------------------------- main

async function main() {
  assertDevelopmentDatabase();
  const doReset = process.argv.includes('--reset');
  const newOwner = argOf('--new-outlet');

  const outlet = newOwner
    ? await createOutletFor(newOwner, argOf('--name') ?? 'Kopi Sinar Pagi')
    : await (async () => {
        const id = parseOutletId();
        const [row] = await db
          .select({ id: outletsTable.id, name: outletsTable.name })
          .from(outletsTable)
          .where(eq(outletsTable.id, id))
          .limit(1);
        if (!row) throw new Error(`Outlet ${id} not found`);
        return row;
      })();
  const outletId = outlet.id;

  // Also applied on re-seed of an existing outlet, not just on creation.
  await db.update(outletsTable).set({ avatar: OUTLET_PHOTO }).where(eq(outletsTable.id, outletId));

  console.log(`\nSeeding demo cafe onto #${outlet.id} ${outlet.name}\n`);

  if (doReset) {
    await resetOutlet(outletId);
  } else {
    const [{ id: anyInvoice } = { id: undefined }] = await db
      .select({ id: invoicesTable.id })
      .from(invoicesTable)
      .where(eq(invoicesTable.outlet_id, outletId))
      .limit(1);
    if (anyInvoice !== undefined) {
      throw new Error(
        `Outlet ${outletId} already has invoices. Re-run with --reset to wipe its faktur + kas and reseed.`,
      );
    }
  }

  // ── menu groups ──────────────────────────────────────────────────
  const existingGroups = await db
    .select({ id: menuGroupsTable.id, name: menuGroupsTable.name })
    .from(menuGroupsTable)
    .where(eq(menuGroupsTable.outlet_id, outletId));
  const groupId = new Map(existingGroups.map((g) => [g.name, g.id]));

  for (const [i, name] of MENU_GROUP_ORDER.entries()) {
    if (groupId.has(name)) continue;
    const [row] = await db
      .insert(menuGroupsTable)
      .values({ outlet_id: outletId, name, sort_order: i })
      .returning({ id: menuGroupsTable.id });
    groupId.set(name, row.id);
  }
  console.log(`  grup menu: ${MENU_GROUP_ORDER.join(', ')}`);

  // ── products (upsert by name, so a re-run refreshes prices) ───────
  const productId = new Map<string, string>();

  async function upsertProduct(name: string, values: Record<string, unknown>) {
    const [existing] = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(and(eq(productsTable.outlet_id, outletId), eq(productsTable.product_name, name)))
      .limit(1);
    if (existing) {
      await db.update(productsTable).set(values).where(eq(productsTable.id, existing.id));
      productId.set(name, existing.id);
      return existing.id;
    }
    const id = randomUUID();
    await db.insert(productsTable).values({ id, product_name: name, ...values } as never);
    productId.set(name, id);
    return id;
  }

  for (const b of BAHAN) {
    await upsertProduct(b.name, {
      price: '0',
      price_mark_down: '0',
      buying_price: String(b.cost),
      outlet_id: outletId,
      category: 'bahan',
      unit: b.unit,
      image: 'avatar.png',
      // Inventory only: countable, usable on invoices, invisible to customers.
      is_for_sale: false,
      track_stock: true,
      isAvailable: true,
      stock: String(b.opening),
      menu_group_id: null,
      description: `Stok dapur — ${b.unit}`,
    });
  }
  console.log(`  bahan   : ${BAHAN.length} item stok dapur`);

  for (const m of MENU) {
    await upsertProduct(m.name, {
      price: String(m.price),
      price_mark_down: String(m.before ?? m.price),
      buying_price: '0',
      outlet_id: outletId,
      category: m.category,
      unit: 'porsi',
      image: photoUrl(m.name),
      features: [m.category === 'minuman' ? 'drink' : 'food'],
      is_for_sale: true,
      // Menu items have no countable stock of their own — selling one walks the
      // recipe below and decrements the bahan instead.
      track_stock: false,
      courier_deliverable: true,
      isAvailable: true,
      is_recommended: m.recommended ?? false,
      stock: '0',
      menu_group_id: groupId.get(m.group) ?? null,
      description: m.description,
      ...(m.before ? { discount_percent: Math.round((1 - m.price / m.before) * 100) } : {}),
    });
  }
  const noPhoto = MENU.filter((m) => !MENU_PHOTO[m.name]).map((m) => m.name);
  console.log(
    `  menu    : ${MENU.length} item jual, ${MENU.length - noPhoto.length} berfoto` +
      (noPhoto.length ? ` (tanpa foto: ${noPhoto.join(', ')})` : ''),
  );

  // ── recipes (replace-on-save, matching the products route) ────────
  const menuIds = MENU.map((m) => productId.get(m.name)!);
  await db.delete(recipeItemsTable).where(inArray(recipeItemsTable.product_id, menuIds));

  let recipeRows = 0;
  for (const m of MENU) {
    const rows = Object.entries(m.recipe).flatMap(([ing, qty]) => {
      const ingredient_id = productId.get(ing);
      if (!ingredient_id) {
        console.warn(`  ! resep ${m.name}: bahan "${ing}" tidak ada, dilewati`);
        return [];
      }
      return [{ outlet_id: outletId, product_id: productId.get(m.name)!, ingredient_id, qty: String(qty) }];
    });
    if (rows.length) await db.insert(recipeItemsTable).values(rows);
    recipeRows += rows.length;
  }
  console.log(`  resep   : ${recipeRows} baris bahan`);

  // ── suppliers ────────────────────────────────────────────────────
  const supplierId = new Map<string, number>();
  for (const s of SUPPLIERS) {
    const [existing] = await db
      .select({ id: suppliersTable.id })
      .from(suppliersTable)
      .where(and(eq(suppliersTable.outlet_id, outletId), eq(suppliersTable.name, s.name)))
      .limit(1);
    if (existing) {
      supplierId.set(s.name, existing.id);
      continue;
    }
    const [row] = await db
      .insert(suppliersTable)
      .values({ outlet_id: outletId, email: '', ...s })
      .returning({ id: suppliersTable.id });
    supplierId.set(s.name, row.id);
  }
  console.log(`  supplier: ${SUPPLIERS.length}`);

  // ── faktur pembelian ─────────────────────────────────────────────
  // Each posts stock IN and (when paid) books a cash OUT, the same rows
  // /api/purchase-invoices/:id/post and /pay would have written.
  type PurchaseLine = { bahan: string; qty: number };
  type Purchase = {
    supplier: string;
    day: number;
    /** Days after issue the bill is due. */
    termDays: number;
    lines: PurchaseLine[];
    /** Fraction of the total already paid. 1 = lunas, 0 = utang penuh. */
    paidRatio: number;
    notes?: string;
  };

  const PURCHASES: Purchase[] = [
    {
      supplier: 'CV Kopi Nusantara',
      day: 33,
      termDays: 14,
      paidRatio: 1,
      lines: [
        { bahan: 'Biji Kopi Arabika Gayo', qty: 15 },
        { bahan: 'Biji Kopi Robusta Lampung', qty: 25 },
      ],
      notes: 'Restock awal bulan',
    },
    {
      supplier: 'PT Sumber Susu Segar',
      day: 30,
      termDays: 7,
      paidRatio: 1,
      lines: [
        { bahan: 'Susu UHT Full Cream', qty: 120 },
        { bahan: 'Susu Kental Manis', qty: 36 },
        { bahan: 'Keju Slice', qty: 300 },
      ],
    },
    {
      supplier: 'Toko Grosir Pratama',
      day: 27,
      termDays: 0,
      paidRatio: 1,
      lines: [
        { bahan: 'Cup Plastik 16oz', qty: 2_000 },
        { bahan: 'Tutup Cup 16oz', qty: 2_000 },
        { bahan: 'Sedotan Kertas', qty: 2_000 },
        { bahan: 'Paper Bag Takeaway', qty: 800 },
        { bahan: 'Tisu Makan', qty: 60 },
      ],
      notes: 'Packaging bulanan',
    },
    {
      supplier: 'UD Ayam Segar Banjar',
      day: 24,
      termDays: 7,
      paidRatio: 1,
      lines: [
        { bahan: 'Ayam Fillet', qty: 30 },
        { bahan: 'Daging Sapi Giling', qty: 12 },
        { bahan: 'Kentang Beku', qty: 25 },
      ],
    },
    {
      supplier: 'Toko Grosir Pratama',
      day: 19,
      termDays: 0,
      paidRatio: 1,
      lines: [
        { bahan: 'Beras Premium', qty: 75 },
        { bahan: 'Minyak Goreng', qty: 40 },
        { bahan: 'Tepung Terigu', qty: 30 },
        { bahan: 'Telur Ayam', qty: 300 },
        { bahan: 'Saus Sambal', qty: 24 },
        { bahan: 'Gula Aren Cair', qty: 15 },
      ],
    },
    {
      supplier: 'CV Kopi Nusantara',
      day: 14,
      termDays: 14,
      paidRatio: 0.5,
      lines: [
        { bahan: 'Biji Kopi Arabika Gayo', qty: 12 },
        { bahan: 'Bubuk Matcha', qty: 3 },
        { bahan: 'Bubuk Cokelat', qty: 5 },
        { bahan: 'Teh Melati Kering', qty: 3 },
      ],
      notes: 'DP 50%, sisa saat jatuh tempo',
    },
    {
      supplier: 'PT Sumber Susu Segar',
      day: 9,
      termDays: 7,
      paidRatio: 1,
      lines: [
        { bahan: 'Susu UHT Full Cream', qty: 100 },
        { bahan: 'Sirup Vanila', qty: 6 },
        { bahan: 'Sirup Caramel', qty: 6 },
      ],
    },
    {
      supplier: 'UD Ayam Segar Banjar',
      day: 4,
      termDays: 7,
      paidRatio: 0,
      lines: [
        { bahan: 'Ayam Fillet', qty: 25 },
        { bahan: 'Daging Sapi Giling', qty: 10 },
        { bahan: 'Roti Burger', qty: 120 },
        { bahan: 'Pisang Kepok', qty: 12 },
        { bahan: 'Lemon Segar', qty: 10 },
      ],
      notes: 'Belum dibayar — jatuh tempo minggu ini',
    },
  ];

  const bahanCost = new Map(BAHAN.map((b) => [b.name, b.cost]));
  let purchaseTotal = 0;
  let purchasePaid = 0;

  for (const [i, p] of PURCHASES.entries()) {
    const issue = daysAgo(p.day, 9);
    const lines = p.lines.map((l) => {
      const price = bahanCost.get(l.bahan)!;
      return { ...l, price, total: price * l.qty };
    });
    const subtotal = lines.reduce((s, l) => s + l.total, 0);
    const total = subtotal; // no tax on purchases in this demo
    const paid = Math.round(total * p.paidRatio);

    const [invoice] = await db
      .insert(invoicesTable)
      .values({
        outlet_id: outletId,
        type: 'purchase',
        number: `PB/${issue.getFullYear()}/${String(i + 1).padStart(4, '0')}`,
        status: 'posted',
        supplier_id: supplierId.get(p.supplier)!,
        party_name: p.supplier,
        issue_date: issue,
        due_date: new Date(issue.getTime() + p.termDays * DAY),
        subtotal: String(subtotal),
        total: String(total),
        amount_paid: '0',
        notes: p.notes ?? '',
        createdAt: issue,
      } as never)
      .returning();

    await db.insert(invoiceItemsTable).values(
      lines.map((l) => ({
        invoice_id: invoice.id,
        product_id: productId.get(l.bahan)!,
        description: l.bahan,
        quantity: String(l.qty),
        unit_price: String(l.price),
        line_total: String(l.total),
      })),
    );

    // Stock IN ledger — same rows the post endpoint writes, inserted as one
    // statement (the cached balances are applied in a single pass below).
    await db.insert(stockMovementsTable).values(
      lines.map((l) => ({
        outlet_id: outletId,
        product_id: productId.get(l.bahan)!,
        qty_change: String(l.qty),
        reason: 'purchase' as const,
        invoice_id: invoice.id,
        note: p.supplier,
        created_at: issue,
      })),
    );

    if (paid > 0) {
      const payAt = new Date(issue.getTime() + Math.min(p.termDays, 3) * DAY);
      const detailId = await cashOut(
        outletId,
        PURCHASE_CASH_CATEGORY,
        paid,
        payAt,
        'transfer',
      );
      await db.insert(invoicePaymentsTable).values({
        invoice_id: invoice.id,
        cash_out_detail_id: detailId,
        amount: String(paid),
        created_at: payAt,
      });
      await db
        .update(invoicesTable)
        .set({
          amount_paid: String(paid),
          status: paid >= total - 0.001 ? 'paid' : 'partial',
          cash_out_detail_id: detailId,
        })
        .where(eq(invoicesTable.id, invoice.id));
    }

    purchaseTotal += total;
    purchasePaid += paid;
  }

  // Apply every purchase to the cached balances in one pass per product.
  for (const b of BAHAN) {
    const bought = PURCHASES.flatMap((p) => p.lines)
      .filter((l) => l.bahan === b.name)
      .reduce((s, l) => s + l.qty, 0);
    if (!bought) continue;
    await db
      .update(productsTable)
      .set({ stock: String(b.opening + bought) })
      .where(eq(productsTable.id, productId.get(b.name)!));
  }
  console.log(
    `  pembelian: ${PURCHASES.length} faktur, ${rupiah(purchaseTotal)} (dibayar ${rupiah(purchasePaid)}, utang ${rupiah(purchaseTotal - purchasePaid)})`,
  );

  // ── faktur penjualan ─────────────────────────────────────────────
  // Corporate / catering orders — the invoiced side of the business, on top of
  // the daily walk-in cash the kasir books further down.
  type Sale = {
    party: string;
    day: number;
    termDays: number;
    /** menu item -> qty */
    items: Record<string, number>;
    taxRate?: number;
    discount?: number;
    /** 'draft' skips posting entirely (no stock, no cash). */
    state: 'draft' | 'posted' | 'partial' | 'paid';
    dpRatio?: number;
    notes?: string;
  };

  const SALES: Sale[] = [
    {
      party: 'PT Borneo Mitra Sejahtera',
      day: 31,
      termDays: 14,
      state: 'paid',
      items: { 'Kopi Susu Gula Aren': 40, 'Nasi Ayam Geprek': 40, 'French Fries': 15 },
      taxRate: 11,
      notes: 'Catering rapat direksi',
    },
    {
      party: 'Dinas Pendidikan Kota',
      day: 28,
      termDays: 14,
      state: 'paid',
      items: { 'Teh Melati': 60, 'Roti Bakar Cokelat Keju': 60 },
      discount: 100_000,
      notes: 'Snack pelatihan guru',
    },
    {
      party: 'Universitas Lambung Mangkurat',
      day: 25,
      termDays: 7,
      state: 'paid',
      items: { Americano: 35, 'Caffe Latte': 25, 'Chicken Wrap': 30 },
      notes: 'Coffee break seminar',
    },
    {
      party: 'CV Sinar Abadi',
      day: 22,
      termDays: 14,
      state: 'partial',
      dpRatio: 0.4,
      items: { 'Beef Burger Keju': 30, 'French Fries': 30, 'Milkshake Vanila': 30 },
      taxRate: 11,
      notes: 'DP 40%, pelunasan saat acara selesai',
    },
    {
      party: 'Komunitas Fotografi Banjarmasin',
      day: 20,
      termDays: 7,
      state: 'paid',
      items: { Cappuccino: 25, 'Matcha Latte': 20, 'Brownies Cokelat': 25 },
      notes: 'Gathering bulanan',
    },
    {
      party: 'RS Sari Mulia',
      day: 17,
      // Deliberately already past due — "terlambat" is derived from due_date, so
      // the receivables list needs at least one of these to show the state off.
      termDays: 10,
      state: 'posted',
      items: { 'Chicken Katsu Curry': 45, 'Lemon Tea': 45 },
      taxRate: 11,
      notes: 'Jatuh tempo terlewat — perlu ditagih',
    },
    {
      party: 'Bank Kalsel Cabang Utama',
      day: 14,
      termDays: 14,
      state: 'paid',
      items: { 'Caramel Macchiato': 30, 'Cheesecake Slice': 30, 'Chicken Wings BBQ': 20 },
      taxRate: 11,
      notes: 'Perayaan HUT cabang',
    },
    {
      party: 'Wedding Organizer Amanah',
      day: 11,
      termDays: 14,
      state: 'partial',
      dpRatio: 0.5,
      items: { 'Kopi Susu Gula Aren': 80, 'Pisang Goreng Keju': 80, 'Cokelat Panas': 40 },
      notes: 'Booth kopi akad nikah — DP 50%',
    },
    {
      party: 'PT Borneo Mitra Sejahtera',
      day: 8,
      termDays: 14,
      state: 'posted',
      items: { 'Spaghetti Aglio Olio': 35, 'Vanilla Latte': 35 },
      taxRate: 11,
      notes: 'Order kedua, tempo berjalan',
    },
    {
      party: 'SMA Negeri 1 Banjarmasin',
      day: 5,
      termDays: 7,
      state: 'paid',
      items: { 'French Fries': 50, 'Teh Melati': 80, 'Pisang Goreng Keju': 50 },
      discount: 150_000,
      notes: 'Bazar sekolah',
    },
    {
      party: 'Startup Hub Banjarmasin',
      day: 3,
      termDays: 14,
      state: 'posted',
      items: { Americano: 40, 'Matcha Latte': 30, 'Chicken Wrap': 25, 'Cheesecake Slice': 20 },
      taxRate: 11,
      notes: 'Demo day — invoice terbit, belum jatuh tempo',
    },
    {
      party: 'Hotel Rattan Inn',
      day: 1,
      termDays: 30,
      state: 'draft',
      items: { 'Beef Burger Keju': 60, 'French Fries': 60, 'Milkshake Vanila': 60 },
      taxRate: 11,
      notes: 'Penawaran, menunggu konfirmasi klien',
    },
  ];

  const menuPrice = new Map(MENU.map((m) => [m.name, m.price]));
  const recipeOf = new Map(MENU.map((m) => [m.name, m.recipe]));
  const consumed = new Map<string, number>();
  let salesTotal = 0;
  let salesPaid = 0;

  for (const [i, s] of SALES.entries()) {
    const issue = daysAgo(s.day, 14);
    const lines = Object.entries(s.items).map(([name, qty]) => {
      const price = menuPrice.get(name)!;
      return { name, qty, price, total: price * qty };
    });
    const subtotal = lines.reduce((a, l) => a + l.total, 0);
    const discount = s.discount ?? 0;
    const taxRate = s.taxRate ?? 0;
    const taxAmount = Math.round(((subtotal - discount) * taxRate) / 100);
    const total = subtotal - discount + taxAmount;
    const dp = s.dpRatio ? Math.round(total * s.dpRatio) : 0;

    const [invoice] = await db
      .insert(invoicesTable)
      .values({
        outlet_id: outletId,
        type: 'sales',
        number: `PJ/${issue.getFullYear()}/${String(i + 1).padStart(4, '0')}`,
        status: 'draft',
        party_name: s.party,
        issue_date: issue,
        due_date: new Date(issue.getTime() + s.termDays * DAY),
        subtotal: String(subtotal),
        tax_rate: String(taxRate),
        tax_amount: String(taxAmount),
        discount: String(discount),
        total: String(total),
        down_payment: String(dp),
        amount_paid: '0',
        notes: s.notes ?? '',
        createdAt: issue,
      } as never)
      .returning();

    await db.insert(invoiceItemsTable).values(
      lines.map((l) => ({
        invoice_id: invoice.id,
        product_id: productId.get(l.name)!,
        description: l.name,
        quantity: String(l.qty),
        unit_price: String(l.price),
        line_total: String(l.total),
      })),
    );

    if (s.state === 'draft') continue;

    // Post: menu items carry no stock of their own, so the recipe expands into
    // ingredient movements — mirroring applySaleStockOut().
    const movements = lines.flatMap((l) =>
      Object.entries(recipeOf.get(l.name) ?? {}).flatMap(([ing, per]) => {
        const qty = Number((per * l.qty).toFixed(3));
        if (qty <= 0) return [];
        consumed.set(ing, (consumed.get(ing) ?? 0) + qty);
        return [
          {
            outlet_id: outletId,
            product_id: productId.get(ing)!,
            qty_change: String(-qty),
            reason: 'sales' as const,
            invoice_id: invoice.id,
            note: `Resep: ${l.name} ×${l.qty}`.slice(0, 255),
            created_at: issue,
          },
        ];
      }),
    );
    if (movements.length) await db.insert(stockMovementsTable).values(movements);

    const paid = s.state === 'paid' ? total : s.state === 'partial' ? dp : 0;
    if (paid > 0) {
      const payAt =
        s.state === 'paid'
          ? new Date(Math.min(issue.getTime() + Math.min(s.termDays, 10) * DAY, NOW.getTime()))
          : issue;
      const detailId = await cashIn(outletId, SALES_CASH_CATEGORY, paid, payAt, 'transfer');
      await db.insert(invoicePaymentsTable).values({
        invoice_id: invoice.id,
        cash_in_detail_id: detailId,
        amount: String(paid),
        created_at: payAt,
      });
      await db
        .update(invoicesTable)
        .set({
          status: paid >= total - 0.001 ? 'paid' : 'partial',
          amount_paid: String(paid),
          cash_in_detail_id: detailId,
        })
        .where(eq(invoicesTable.id, invoice.id));
    } else {
      await db.update(invoicesTable).set({ status: 'posted' }).where(eq(invoicesTable.id, invoice.id));
    }

    salesTotal += total;
    salesPaid += paid;
  }

  // Deduct everything the sales consumed from the cached balances.
  for (const [ing, qty] of consumed) {
    const b = BAHAN.find((x) => x.name === ing)!;
    const bought = PURCHASES.flatMap((p) => p.lines)
      .filter((l) => l.bahan === ing)
      .reduce((a, l) => a + l.qty, 0);
    const balance = b.opening + bought - qty;
    // A negative balance means the demo month sells more than it ever bought —
    // the Stok page would show a red "minus" that has no story behind it. Raise
    // that ingredient's `opening` (or a purchase qty) rather than clamping.
    if (balance < 0) {
      console.warn(`  ! ${b.name}: stok akhir ${balance.toFixed(3)} ${b.unit} — naikkan opening/pembelian`);
    }
    await db
      .update(productsTable)
      .set({ stock: balance.toFixed(3) })
      .where(eq(productsTable.id, productId.get(ing)!));
  }
  console.log(
    `  penjualan: ${SALES.length} faktur, ${rupiah(salesTotal)} (diterima ${rupiah(salesPaid)}, piutang ${rupiah(salesTotal - salesPaid)})`,
  );

  // ── kas operasional ──────────────────────────────────────────────
  // Daily walk-in takings, plus the fixed costs of running the place. This is
  // what gives the cashflow chart a real shape across the month.
  let kasIn = 0;
  let kasOut = 0;

  // Setoran kasir harian, weekend-heavy. Deterministic, not random, so the
  // demo looks the same every time it is shown.
  for (let d = 34; d >= 0; d--) {
    const at = daysAgo(d, 21);
    const dow = at.getDay(); // 0 Min .. 6 Sab
    const weekend = dow === 0 || dow === 5 || dow === 6;
    const base = weekend ? 3_850_000 : 2_450_000;
    const wobble = ((d * 137) % 11) * 45_000; // spread, but reproducible
    const amount = base + wobble;
    await cashIn(outletId, 'Kasir', amount, at, 'cash');
    kasIn += amount;
  }

  const OPEX: { category: string; amount: number; day: number; type?: 'cash' | 'transfer' }[] = [
    { category: 'Sewa tempat', amount: 8_500_000, day: 34, type: 'transfer' },
    { category: 'Gaji karyawan', amount: 16_200_000, day: 33, type: 'transfer' },
    { category: 'BPJS Karyawan', amount: 1_450_000, day: 33, type: 'transfer' },
    { category: 'Listrik, air, internet', amount: 3_150_000, day: 31, type: 'transfer' },
    { category: 'Iklan/marketing', amount: 1_800_000, day: 29, type: 'transfer' },
    { category: 'Biaya packaging', amount: 950_000, day: 26 },
    { category: 'Transportasi operasional', amount: 620_000, day: 23 },
    { category: 'Maintenance/perbaikan kecil', amount: 1_250_000, day: 21, type: 'transfer' },
    { category: 'ATK dan perlengkapan kantor', amount: 385_000, day: 18 },
    { category: 'Biaya admin marketplace', amount: 1_120_000, day: 16, type: 'transfer' },
    { category: 'Pembelian bahan baku', amount: 780_000, day: 13 },
    { category: 'Ongkos kirim', amount: 340_000, day: 12 },
    { category: 'Transportasi operasional', amount: 540_000, day: 10 },
    { category: 'Pembelian bahan baku', amount: 920_000, day: 7 },
    { category: 'Listrik, air, internet', amount: 480_000, day: 6 },
    { category: 'Iklan/marketing', amount: 750_000, day: 5, type: 'transfer' },
    { category: 'Biaya packaging', amount: 410_000, day: 3 },
    { category: 'Pembelian bahan baku', amount: 660_000, day: 1 },
  ];
  for (const o of OPEX) {
    await cashOut(outletId, o.category, o.amount, daysAgo(o.day, 16), o.type ?? 'cash');
    kasOut += o.amount;
  }

  // One capital injection, so the report isn't purely operational.
  await cashIn(outletId, 'Modal pribadi owner', 25_000_000, daysAgo(35, 8), 'transfer');
  kasIn += 25_000_000;

  console.log(
    `  kas     : masuk ${rupiah(kasIn + salesPaid)} · keluar ${rupiah(kasOut + purchasePaid)} · net ${rupiah(kasIn + salesPaid - kasOut - purchasePaid)}`,
  );

  // features is derived from the products actually held, so the outlet only
  // shows up under Makanan/Minuman once the menu above exists.
  const features = await recalcOutletFeatures(outletId);
  console.log(`\n  outlet features -> {${features.join(', ')}}`);
  console.log('\nSelesai. Login sebagai owner outlet ini untuk demo.\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
