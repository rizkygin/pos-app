'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Plus,
  ArrowLeft,
  Coffee,
  Pizza,
  Cookie,
  Package,
  Layers,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Tag,
  DollarSign,
  Loader2,
  Image as ImageIcon,
  Edit,
  Trash2,
  User2,
  Handbag,
  Share2,
  X,
  Copy,
  Check,
  Search,
  AlertTriangle,
  Barcode,
  Truck,
  HelpCircle,
  Ruler,
  Workflow,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import QRCode from 'react-qr-code';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  addProductAction,
  AddProductInput,
  uploadImage,
  deleteProductAction,
  updateProductAction,
  removeImage,
  checkImageUrlAccessable,
  removeOnDatabase,
} from './actions';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { DashboardHeader } from '@/components/dashboard-header';
import { RecipeEditor } from './recipe-editor';
import { AddonEditor } from './addon-editor';
import { VariantEditor } from './variant-editor';
import { ORDER_FEATURES } from '@/lib/order-features';
import { resolveProductImage, isBackendImage } from '@/lib/image-src';
import { API_URL } from '@/lib/api-url';
import { formatNumberInput, parseNumberInput } from '@/lib/utils/format';

// Owner-defined sections for the public /menu page. Distinct from `category`,
// which is the fixed platform list driving marketplace browse.
type MenuGroup = { id: number; name: string; sort_order: number };

type Product = {
  id: string;
  product_name: string;
  price: string;
  price_mark_down: string;
  buying_price: string;
  category: string;
  image: string;
  isAvailable: boolean;
  description: string | null;
  unit: string;
  features: string[];
  is_for_sale: boolean;
  track_stock: boolean;
  courier_deliverable: boolean;
  stock: string;
  lowest_price?: string | null;
  highest_price?: string | null;
  barcode?: string | null;
  menu_group_id?: number | null;
  /**
   * Variants (migration 0071). Set = this row IS a variant of another product,
   * so it has no tile of its own at the counter — it is reached by tapping its
   * base and answering "Ukuran?". It stays a fully editable product here,
   * because that is where its own stock, recipe and cost live.
   */
  variant_of?: string | null;
  variant_name?: string | null;
  variant_label?: string | null;
  variant_sort?: number;
};

const rupiah = (v: number | string) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(Number(v) || 0);

type ProductsManagerProps = {
  outletId: number;
  initialProducts: Product[];
  gate?: { features: Record<string, unknown> } | null;
};

const CATEGORIES = ORDER_FEATURES.map((feature) => ({
  id: feature.slug,
  label: feature.label,
  category: feature.category,
  icon: feature.icon,
  isAvailable: feature.isAvailable,
})).sort((a, b) => Number(b.isAvailable) - Number(a.isAvailable));

// Picker-only category, deliberately NOT in ORDER_FEATURES: ingredients are
// internal stock (recipe material), never a customer-facing service tile.
// The cashier groups them under their own "bahan" tab, out of the All grid.
const INGREDIENT_CATEGORY = {
  id: 'ingredient',
  label: 'Bahan (Stok Dapur)',
  category: 'bahan',
  icon: Package,
  isAvailable: true,
};

// The other internal one. An add-on option ("Extra Keju", "Upsize Large") is a
// real product — it has to be, so it can carry its own stock, recipe and cost —
// but it only ever reaches an order attached to a dish, never on its own. Before
// this existed the owner had to file a topping under the category of the thing
// it attaches to, which put toppings in the drinks list and left nothing but
// is_for_sale standing between "Extra Es Batu" and the customer's menu.
// Internal on the backend too (INTERNAL_CATEGORIES), and no POS tab.
const ADDON_CATEGORY = {
  id: 'addon',
  label: 'Tambahan (Add-on)',
  category: 'tambahan',
  icon: Layers,
  isAvailable: true,
};

/** The two internal categories, in picker order after the browsable ones. */
const INTERNAL_CATEGORIES = [INGREDIENT_CATEGORY, ADDON_CATEGORY];

/**
 * Categories with nothing to scan.
 *
 * A barcode is a number the MANUFACTURER printed on a package. A warung's nasi
 * goreng arrives on a plate and a service arrives as somebody's afternoon —
 * neither has ever had one, so the field was pure noise on the two categories
 * most outlets here use most. It stays for mart, bahan bangunan and bahan,
 * where the goods really do come out of a box with a code on it.
 */
const NO_BARCODE_CATEGORIES = new Set(['makanan', 'minuman', 'jasa']);

/**
 * One catalogue, three audiences — so one table was always answering three
 * different questions at once.
 *
 *   produk     what a customer can buy. Priced to sell, grouped into menu
 *              sections, switched on and off for the storefront.
 *   bahan      what the kitchen consumes. Never sold, so its selling price is
 *              a column of Rp0 and its menu group is a column of dashes; what
 *              the owner actually wants to see is what it COST and how much is
 *              left.
 *   tambahan   what hangs off a dish at the counter. Sold, but never on its
 *              own and never through a menu section.
 *
 * Splitting them is not cosmetic: a fifty-item menu with thirty ingredients and
 * twenty toppings mixed in is a list you scroll past rather than read, and the
 * two internal kinds were being judged by columns that mean nothing to them.
 */
type TableKind = 'produk' | 'bahan' | 'tambahan';

const TABLE_TABS: { id: TableKind; label: string; icon: LucideIcon }[] = [
  { id: 'produk', label: 'Produk', icon: Handbag },
  { id: 'bahan', label: 'Bahan', icon: Package },
  { id: 'tambahan', label: 'Tambahan', icon: Layers },
];

// Lowercased because category is free text on the backend and older rows were
// typed by hand — "Bahan" and "bahan" are the same shelf.
const kindOf = (category: string): TableKind => {
  const c = (category ?? '').trim().toLowerCase();
  if (c === INGREDIENT_CATEGORY.category) return 'bahan';
  if (c === ADDON_CATEGORY.category) return 'tambahan';
  return 'produk';
};

// Distinct available categories for the in-form "Kategori" dropdown, so an
// existing product can be re-categorized while editing (several features can
// share one category value — dedupe on it).
const categoryOptions = (() => {
  const seen = new Set<string>();
  return [...CATEGORIES, ...INTERNAL_CATEGORIES].filter((c) => {
    if (!c.isAvailable || seen.has(c.category)) return false;
    seen.add(c.category);
    return true;
  });
})();

export const ProductsManager = ({
  outletId,
  initialProducts,
  gate,
}: ProductsManagerProps) => {
  const router = useRouter();
  const [view, setView] = useState<'list' | 'category' | 'form'>('list');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasDiscount, setHasDiscount] = useState(false);
  const [imageUrl, setImageUrl] = useState<string>('');
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [isForSale, setIsForSale] = useState(false);
  const [trackStock, setTrackStock] = useState(false);
  // Can a courier carry it? Default yes — only bulky goods (besi, keramik,
  // kulkas) get switched off, and that sends the order down the no-courier flow.
  const [courierDeliverable, setCourierDeliverable] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // Inventory list filters
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  // 'has' = a base with at least one variant; 'is' = a row that is somebody's
  // variant. Both are "the variant-shaped rows", asked from either end.
  const [variantFilter, setVariantFilter] = useState<'all' | 'has' | 'is'>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  // How many filters are narrowing the list — shown on the Filter button so a
  // half-empty table always explains itself even with the popup closed.
  const activeFilterCount =
    (categoryFilter !== 'all' ? 1 : 0) + (variantFilter !== 'all' ? 1 : 0);
  const [tab, setTab] = useState<TableKind>('produk');

  // ── Purchasable toggle ────────────────────────────────────────────────────
  // `isAvailable` is the owner's "customers may buy this right now" switch: the
  // backend hides false products from every customer-facing read (menu, browse,
  // search) while the owner still sees them here, stock and history intact.
  // Optimistic per-id overrides layered over the server props, so the switch
  // moves under the finger instead of after a round trip + router.refresh().
  const [availabilityOverrides, setAvailabilityOverrides] = useState<
    Record<string, boolean>
  >({});
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const isPurchasable = (p: Product) =>
    availabilityOverrides[p.id] ?? p.isAvailable;

  const toggleAvailability = async (product: Product) => {
    const next = !isPurchasable(product);
    setAvailabilityOverrides((prev) => ({ ...prev, [product.id]: next }));
    setTogglingId(product.id);
    try {
      const res = await fetch(
        `${API_URL}/api/products/${product.id}/availability`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isAvailable: next }),
        },
      );
      if (!res.ok) throw new Error('failed');
      // Keep anything else reading these products (menu preview, counts) honest.
      router.refresh();
    } catch {
      // Roll back to the server's value rather than leaving the owner believing
      // a product is hidden from customers when it is still on sale.
      setAvailabilityOverrides((prev) => {
        const { [product.id]: _dropped, ...rest } = prev;
        return rest;
      });
      alert('Gagal mengubah status produk. Coba lagi.');
    } finally {
      setTogglingId(null);
    }
  };
  // If the products is not deliverable the price must be shape on range value

  // ── Menu groups: owner-defined sections for the public /menu page ─────────
  const [menuGroups, setMenuGroups] = useState<MenuGroup[]>([]);
  const [selectedMenuGroupId, setSelectedMenuGroupId] = useState<number | null>(null);
  const [groupManagerOpen, setGroupManagerOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [groupError, setGroupError] = useState<string | null>(null);

  const loadMenuGroups = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/menu-groups`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) setMenuGroups(data.groups ?? []);
    } catch {
      /* non-fatal: the picker just stays empty */
    }
  }, []);

  useEffect(() => {
    loadMenuGroups();
  }, [loadMenuGroups]);

  const createMenuGroup = async () => {
    const name = newGroupName.trim();
    if (!name) return;
    setGroupError(null);
    const res = await fetch(`${API_URL}/api/menu-groups`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setGroupError(data?.error ?? 'Gagal membuat grup');
      return;
    }
    setNewGroupName('');
    await loadMenuGroups();
    // Auto-select: if the form is open, the owner made this group for it.
    if (data?.group?.id && view === 'form') setSelectedMenuGroupId(data.group.id);
  };

  const renameMenuGroup = async (id: number, name: string) => {
    setGroupError(null);
    const res = await fetch(`${API_URL}/api/menu-groups/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setGroupError(data?.error ?? 'Gagal mengubah nama grup');
    }
    await loadMenuGroups();
  };

  const deleteMenuGroup = async (id: number) => {
    // Products are NOT deleted: the FK is ON DELETE SET NULL, so they simply
    // become ungrouped and fall back to their category on the menu page.
    if (!window.confirm('Hapus grup ini? Produk di dalamnya tidak ikut terhapus, hanya jadi tanpa grup.')) return;
    await fetch(`${API_URL}/api/menu-groups/${id}`, { method: 'DELETE', credentials: 'include' });
    if (selectedMenuGroupId === id) setSelectedMenuGroupId(null);
    await loadMenuGroups();
    router.refresh();
  };

  const moveMenuGroup = async (id: number, direction: -1 | 1) => {
    const index = menuGroups.findIndex((g) => g.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= menuGroups.length) return;
    const next = [...menuGroups];
    [next[index], next[target]] = [next[target], next[index]];
    setMenuGroups(next); // optimistic — the arrows should feel instant
    await fetch(`${API_URL}/api/menu-groups/reorder`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: next.map((g) => g.id) }),
    });
    await loadMenuGroups();
  };

  // Variant wiring for the table. A variant is a real product row, so it keeps
  // its place in this list — it has its own stock, recipe and cost to edit, and
  // hiding it would leave those unreachable. What it gets instead is a line
  // saying whose variant it is, so the row that looks like a near-duplicate of
  // another explains itself. Its base gets the count.
  const productNameById = useMemo(
    () => new Map(initialProducts.map((p) => [p.id, p.product_name])),
    [initialProducts],
  );
  const variantCountByBase = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of initialProducts) {
      if (!p.variant_of) continue;
      counts.set(p.variant_of, (counts.get(p.variant_of) ?? 0) + 1);
    }
    return counts;
  }, [initialProducts]);

  const byKind = useMemo(() => {
    const acc: Record<TableKind, Product[]> = {
      produk: [],
      bahan: [],
      tambahan: [],
    };
    for (const p of initialProducts) acc[kindOf(p.category)].push(p);
    return acc;
  }, [initialProducts]);

  // The dropdown now only refines the Produk table — "bahan" and "tambahan" are
  // whole tabs, so offering them here as well would be two controls fighting
  // over the same question.
  const productCategories = useMemo(
    () =>
      Array.from(new Set(byKind.produk.map((p) => p.category).filter(Boolean))),
    [byKind],
  );
  // Column sorting for the inventory table. Click a header to sort, click again
  // to flip direction. Applied after search/category filtering.
  type SortKey = 'name' | 'group' | 'price' | 'stock';
  // Default: the owner's own menu ordering, so the table reads like the public
  // menu page rather than as one flat alphabetical list.
  const [sortBy, setSortBy] = useState<SortKey>('group');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      // Names and groups read naturally in their own order; numbers are almost
      // always wanted biggest-first.
      setSortDir(key === 'name' || key === 'group' ? 'asc' : 'desc');
    }
  };

  // Menu groups are ordered by the owner's arrows, not by name — sort on that
  // position. Ungrouped products sink to the bottom either way (they'd sort
  // above everything on a descending flip otherwise, which reads as noise).
  const groupById = useMemo(
    () => new Map(menuGroups.map((g, i) => [g.id, { name: g.name, index: i }])),
    [menuGroups],
  );
  const groupRank = (p: Product) =>
    (p.menu_group_id != null ? groupById.get(p.menu_group_id)?.index : undefined) ??
    Number.MAX_SAFE_INTEGER;

  // A service product's headline figure is its range floor, not `price` — the
  // backend mirrors price = lowest_price, but read it explicitly so sorting
  // stays correct if that ever changes. The Bahan table shows what the stock
  // cost instead of what it sells for, so it has to sort on that column too —
  // otherwise clicking "Harga Beli" reorders the rows by an invisible number.
  const sortPrice = (p: Product) =>
    tab === 'bahan'
      ? Number(p.buying_price) || 0
      : Number(p.lowest_price && p.lowest_price !== '0' ? p.lowest_price : p.price) || 0;

  // What each table shows. Menu groups only order the public menu, so they mean
  // nothing to an ingredient or a topping; the Dijual switch is the storefront
  // control, and an ingredient has no storefront — but an add-on does need it,
  // because a sold-out topping stays listed in the cashier's picker and greys
  // out rather than vanishing.
  const showsGroup = tab === 'produk';
  const showsStatus = tab !== 'bahan';
  const columnCount = 3 + (showsGroup ? 1 : 0) + (showsStatus ? 1 : 0);

  // Same `isAvailable` column, two different sentences. Turning a dish off
  // removes it from the customer's menu; turning an add-on off leaves it listed
  // in the cashier's picker but unpickable, so the cashier can say "habis"
  // instead of hunting for something that silently vanished (see lib/addons.ts).
  const statusWords =
    tab === 'tambahan'
      ? {
          on: 'Aktif',
          off: 'Habis',
          onTitle: 'Bisa dipilih di kasir — klik kalau lagi habis',
          offTitle: 'Lagi habis, tidak bisa dipilih — klik untuk mengaktifkan',
          onAria: 'Tandai habis',
          offAria: 'Aktifkan',
        }
      : {
          on: 'Dijual',
          off: 'Disembunyikan',
          onTitle: 'Bisa dibeli pelanggan — klik untuk menyembunyikan',
          offTitle: 'Disembunyikan dari pelanggan — klik untuk menjual lagi',
          onAria: 'Sembunyikan',
          offAria: 'Tampilkan',
        };

  const filteredProducts = useMemo(() => {
    const rows = byKind[tab].filter((p) => {
      const matchesSearch = p.product_name
        .toLowerCase()
        .includes(search.toLowerCase());
      // Only the Produk tab renders the dropdown, and only it is refined by it:
      // a leftover "minuman" would otherwise empty the other two tables with no
      // visible control explaining why.
      const matchesCategory =
        tab !== 'produk' || categoryFilter === 'all' || p.category === categoryFilter;
      const matchesVariant =
        tab !== 'produk' ||
        variantFilter === 'all' ||
        (variantFilter === 'has' ? variantCountByBase.has(p.id) : !!p.variant_of);
      return matchesSearch && matchesCategory && matchesVariant;
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortBy === 'name') {
        // localeCompare so "Ayam" vs "ayam" and accented names order sensibly.
        return a.product_name.localeCompare(b.product_name, 'id') * dir;
      }
      if (sortBy === 'group') {
        const ra = groupRank(a);
        const rb = groupRank(b);
        // Ungrouped always last, regardless of direction.
        if (ra !== rb) {
          if (ra === Number.MAX_SAFE_INTEGER) return 1;
          if (rb === Number.MAX_SAFE_INTEGER) return -1;
          return (ra - rb) * dir;
        }
        // Within a group, name order — a group's rows should still be scannable.
        return a.product_name.localeCompare(b.product_name, 'id');
      }
      if (sortBy === 'price') return (sortPrice(a) - sortPrice(b)) * dir;
      return ((Number(a.stock) || 0) - (Number(b.stock) || 0)) * dir;
    });
  }, [
    byKind,
    tab,
    search,
    categoryFilter,
    variantFilter,
    variantCountByBase,
    sortBy,
    sortDir,
    groupById,
  ]);

  // Source candidates for the composition editor: every other product in the
  // outlet. NOT just stock-tracked ones — a composition may draw on another
  // composition (a "bumbu dasar" defined once and used by five dishes), which
  // is what makes multi-level work. Self-exclusion matters more than it looks —
  // a "Batako 10 pcs" bundle sits right next to plain "Batako" in this list.
  // Deeper loops (A uses B uses A) are caught by the server on save, since only
  // it can see the whole graph.
  const recipeIngredientOptions = useMemo(
    () =>
      initialProducts
        .filter((p) => p.id !== editingProductId)
        .map((p) => ({
          id: p.id,
          product_name: p.product_name,
          category: p.category,
          unit: p.unit,
          stock: p.stock,
          track_stock: p.track_stock,
        })),
    [initialProducts, editingProductId],
  );

  // The row being edited, for the parts of the form that need more than the
  // draft values — chiefly whether this product is itself somebody's variant,
  // which decides if it may have variants of its own (one level deep).
  const editingProduct = useMemo(
    () => initialProducts.find((p) => p.id === editingProductId) ?? null,
    [initialProducts, editingProductId],
  );

  // Sortable column header. Shows the arrow only on the active column so the
  // header row doesn't turn into a wall of icons.
  const SortHeader = ({
    label,
    sortKey,
    align = 'left',
  }: {
    label: string;
    sortKey: SortKey;
    align?: 'left' | 'right';
  }) => {
    const active = sortBy === sortKey;
    return (
      <button
        type="button"
        onClick={() => toggleSort(sortKey)}
        aria-label={`Urutkan berdasarkan ${label}`}
        className={`flex w-full items-center gap-1 uppercase tracking-wide transition-colors hover:text-foreground ${
          align === 'right' ? 'justify-end' : ''
        } ${active ? 'text-foreground' : ''}`}
      >
        {label}
        {active ? (
          sortDir === 'asc' ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-30" />
        )}
      </button>
    );
  };

  /**
   * Guided tour of the inventory list.
   *
   * Owners here are warung/toko owners, not software users: several controls on
   * this screen (Grup Menu, the Dijual switch, "Tanpa kurir") change what their
   * CUSTOMERS see, and nothing on a button's face says so. Rather than pack the
   * page with explanatory text nobody reads, the explanation is one tap away.
   *
   * Steps are built at click time, not defined as a constant: the table only
   * exists once the outlet has products, and driver.js silently skips nothing —
   * a step pointing at a missing element opens a popover floating in the middle
   * of the screen with no context.
   */
  const startTour = () => {
    window.scrollTo({ top: 0, behavior: 'instant' });

    // Steps are gated on what the ACTIVE table renders, not just on having
    // rows: Grup and the Dijual switch are columns the Bahan and Tambahan
    // tables deliberately drop, and a step pointing at a column that is not on
    // screen is the floating-popover failure this function exists to avoid.
    const hasRows = filteredProducts.length > 0;
    const steps: DriveStep[] = [
      {
        element: '[data-tour="add-product"]',
        popover: {
          title: 'Tambah Produk',
          description:
            'Mulai di sini. Pian pilih dulu jenis produknya (makanan, mart, jasa, bahan bangunan), baru isi harga, stok, dan fotonya.',
          side: 'bottom',
          align: 'end',
        },
      },
      {
        element: '[data-tour="menu-groups"]',
        popover: {
          title: 'Grup Menu',
          description:
            'Grup Menu itu <b>judul bagian di halaman menu pelanggan</b> — misal "Nasi", "Minuman Dingin", "Semen &amp; Pasir". Beda dengan Kategori: kategori itu daftar tetap dari sistem, grup ini punya pian sendiri. Urutan grup di sini = urutan yang dilihat pelanggan.',
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="share"]',
        popover: {
          title: 'Share Produk',
          description:
            'Keluar QR Code &amp; link menu pian. Tempel QR-nya di meja atau etalase — pelanggan scan, langsung lihat menu dan bisa pesan.',
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="filters"]',
        popover: {
          title: 'Cari &amp; Saring',
          description:
            'Ketik nama produk untuk mencari, atau tekan Filter untuk menyaring per kategori dan varian kalau produk pian sudah banyak.',
          side: 'bottom',
        },
      },
    ];

    if (hasRows && showsGroup) {
      steps.push({
        element: '[data-tour="col-group"]',
        popover: {
          title: 'Kolom Grup',
          description:
            'Daftar ini diurutkan mengikuti urutan Grup Menu pian, jadi tampilannya sama seperti yang dilihat pelanggan. Produk tanpa grup selalu di paling bawah. Klik judul kolom mana saja untuk mengubah urutan.',
          side: 'bottom',
        },
      });
    }

    if (hasRows) {
      steps.push(
        {
          element: '[data-tour="col-stock"]',
          popover: {
            title: 'Kolom Stok',
            description:
              'Angka merah artinya habis, kuning artinya tinggal sedikit (5 atau kurang). Tanda "—" artinya produk ini memang tidak dihitung stoknya.',
            side: 'bottom',
          },
        },
        {
          element: '[data-tour="row-actions"]',
          popover: {
            title: 'Edit &amp; Hapus',
            description:
              'Pensil untuk mengubah harga, foto, grup, atau resep. Tong sampah untuk menghapus — produk yang sudah pernah terjual tidak benar-benar dihapus, hanya diarsipkan supaya laporan penjualan lama tidak rusak.',
            side: 'left',
          },
        },
      );
    }

    if (hasRows && showsStatus) {
      // Second-to-last, where it used to sit: the row actions are the natural
      // last word.
      steps.splice(steps.length - 1, 0, {
        element: '[data-tour="row-status"]',
        popover: {
          title: 'Tombol Dijual / Disembunyikan',
          description:
            tab === 'tambahan'
              ? 'Saklar "boleh dipilih sekarang". Kalau dimatikan, tambahan ini <b>tetap terlihat di kasir tapi tidak bisa dipilih</b> — jadi pian bisa bilang ke pelanggan bahwa memang lagi habis, bukan hilang begitu saja.'
              : 'Ini saklar "boleh dibeli sekarang". Kalau dimatikan, produk <b>langsung hilang dari menu, pencarian, dan halaman pelanggan</b> — tapi tetap ada di sini, stok dan riwayat penjualannya aman. Pas buat barang yang lagi habis: matikan dulu, nyalakan lagi kalau sudah ada.',
          side: 'left',
        },
      });
    }

    driver({
      showProgress: true,
      progressText: '{{current}} / {{total}}',
      nextBtnText: 'Lanjut',
      prevBtnText: 'Kembali',
      doneBtnText: 'OK',
      overlayColor: 'rgba(0, 0, 0, 0.6)',
      stagePadding: 6,
      stageRadius: 12,
      popoverClass: 'app-tour-popover',
      steps,
    }).drive();
  };

  // Rendered in BOTH the product list header and the product form. A plain
  // function rather than a component: an inline component gets a fresh identity
  // every render, which would remount these inputs and drop focus mid-typing.
  const renderMenuGroupManager = () => (
    <div className="rounded-xl border bg-muted/30 p-3 space-y-3">
      <div className="flex gap-2">
        <input
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              createMenuGroup();
            }
          }}
          placeholder="Nama grup baru, misal: Nasi"
          maxLength={60}
          className="flex-1 h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        />
        <button
          type="button"
          onClick={createMenuGroup}
          className="h-10 rounded-lg bg-blue-600 px-4 text-xs font-bold text-white hover:bg-blue-700"
        >
          Tambah
        </button>
      </div>

      {groupError && <p className="text-xs font-medium text-rose-500">{groupError}</p>}

      {menuGroups.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Belum ada grup. Tambah grup untuk menata menu publik.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {menuGroups.map((g, i) => (
            <li key={g.id} className="flex items-center gap-2">
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => moveMenuGroup(g.id, -1)}
                  disabled={i === 0}
                  aria-label="Naikkan"
                  className="text-muted-foreground hover:text-foreground disabled:opacity-25"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => moveMenuGroup(g.id, 1)}
                  disabled={i === menuGroups.length - 1}
                  aria-label="Turunkan"
                  className="text-muted-foreground hover:text-foreground disabled:opacity-25"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <input
                key={g.name}
                defaultValue={g.name}
                maxLength={60}
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next && next !== g.name) renameMenuGroup(g.id, next);
                  else e.target.value = g.name;
                }}
                className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => deleteMenuGroup(g.id)}
                aria-label="Hapus grup"
                className="p-1.5 text-muted-foreground hover:text-rose-500"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  // Form State
  const [formData, setFormData] = useState({
    product_name: '',
    price: '',
    price_mark_down: '',
    buying_price: '',
    description: '',
    unit: 'pcs',
    lowest_price: '',
    highest_price: '',
    barcode: '',
  });

  // Service products (category "jasa") are priced as a negotiable range instead
  // of a fixed selling price + discount.
  const isServiceCategory = selectedCategory === 'jasa';

  // Only these categories can plausibly contain something a courier can't
  // carry, so only these are asked. A warung adding nasi goreng should never
  // have to think about kurir at all — food, drink and jasa are always
  // deliverable (jasa never involves a courier in the first place), and asking
  // anyway was three extra seconds of doubt on every single product.
  const asksCourierQuestion =
    selectedCategory === 'mart' || selectedCategory === 'bahan bangunan';

  // "bahan" and "tambahan" are internal (INTERNAL_CATEGORIES on the backend
  // too): a public listing excludes them whatever is_for_sale says, so the
  // toggle below is not the thing keeping them off the customer's menu.
  const isInternalCategory = INTERNAL_CATEGORIES.some(
    (c) => c.category === selectedCategory,
  );

  // Bulky goods the outlet hauls itself are priced as a band, not a single
  // number: the floor is the goods, and the room above it is what the owner may
  // charge for the haul once they've seen the address. Same two inputs as jasa,
  // a different meaning — for jasa the range IS the price, here it's the ongkir
  // ceiling. Stock keeps working either way; besi is counted in batang.
  const isMaterialsProduct = isForSale && asksCourierQuestion && !courierDeliverable;

  // Both range-priced kinds share the two price inputs below.
  const usesPriceRange = isServiceCategory || isMaterialsProduct;

  // ── What this category is worth asking about ───────────────────────────
  // Every field below that isn't universal is gated on one of these. The form
  // was asking every product every question, so an owner adding a drink waded
  // past a barcode scanner and a photo uploader to reach the price.

  // See NO_BARCODE_CATEGORIES.
  const asksBarcode = !NO_BARCODE_CATEGORIES.has(selectedCategory);

  // "Punya stok sendiri?" has no answer for a service: there is nothing to
  // count. The backend already forces track_stock off for a range-priced jasa
  // (rangePricedFields), so hiding the toggle agrees with what actually gets
  // saved rather than concealing a contradiction.
  const asksStockQuestion = !isServiceCategory;

  // An ingredient is never sold. It comes in on a purchase invoice and leaves
  // through a recipe, and it is excluded from every public listing and from the
  // POS grid by category alone — so a selling price is a number with nowhere to
  // go. The Bahan table already substitutes Harga Beli for its Harga column
  // because this one is a column of zeroes; the form was the last place still
  // asking. What an ingredient COSTS comes from the stock ledger (avg_cost),
  // never from here. The backend pins price to 0 for this category too.
  const asksSellingPrice = selectedCategory !== INGREDIENT_CATEGORY.category;

  // A picture is for the customer, and an ingredient or an add-on option never
  // reaches one: both are excluded from every public listing whatever
  // is_for_sale says (INTERNAL_CATEGORIES on the backend). Uploading a photo of
  // a sack of flour costs the owner a step and buys nothing.
  const asksImage = !isInternalCategory;

  const handleCategorySelect = (category: string) => {
    setSelectedCategory(category);
    setSelectedMenuGroupId(null);
    setIsForSale(false);
    // Ingredients exist to be counted: default them to tracked stock.
    setTrackStock(category === 'bahan');
    setCourierDeliverable(true);
    setView('form');
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  // Money inputs: show thousand separators (Rupiah) while storing raw digits.
  const handleMoneyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: parseNumberInput(value) }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const data: AddProductInput = {
      ...formData,
      category: selectedCategory,
      outletId: outletId, // Correctly using outletId
    } as any;

    // Categories that don't ask are always deliverable. Forced here rather than
    // trusting the state: an owner can set this on a bahan-bangunan product,
    // switch the category to makanan, and the toggle disappears while still
    // holding false — which would silently push their food order down the
    // no-courier flow with nothing on screen explaining why.
    const courierDeliverableToSave = asksCourierQuestion ? courierDeliverable : true;

    // Same hazard, and this one bites harder: a barcode typed while the category
    // was mart stays in formData after a switch to makanan, where the field is
    // gone. Barcodes are unique per outlet, so the invisible leftover would
    // collide with the retail product it actually belongs to — and the owner
    // would be reading an error about a field they cannot see.
    const barcodeToSave = asksBarcode ? formData.barcode : '';

    // A service has nothing to count. The backend forces this off for jasa, but
    // only once a price range has actually been typed, so send the honest value
    // rather than leaning on that.
    const trackStockToSave = isServiceCategory ? false : trackStock;

    // Same hazard on the price fields: type a band on a bulky product, flip it
    // back to courier-deliverable, and the inputs disappear while formData still
    // holds the numbers. The backend treats any non-empty lowest_price as
    // range-priced, so leaving them in would price a fixed-price product as a
    // band — and, for jasa, force its stock off.
    const priceRangeToSave = usesPriceRange
      ? { lowest_price: formData.lowest_price, highest_price: formData.highest_price }
      : { lowest_price: '', highest_price: '' };

    // And once more for the selling price: a number typed under makanan is still
    // in formData after a switch to bahan, where the input is gone. The backend
    // pins this category to 0 regardless, so sending anything else would only
    // make the two disagree about what the owner was shown.
    const sellingPriceToSave = asksSellingPrice
      ? { price: formData.price, price_mark_down: formData.price_mark_down }
      : { price: '0', price_mark_down: '0' };

    let result;
    if (editingProductId) {
      result = await updateProductAction(editingProductId, {
        ...formData,
        ...priceRangeToSave,
        ...sellingPriceToSave,
        barcode: barcodeToSave,
        category: selectedCategory,
        menu_group_id: selectedMenuGroupId,
        // NOT cleared for an internal category: the uploader is hidden there,
        // but a picture the product already has is still its picture.
        image: imageUrl,
        features: selectedFeatures,
        is_for_sale: isForSale,
        track_stock: trackStockToSave,
        courier_deliverable: courierDeliverableToSave,
      });
    } else {
      result = await addProductAction({
        ...formData,
        ...priceRangeToSave,
        ...sellingPriceToSave,
        barcode: barcodeToSave,
        category: selectedCategory,
        menu_group_id: selectedMenuGroupId,
        outlet_id: outletId,
        image: imageUrl,
        features: selectedFeatures,
        is_for_sale: isForSale,
        track_stock: trackStockToSave,
        courier_deliverable: courierDeliverableToSave,
      });
    }

    setIsSubmitting(false);

    if (result.success) {
      // Reset and go back to list
      setFormData({
        product_name: '',
        price: '',
        price_mark_down: '',
        buying_price: '',
        description: '',
        unit: 'pcs',
        lowest_price: '',
        highest_price: '',
        barcode: '',
      });
      setImageUrl('');
      setEditingProductId(null);
      setSelectedFeatures([]);
      setView('list');
      // Re-run the server component so the list reflects the new/edited product.
      router.refresh();
    } else {
      alert(result.message);
    }
  };

  const handleToggleDiscount = (checked: boolean) => {
    setHasDiscount(checked);
    if (!checked) setFormData((prev) => ({ ...prev, price_mark_down: '' }));
  };

  const handleEdit = async (product: Product) => {
    if (product.image === 'avatar.png') {
      setImageUrl('/avatar.png');
      product.image = '/avatar.png';
    } else {
      const result = await checkImageUrlAccessable(product.image);
      if (!result?.success) {
        setImageUrl('');
      } else {
        setImageUrl(product.image);
      }
    }
    setHasDiscount(
      !!product.price_mark_down && product.price_mark_down !== '0',
    );
    setSelectedFeatures(product.features ?? []);
    setIsForSale(product.is_for_sale ?? true);
    setTrackStock(product.track_stock ?? true);
    setCourierDeliverable(product.courier_deliverable ?? true);
    setEditingProductId(product.id);
    setSelectedCategory(product.category);
    setSelectedMenuGroupId(product.menu_group_id ?? null);
    setFormData({
      product_name: product.product_name,
      price: product.price,
      price_mark_down: product.price_mark_down,
      buying_price: product.buying_price,
      description: product.description || '',
      unit: product.unit,
      lowest_price: product.lowest_price ?? '',
      highest_price: product.highest_price ?? '',
      barcode: product.barcode ?? '',
    });
    setView('form');
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Yakin pian handak hapus produk ini?')) return;
    setIsSubmitting(true);
    const result = await deleteProductAction(id);
    setIsSubmitting(false);
    if (!result.success) {
      alert(result.message);
      return;
    }
    // Re-run the server component so the deleted product drops off the list.
    router.refresh();
  };

  //handle Image Upload

  const handleRemoveImage = async () => {
    if (
      imageUrl === '/products/avatar.png' ||
      imageUrl === '/avatar.png' ||
      imageUrl === ''
    ) {
      setImageUrl('');
      return;
    }
    if (editingProductId) {
      const result = await removeImage(imageUrl);
      if (result.success) {
        const removeResult = await removeOnDatabase(imageUrl);
        if (removeResult.success) {
          setImageUrl('');
          return;
        }
        alert(removeResult.message);
      }
      alert(result.message);
      return;
    }
    const result = await removeImage(imageUrl);
    if (!result.success) {
      alert(result.message);
      return;
    }
    setImageUrl('');
  };

  const ImageInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size >= 5000000) {
        alert('Image size must be less than 5MB.');
        setImageUrl('');
        return;
      }
      const formData = new FormData();
      formData.append('image', file);

      const result = await uploadImage(formData);
      if (result.success && result.imageUrl) {
        setImageUrl(result.imageUrl);
      }
      if (!result.success) {
        alert(result.message);
      }
    }
  };

  useEffect(() => {
    if (initialProducts.length > 0) {
      setView('list');
    } else {
      setView('category');
    }
  }, []);

  return (
    <div className="space-y-6 mt-4">
      {view === 'list' && (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4 md:mb-6">
            <div>
              <h2 className="text-xl md:text-3xl font-extrabold tracking-tight text-foreground">
                Menajemen Produk
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {/* Explicit space: the transform swallows the one between an
                    expression and the text after it, and this rendered as
                    "69produk". */}
                {initialProducts.length}
                {' produk · kelola harga, stok, & ketersediaan.'}
              </p>
              {/* Same affordance as the Promosi page: several controls here
                  change what CUSTOMERS see, which no button face can say. */}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={startTour}
                className="mt-1 -ml-2 h-8 gap-1.5 rounded-lg px-2 text-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-950/30"
              >
                <HelpCircle className="h-4 w-4" />
                Apa fungsi tombol-tombol ini?
              </Button>
            </div>
            {/* Wraps on a phone: three fixed-width buttons on one non-wrapping
                row pushed "Tambah Produk" — the primary action — clean off the
                right edge. It now takes its own full-width line first, with the
                two secondary buttons splitting the line under it. */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Reachable without opening a product: an owner organising their
                  menu shouldn't have to edit an item to create a section, and
                  an outlet with no products yet had no path to it at all. */}
              <Button
                variant="outline"
                onClick={() => setGroupManagerOpen((v) => !v)}
                data-tour="menu-groups"
                className="flex-1 sm:flex-none rounded-xl border-border hover:bg-muted/50 transition-colors"
              >
                <Layers className="mr-2 h-4 w-4" />
                Grup Menu
                {menuGroups.length > 0 && (
                  <span className="ml-2 rounded-full bg-muted px-1.5 text-[10px] font-bold">
                    {menuGroups.length}
                  </span>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShareOpen(true)}
                data-tour="share"
                className="flex-1 sm:flex-none rounded-xl border-border hover:bg-muted/50 transition-colors"
              >
                <Share2 className="mr-2 h-4 w-4" />
                Share Produk
              </Button>
              <Button
                onClick={() => {
                  setEditingProductId(null);
                  setFormData({
                    product_name: '',
                    price: '',
                    price_mark_down: '',
                    buying_price: '',
                    description: '',
                    unit: 'pcs',
                    lowest_price: '',
                    highest_price: '',
                    barcode: '',
                  });
                  setImageUrl('');
                  setSelectedFeatures([]);
                  setView('category');
                }}
                data-tour="add-product"
                className="order-first sm:order-0 w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-lg shadow-blue-600/20 transition-all sm:hover:scale-105"
              >
                <Plus className="mr-2 h-5 w-5" />
                Tambah Produk
              </Button>
            </div>
          </div>

          {groupManagerOpen && (
            <div className="mb-4 md:mb-6 space-y-2">
              <p className="text-sm font-bold flex items-center gap-2">
                <Layers className="h-4 w-4 text-muted-foreground" />
                Grup Menu
                <span className="text-xs font-normal text-muted-foreground">
                  — judul &amp; urutan bagian di halaman menu publik
                </span>
              </p>
              {renderMenuGroupManager()}
            </div>
          )}

          {initialProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-3xl bg-muted/10">
              <div className="p-4 rounded-full bg-blue-50 text-blue-500 mb-4">
                <Package className="h-8 w-8" />
              </div>
              <h3 className="text-xl font-bold text-foreground">
                Belum Ada Produk
              </h3>
              <p className="text-muted-foreground max-w-sm text-center mt-2 mb-6">
                Mulai bangun inventaris dengan menambahkan produk pertama Anda.
              </p>
              <Button
                onClick={() => setView('category')}
                variant="outline"
                className="rounded-xl border-dashed hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors"
              >
                Tambah Produk Pertama
              </Button>
            </div>
          ) : (
            <>
              {/* The three tables. One at a time rather than stacked: an
                  owner looking at their menu is not also reading their
                  ingredient list, and stacking would push Tambahan a full
                  screen below the fold on any real catalogue. Counts sit on the
                  tabs so nothing is hidden — you can see a shelf is not empty
                  without opening it. */}
              <div
                role="tablist"
                aria-label="Jenis produk"
                // overflow-x-auto is the safety net, not the plan: the three
                // labels fit down to a 320px phone, and if a longer one ever
                // stops fitting the bar scrolls rather than clipping a tab off
                // the right edge the way it did before.
                className="mb-4 flex gap-1 overflow-x-auto rounded-2xl border bg-muted/30 p-1"
              >
                {TABLE_TABS.map((t) => {
                  const active = tab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setTab(t.id)}
                      // min-w-0 is what actually lets these shrink: a flex item
                      // refuses to go below its content width without it, so at
                      // 390px the three tabs overran the bar and clipped
                      // "Tambahan" and its count off the right edge. The icon
                      // goes first when space is short — the word is the part
                      // that identifies the tab.
                      className={`flex min-w-0 flex-auto items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-bold transition-colors sm:gap-1.5 sm:px-3 sm:text-sm ${
                        active
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <t.icon className="hidden h-4 w-4 shrink-0 sm:block" />
                      {/* shrink-0: flex was shaving a sub-pixel off each label
                          and `truncate` turned that 1px into "Prod…". The word
                          is the tab's identity — it is the last thing that
                          should give way. */}
                      <span className="shrink-0 whitespace-nowrap">
                        {t.label}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-1 py-0.5 text-[11px] tabular-nums sm:px-1.5 ${
                          active
                            ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/50'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {byKind[t.id].length}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* What the two internal shelves are, said once. Both are easy to
                  mistake for a menu the customer can see. */}
              {tab === 'bahan' && (
                <p className="mb-3 text-xs text-muted-foreground">
                  Stok dapur: dipakai lewat resep, tidak pernah muncul di menu
                  pelanggan. Harga di sini harga <b>beli</b> (modal).
                </p>
              )}
              {tab === 'tambahan' && (
                <p className="mb-3 text-xs text-muted-foreground">
                  Pilihan add-on: selalu menempel pada produk lain, tidak pernah
                  dijual sendiri. Harga yang ditagih ke pelanggan diatur per grup
                  di form produk yang menawarkannya — angka di sini harga dasar
                  produknya.
                </p>
              )}

              {/* Toolbar: search + a Filter button that pops the category/variant choices */}
              <div
                className="flex flex-col sm:flex-row gap-2 sm:items-center mb-4"
                data-tour="filters"
              >
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Cari produk…"
                    className="h-11 w-full rounded-xl border border-input bg-transparent pl-10 pr-4 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  />
                </div>
                {tab === 'produk' && (
                  <Popover open={filterOpen} onOpenChange={setFilterOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 rounded-xl px-4 shadow-sm"
                      >
                        <SlidersHorizontal className="h-4 w-4" />
                        Filter
                        {activeFilterCount > 0 && (
                          <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-xs font-semibold text-white">
                            {activeFilterCount}
                          </span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-80 gap-4 p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold">Saring produk</p>
                        {activeFilterCount > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setCategoryFilter('all');
                              setVariantFilter('all');
                            }}
                            className="text-xs font-medium text-blue-600 hover:underline"
                          >
                            Reset
                          </button>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">
                          Kategori
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {['all', ...productCategories].map((c) => {
                            const active = categoryFilter === c;
                            return (
                              <button
                                key={c}
                                type="button"
                                onClick={() => setCategoryFilter(c)}
                                className={`rounded-full border px-3 py-1 text-xs capitalize transition-colors ${
                                  active
                                    ? 'border-blue-600 bg-blue-600 text-white'
                                    : 'border-input bg-background hover:bg-muted'
                                }`}
                              >
                                {c === 'all' ? 'Semua kategori' : c}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">
                          Varian
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {(
                            [
                              ['all', 'Semua produk'],
                              ['has', 'Punya varian'],
                              ['is', 'Merupakan varian'],
                            ] as const
                          ).map(([value, label]) => {
                            const active = variantFilter === value;
                            return (
                              <button
                                key={value}
                                type="button"
                                onClick={() => setVariantFilter(value)}
                                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                                  active
                                    ? 'border-blue-600 bg-blue-600 text-white'
                                    : 'border-input bg-background hover:bg-muted'
                                }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
              </div>

              {/* An empty shelf is not the same as an empty catalogue — the
                  owner has products, just none of THIS kind, and the way to get
                  one is a category they have probably never opened. Say which. */}
              {byKind[tab].length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-muted/10 p-10 text-center">
                  <div className="mb-3 rounded-full bg-muted p-3 text-muted-foreground">
                    {tab === 'bahan' ? (
                      <Package className="h-6 w-6" />
                    ) : tab === 'tambahan' ? (
                      <Layers className="h-6 w-6" />
                    ) : (
                      <Handbag className="h-6 w-6" />
                    )}
                  </div>
                  <h3 className="font-bold">
                    {tab === 'bahan'
                      ? 'Belum ada bahan'
                      : tab === 'tambahan'
                        ? 'Belum ada tambahan'
                        : 'Belum ada produk jualan'}
                  </h3>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    {tab === 'bahan'
                      ? 'Catat beras, minyak, gas dan kawan-kawannya lewat kategori "Bahan (Stok Dapur)" — stoknya nanti berkurang sendiri lewat resep.'
                      : tab === 'tambahan'
                        ? 'Buat dulu produknya di kategori "Tambahan (Add-on)" — misal Telur Ceplok atau Extra Keju — lalu susun grupnya dari form produk yang mau menawarkannya.'
                        : 'Semua isi etalase pian masih berupa bahan atau tambahan. Tambah satu produk yang bisa dibeli pelanggan.'}
                  </p>
                  <Button
                    onClick={() => setView('category')}
                    variant="outline"
                    className="mt-4 rounded-xl border-dashed hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
                  >
                    <Plus className="mr-1.5 h-4 w-4" />
                    Tambah
                  </Button>
                </div>
              ) : (
              <div className="rounded-2xl border bg-background overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2.5 font-semibold">
                          <SortHeader label="Produk" sortKey="name" />
                        </th>
                        {showsGroup && (
                          <th
                            className="px-3 py-2.5 font-semibold"
                            data-tour="col-group"
                          >
                            <SortHeader label="Grup" sortKey="group" />
                          </th>
                        )}
                        <th className="px-3 py-2.5 text-right font-semibold">
                          <SortHeader
                            label={tab === 'bahan' ? 'Harga Beli' : 'Harga'}
                            sortKey="price"
                            align="right"
                          />
                        </th>
                        <th
                          className="px-3 py-2.5 text-right font-semibold"
                          data-tour="col-stock"
                        >
                          <SortHeader label="Stok" sortKey="stock" align="right" />
                        </th>
                        {showsStatus && (
                          <th className="px-3 py-2.5 font-semibold">Status</th>
                        )}
                        <th className="px-3 py-2.5 text-right font-semibold">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProducts.map((product) => {
                        const discounted =
                          !!product.price_mark_down &&
                          product.price_mark_down !== '0';
                        const isService =
                          !!product.lowest_price &&
                          product.lowest_price !== '0';
                        const stockNum = Number(product.stock) || 0;
                        const lowStock = product.track_stock && stockNum <= 5;
                        const purchasable = isPurchasable(product);
                        const groupName =
                          product.menu_group_id != null
                            ? groupById.get(product.menu_group_id)?.name
                            : null;
                        return (
                          <tr
                            key={product.id}
                            className="border-b last:border-0 hover:bg-muted/20 transition-colors"
                          >
                            {/* Produk */}
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="relative h-10 w-10 shrink-0 rounded-lg overflow-hidden border bg-muted/40 flex items-center justify-center">
                                  {product.image &&
                                  product.image !== 'avatar.png' ? (
                                    <Image
                                      src={resolveProductImage(product.image)}
                                      unoptimized={isBackendImage(product.image)}
                                      fill
                                      className="object-cover"
                                      alt={product.product_name}
                                    />
                                  ) : (
                                    <Package className="h-5 w-5 text-muted-foreground/40" />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <p className="font-semibold truncate">
                                    {product.product_name}
                                  </p>
                                  {product.variant_of ? (
                                    <span className="flex items-center gap-1 text-[11px] text-violet-600 dark:text-violet-400 truncate">
                                      <Ruler className="h-3 w-3 shrink-0" />
                                      {product.variant_name || 'Varian'} ·{' '}
                                      {productNameById.get(product.variant_of) ??
                                        'produk lain'}
                                    </span>
                                  ) : (
                                    variantCountByBase.has(product.id) && (
                                      <span className="flex items-center gap-1 text-[11px] text-violet-600 dark:text-violet-400">
                                        <Ruler className="h-3 w-3 shrink-0" />
                                        {(variantCountByBase.get(product.id) ?? 0) + 1}{' '}
                                        {product.variant_label?.trim() || 'varian'}
                                      </span>
                                    )
                                  )}
                                  {/* Only on Produk: on the other two tabs
                                      this said "Bahan · inventaris" on every
                                      single row, under a tab already labelled
                                      Bahan. */}
                                  {tab === 'produk' && (
                                    <span className="text-[11px] text-muted-foreground capitalize">
                                      {product.category || '—'}
                                      {!product.is_for_sale && ' · inventaris'}
                                    </span>
                                  )}
                                  {product.is_for_sale &&
                                    product.courier_deliverable === false && (
                                      <span className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-500 mt-0.5">
                                        <Truck className="h-3 w-3 shrink-0" />
                                        Tanpa kurir
                                      </span>
                                    )}
                                  {product.barcode && (
                                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground font-mono truncate mt-0.5">
                                      <Barcode className="h-3 w-3 shrink-0" />
                                      {product.barcode}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>
                            {/* Grup menu — shown at every width: it's the column
                                the table now sorts by, so hiding it on a phone
                                hid the reason for the row order. Produk only;
                                see showsGroup. */}
                            {showsGroup && (
                              <td className="px-3 py-2.5">
                                {groupName ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">
                                    <Layers className="h-3 w-3 shrink-0 text-muted-foreground" />
                                    {groupName}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>
                            )}
                            {/* Harga — what it COST for an ingredient (it is
                                never sold, so its selling price is a column of
                                zeroes), what it SELLS for otherwise. */}
                            <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                              {tab === 'bahan' ? (
                                <span className="font-semibold">
                                  {rupiah(product.buying_price)}
                                </span>
                              ) : isService ? (
                                <span className="font-semibold">
                                  {rupiah(product.lowest_price!)}
                                  {product.highest_price &&
                                  product.highest_price !== '0'
                                    ? `–${rupiah(product.highest_price)}`
                                    : '+'}
                                </span>
                              ) : discounted ? (
                                <div className="flex flex-col items-end">
                                  <span className="font-semibold">
                                    {rupiah(product.price_mark_down)}
                                  </span>
                                  <span className="text-[11px] text-muted-foreground line-through">
                                    {rupiah(product.price)}
                                  </span>
                                </div>
                              ) : (
                                <span className="font-semibold">
                                  {rupiah(product.price)}
                                </span>
                              )}
                            </td>
                            {/* Stok */}
                            <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                              {product.track_stock ? (
                                <span
                                  className={`inline-flex items-center justify-end gap-1 font-semibold ${
                                    stockNum <= 0
                                      ? 'text-rose-600'
                                      : lowStock
                                        ? 'text-amber-600'
                                        : 'text-foreground'
                                  }`}
                                >
                                  {lowStock && (
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                  )}
                                  {stockNum}
                                  {tab === 'bahan' && product.unit && (
                                    <span className="font-normal text-muted-foreground">
                                      {product.unit}
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span
                                  className="text-muted-foreground"
                                  title="Tidak dihitung stoknya"
                                >
                                  —
                                </span>
                              )}
                            </td>
                            {/* Status — a switch, not a label: this is the
                                owner's "boleh dibeli sekarang" control, and a
                                sold-out item should be one tap away from being
                                hidden from customers. */}
                            {/* Every row carries the anchor; driver.js targets
                                the first match, i.e. the top row. */}
                            {showsStatus && (
                            <td className="px-3 py-2.5" data-tour="row-status">
                              <button
                                type="button"
                                role="switch"
                                aria-checked={purchasable}
                                aria-label={`${purchasable ? statusWords.onAria : statusWords.offAria} ${product.product_name}`}
                                title={
                                  purchasable
                                    ? statusWords.onTitle
                                    : statusWords.offTitle
                                }
                                disabled={togglingId === product.id}
                                onClick={() => toggleAvailability(product)}
                                className="inline-flex items-center gap-2 disabled:opacity-50"
                              >
                                <span
                                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                                    purchasable
                                      ? 'bg-emerald-500'
                                      : 'bg-zinc-300 dark:bg-zinc-700'
                                  }`}
                                >
                                  <span
                                    className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${
                                      purchasable ? 'left-4.5' : 'left-0.5'
                                    }`}
                                  />
                                </span>
                                <span
                                  className={`whitespace-nowrap text-[11px] font-semibold ${
                                    purchasable
                                      ? 'text-emerald-700 dark:text-emerald-500'
                                      : 'text-muted-foreground'
                                  }`}
                                >
                                  {purchasable ? statusWords.on : statusWords.off}
                                </span>
                              </button>
                            </td>
                            )}
                            {/* Aksi */}
                            <td className="px-3 py-2.5" data-tour="row-actions">
                              <div className="flex items-center justify-end gap-1">
                                {/* Recipe Explorer: this product's real HPP
                                    tree. Shown on every row on purpose — a
                                    bahan is a legitimate thing to open (it is
                                    a leaf, and the page says what its stock
                                    and cover look like), and a product with no
                                    recipe gets an empty state pointing at the
                                    recipe form rather than a dead end. */}
                                {(gate?.features?.recipeExplorer as boolean) && (
                                  <button
                                    onClick={() =>
                                      router.push(
                                        `/dashboard/addproducts/recipe-explorer/${product.id}?name=${encodeURIComponent(product.product_name)}`,
                                      )
                                    }
                                    className="p-1.5 rounded-lg bg-muted/60 text-muted-foreground hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors"
                                    aria-label="Jelajah resep"
                                    title="Jelajah resep"
                                  >
                                    <Workflow className="h-4 w-4" />
                                  </button>
                                )}
                                <button
                                  onClick={() => handleEdit(product)}
                                  className="p-1.5 rounded-lg bg-muted/60 text-muted-foreground hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                  aria-label="Edit produk"
                                >
                                  <Edit className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => handleDelete(product.id)}
                                  disabled={isSubmitting}
                                  className="p-1.5 rounded-lg bg-muted/60 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-50"
                                  aria-label="Hapus produk"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {filteredProducts.length === 0 && (
                        <tr>
                          <td
                            colSpan={columnCount}
                            className="px-3 py-10 text-center text-sm text-muted-foreground"
                          >
                            Tidak ada yang cocok dengan pencarian.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              )}
            </>
          )}
        </>
      )}

      {view === 'category' && (
        <div className="max-w-4xl mx-auto">
          <Button
            variant="ghost"
            onClick={() => setView('list')}
            className="mb-6 hover:bg-muted/50 text-muted-foreground hover:text-foreground -ml-4 rounded-xl"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Kembali Ke Etalase
          </Button>

          <div className="mb-4 md:mb-8 text-center">
            <h2 className="text-xl md:text-3xl font-extrabold tracking-tight text-foreground">
              Pilih Layanan Pian
            </h2>
            <p className="text-muted-foreground mt-2 text-sm md:text-lg">
              Apa jenis produk yang pian tambahkan?
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-6">
            {[...CATEGORIES, ...INTERNAL_CATEGORIES].map((cat) => (
              <button
                key={cat.id}
                disabled={!cat.isAvailable}
                onClick={() => handleCategorySelect(cat.category)}
                className={`flex flex-col items-center justify-center p-4 md:p-8 rounded-2xl md:rounded-3xl border-2 transition-all group relative overflow-hidden ${
                  !cat.isAvailable
                    ? 'bg-muted/30 cursor-not-allowed opacity-50'
                    : 'hover:-translate-y-1 hover:shadow-xl bg-background hover:border-blue-500'
                }`}
              >
                <div
                  className={`p-3 md:p-4 rounded-xl md:rounded-2xl mb-2 md:mb-4 transition-transform duration-300 relative z-10 shadow-sm ${
                    !cat.isAvailable
                      ? 'text-muted-foreground bg-muted/50'
                      : 'text-amber-500 bg-amber-50 group-hover:scale-110'
                  }`}
                >
                  <cat.icon className="h-6 w-6 md:h-10 md:w-10" />
                </div>
                <span
                  className={`font-bold text-sm md:text-lg relative z-10 transition-colors text-center ${
                    !cat.isAvailable
                      ? 'text-muted-foreground'
                      : 'text-foreground group-hover:text-blue-600'
                  }`}
                >
                  {cat.label}
                </span>
                {cat.isAvailable && (
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent to-muted/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {view === 'form' && (
        <div className="max-w-2xl mx-auto">
          <Button
            variant="ghost"
            onClick={() => setView('category')}
            className="mb-6 hover:bg-muted/50 text-muted-foreground hover:text-foreground -ml-4 rounded-xl"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Categories
          </Button>

          <div className="bg-background border rounded-2xl md:rounded-3xl p-4 md:p-8 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-500 to-purple-500" />

            <div className="flex items-center gap-4 mb-8">
              <div className="p-3 rounded-xl bg-blue-50 text-blue-600">
                <Package className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-2xl font-bold tracking-tight">
                  {editingProductId ? 'Edit' : 'Tambah produk'} {selectedCategory}
                </h2>
                <p className="text-muted-foreground text-sm font-medium">
                  Tambahkan sesuai yang sebenarnya{' '}
                  {editingProductId ? 'update' : 'add to'} your inventory.
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-bold flex items-center gap-2">
                  <Tag className="h-4 w-4 text-muted-foreground" />
                  Nama Produk
                </label>
                <input
                  required
                  name="product_name"
                  value={formData.product_name}
                  onChange={handleInputChange}
                  className="flex h-12 w-full rounded-xl border border-input bg-transparent px-4 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="e.g. Signature Iced Latte"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold flex items-center gap-2">
                  <Layers className="h-4 w-4 text-muted-foreground" />
                  Kategori
                </label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="flex h-12 w-full rounded-xl border border-input bg-background px-4 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  {categoryOptions.map((c) => (
                    <option key={c.category} value={c.category}>
                      {c.label} ({c.category})
                    </option>
                  ))}
                  {/* Legacy/renamed category no longer in the option list —
                      keep it selectable so an edit doesn't silently move it. */}
                  {selectedCategory &&
                    !categoryOptions.some((c) => c.category === selectedCategory) && (
                      <option value={selectedCategory}>{selectedCategory}</option>
                    )}
                </select>
              </div>

              {/* ── Grup Menu ──
                  Not the same thing as Kategori above: that one is the fixed
                  platform list that drives marketplace browse, this is purely
                  how THIS outlet's public menu is laid out. Optional — an
                  unset product falls back to its category on the menu page. */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold flex items-center gap-2">
                    <Layers className="h-4 w-4 text-muted-foreground" />
                    Grup Menu
                    <span className="text-xs font-normal text-muted-foreground">(opsional)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setGroupManagerOpen((v) => !v)}
                    className="text-xs font-bold text-blue-600 hover:text-blue-700"
                  >
                    {groupManagerOpen ? 'Tutup' : 'Kelola grup'}
                  </button>
                </div>
                <select
                  value={selectedMenuGroupId ?? ''}
                  onChange={(e) =>
                    setSelectedMenuGroupId(e.target.value ? Number(e.target.value) : null)
                  }
                  className="flex h-12 w-full rounded-xl border border-input bg-background px-4 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <option value="">— Tanpa grup —</option>
                  {menuGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Menentukan judul &amp; urutan bagian di halaman menu publik.
                </p>
                {groupManagerOpen && renderMenuGroupManager()}
              </div>

              {/* Both toggles sit ABOVE the price fields deliberately: together
                  they decide whether this product is priced with one number or a
                  band (see isMaterialsProduct). Below the prices, flipping one
                  would reshape a section the owner had already filled in and
                  scrolled past. */}
              <div className="space-y-2">
                <label className="text-sm font-bold flex items-center gap-2">
                  <Layers className="h-4 w-4 text-muted-foreground" />
                  Jual ke pelanggan online?
                </label>
                <button
                  type="button"
                  onClick={() => setIsForSale((v) => !v)}
                  className={`flex w-full items-center justify-between rounded-xl border-2 px-4 py-3 text-left transition-colors ${
                    isForSale
                      ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/30'
                      : 'border-border bg-muted/30'
                  }`}
                >
                  <span>
                    <span className="block text-sm font-semibold">
                      {isForSale ? 'Dijual ke pelanggan' : 'Hanya inventaris'}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {isForSale
                        ? 'Produk tampil di menu pelanggan.'
                        : 'Disembunyikan dari menu pelanggan; hanya untuk stok & faktur.'}
                    </span>
                  </span>
                  <span
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                      isForSale ? 'bg-teal-600' : 'bg-zinc-300 dark:bg-zinc-700'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${
                        isForSale ? 'left-[22px]' : 'left-0.5'
                      }`}
                    />
                  </span>
                </button>
                {isForSale && isInternalCategory && (
                  <p className="text-xs text-amber-700 dark:text-amber-500">
                    Kategori ini internal, jadi produknya tetap tidak muncul di
                    menu pelanggan. Sakelar ini cuma membukanya untuk faktur dan
                    laporan.
                  </p>
                )}
              </div>

              {/* Asked only for mart & bahan bangunan — see asksCourierQuestion. */}
              {isForSale && asksCourierQuestion && (
                <div className="space-y-2">
                  <label className="text-sm font-bold flex items-center gap-2">
                    <Truck className="h-4 w-4 text-muted-foreground" />
                    Apakah produk ini bisa diantar kurir?
                  </label>
                  <button
                    type="button"
                    onClick={() => setCourierDeliverable((v) => !v)}
                    className={`flex w-full items-center justify-between rounded-xl border-2 px-4 py-3 text-left transition-colors ${
                      courierDeliverable
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                        : 'border-amber-500 bg-amber-50 dark:bg-amber-950/30'
                    }`}
                  >
                    <span>
                      <span className="block text-sm font-semibold">
                        {courierDeliverable
                          ? 'Bisa diantar kurir'
                          : 'Tidak bisa diantar kurir'}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {courierDeliverable
                          ? 'Cukup ringan buat dibawa kurir (sembako, obat, cat, paku).'
                          : 'Barang berat/besar (besi, keramik, wastafel, kulkas) — pesanan diantar sendiri oleh outlet, tanpa kurir.'}
                      </span>
                    </span>
                    <span
                      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                        courierDeliverable
                          ? 'bg-blue-600'
                          : 'bg-zinc-300 dark:bg-zinc-700'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${
                          courierDeliverable ? 'left-[22px]' : 'left-0.5'
                        }`}
                      />
                    </span>
                  </button>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 md:gap-6">
                {usesPriceRange ? (
                  <>
                    <div className="space-y-2">
                      <label className="text-sm font-bold flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                        {isMaterialsProduct ? 'Harga Barang' : 'Harga Terendah'}
                      </label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-medium text-sm">
                          Rp
                        </span>
                        <input
                          required
                          name="lowest_price"
                          inputMode="numeric"
                          value={formatNumberInput(formData.lowest_price)}
                          onChange={handleMoneyChange}
                          className="flex h-12 w-full rounded-xl border border-input bg-transparent pl-12 pr-4 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                          placeholder="50.000"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                        {isMaterialsProduct ? 'Harga + Diantar' : 'Harga Tertinggi'}
                      </label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-medium text-sm">
                          Rp
                        </span>
                        <input
                          required
                          name="highest_price"
                          inputMode="numeric"
                          value={formatNumberInput(formData.highest_price)}
                          onChange={handleMoneyChange}
                          className="flex h-12 w-full rounded-xl border border-input bg-transparent pl-12 pr-4 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                          placeholder="150.000"
                        />
                      </div>
                    </div>
                    <p className="col-span-2 -mt-1 text-xs text-muted-foreground">
                      {isMaterialsProduct ? (
                        <>
                          Pelanggan bayar <strong>Harga Barang</strong>. Selisih ke{' '}
                          <strong>Harga + Diantar</strong> jadi jatah ongkos angkut —
                          pian tetapkan angka pastinya setelah lihat alamat, dan
                          tidak boleh lebih dari selisih itu.
                        </>
                      ) : (
                        <>
                          Layanan jasa memakai rentang harga. Nanti pian pilih harga
                          pasti (di antara terendah &amp; tertinggi) saat menerima
                          order.
                        </>
                      )}
                    </p>
                  </>
                ) : asksSellingPrice ? (
                  <div className="space-y-2">
                    <label className="text-sm font-bold flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      Harga Jual
                    </label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-medium text-sm">
                        Rp
                      </span>
                      <input
                        required
                        name="price"
                        inputMode="numeric"
                        value={formatNumberInput(formData.price)}
                        onChange={handleMoneyChange}
                        className="flex h-12 w-full rounded-xl border border-input bg-transparent pl-12 pr-4 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                        placeholder="25.000"
                      />
                    </div>
                  </div>
                ) : null}
                <div className="space-y-2">
                  <label className="text-sm font-bold flex items-center gap-2 text-amber-600">
                    <DollarSign className="h-4 w-4" />
                    Harga Beli (Modal)
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-amber-600/70 font-medium text-sm">
                      Rp
                    </span>
                    <input
                      name="buying_price"
                      inputMode="numeric"
                      value={formatNumberInput(formData.buying_price)}
                      onChange={handleMoneyChange}
                      className="flex h-12 w-full rounded-xl border border-amber-200 bg-amber-50/30 pl-12 pr-4 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                      placeholder="15.000"
                    />
                  </div>
                </div>
                <div
                  // Hidden for both range-priced kinds: the backend mirrors
                  // price_mark_down to the range floor, so a discount entered
                  // here would be silently discarded. Hidden for ingredients for
                  // the plainer reason that there is no price to discount.
                  className={`col-span-2 space-y-3 ${
                    usesPriceRange || !asksSellingPrice ? 'hidden' : ''
                  }`}
                >
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm font-bold text-muted-foreground">
                      Ada Diskon?
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={hasDiscount}
                      onClick={() => handleToggleDiscount(!hasDiscount)}
                      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${hasDiscount ? 'bg-emerald-500' : 'bg-muted'}`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md ring-0 transition-transform duration-200 ${hasDiscount ? 'translate-x-5' : 'translate-x-0'}`}
                      />
                    </button>
                  </label>
                  {hasDiscount && (
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-600/70 font-medium text-sm">
                        Rp
                      </span>
                      <input
                        required
                        name="price_mark_down"
                        inputMode="numeric"
                        value={formatNumberInput(formData.price_mark_down)}
                        onChange={handleMoneyChange}
                        className="flex h-12 w-full rounded-xl border border-emerald-300 bg-emerald-50/40 pl-12 pr-4 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                        placeholder="Harga setelah diskon"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold flex items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  Satuan
                </label>
                <input
                  name="unit"
                  value={formData.unit}
                  onChange={handleInputChange}
                  maxLength={10}
                  list="unit-suggestions"
                  className="flex h-12 w-full rounded-xl border border-input bg-transparent px-4 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  placeholder="pcs, ml, kg, porsi…"
                />
                {/* Free text — the list is just autocomplete suggestions. */}
                <datalist id="unit-suggestions">
                  <option value="pcs" />
                  <option value="porsi" />
                  <option value="ml" />
                  <option value="liter" />
                  <option value="gram" />
                  <option value="kg" />
                  <option value="pack" />
                  <option value="lusin" />
                  <option value="meter" />
                </datalist>
                <p className="text-xs text-muted-foreground">
                  Satuan hitung stok & resep (maks. 10 huruf) — bebas diisi.
                </p>
              </div>

              {asksBarcode && (
                <div className="space-y-2">
                  <label className="text-sm font-bold flex items-center gap-2">
                    <Barcode className="h-4 w-4 text-muted-foreground" />
                    Barcode
                    <span className="font-normal text-xs text-muted-foreground">(opsional)</span>
                  </label>
                  <input
                    name="barcode"
                    value={formData.barcode}
                    onChange={handleInputChange}
                    // USB barcode scanners emulate typing + an Enter keystroke —
                    // without this, scanning into this field would submit the
                    // whole product form early instead of just filling it in.
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.preventDefault();
                    }}
                    maxLength={64}
                    className="flex h-12 w-full rounded-xl border border-input bg-transparent px-4 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 font-mono"
                    placeholder="Scan atau ketik kode barcode…"
                  />
                  <p className="text-xs text-muted-foreground">
                    Cocok untuk produk mart/ritel. Harus unik per outlet — dua produk tidak
                    boleh berbagi barcode yang sama.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-bold flex items-center gap-2">
                  <Layers className="h-4 w-4 text-muted-foreground" />
                  Description
                </label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleInputChange}
                  className="flex min-h-[100px] w-full rounded-xl border border-input bg-transparent px-4 py-3 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 resize-none"
                  placeholder="Describe your product..."
                />
              </div>

              {isForSale && !isInternalCategory && (
                <div className="space-y-3">
                  <label className="text-sm font-bold flex items-center gap-2">
                    <Tag className="h-4 w-4 text-muted-foreground" />
                    Fitur Produk
                    <span className="text-xs font-light text-muted-foreground ml-2">
                      Pilih fitur produk untuk memudahkan pelanggan menemukan
                      produk Anda.
                    </span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORIES.map((f) => {
                      const active = selectedFeatures.includes(f.id);
                      return (
                        <button
                          key={f.id}
                          type="button"
                          disabled={!f.isAvailable}
                          onClick={() =>
                            setSelectedFeatures((prev) =>
                              prev.includes(f.id)
                                ? prev.filter((x) => x !== f.id)
                                : [...prev, f.id],
                            )
                          }
                          className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all duration-150 ${
                            !f.isAvailable
                              ? 'border-border bg-muted/30 text-muted-foreground/40 cursor-not-allowed'
                              : active
                                ? 'border-blue-500 bg-blue-500 text-white shadow-sm'
                                : 'border-border bg-background text-muted-foreground hover:border-blue-300 hover:text-blue-600'
                          }`}
                        >
                          {f.label}
                        </button>
                      );
                    })}
                  </div>
                  {selectedFeatures.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {selectedFeatures.length} fitur dipilih
                    </p>
                  )}
                </div>
              )}


              {asksStockQuestion && (
              <div className="space-y-2">
                <label className="text-sm font-bold flex items-center gap-2">
                  <Layers className="h-4 w-4 text-muted-foreground" />
                  Apakah Produk ini dapat dikelola stoknya?
                </label>
                <button
                  type="button"
                  onClick={() => setTrackStock((v) => !v)}
                  className={`flex w-full items-center justify-between rounded-xl border-2 px-4 py-3 text-left transition-colors ${
                    trackStock
                      ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/30'
                      : 'border-border bg-muted/30'
                  }`}
                >
                  <span>
                    <span className="block text-sm font-semibold">
                      {trackStock
                        ? 'Punya stok sendiri'
                        : 'Ambil dari stok produk lain'}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {trackStock
                        ? 'Stok bertambah/berkurang lewat kasir, faktur & opname.'
                        : 'Produk olahan, paket/eceran, atau jasa — stoknya dipotong dari produk lain (atau tidak dihitung sama sekali).'}
                    </span>
                  </span>
                  <span
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                      trackStock
                        ? 'bg-teal-600'
                        : 'bg-zinc-300 dark:bg-zinc-700'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${
                        trackStock ? 'left-[22px]' : 'left-0.5'
                      }`}
                    />
                  </span>
                </button>
              </div>
              )}

              {/* Composition editor: any saved product may have one, with or
                  without stock of its own. Without = a menu item or a
                  pass-through sub-composition, expanded at sale time. With =
                  an in-house intermediate (sambal, adonan) that is PRODUCED in
                  batches and then drawn down like any other stock.
                  Serves food (nasi goreng -> beras) and non-food alike
                  ("Batako 10 pcs" -> 10 batako) — the decrement never looks at
                  category. Absence of a composition is a valid permanent state,
                  so nothing is shown or nagged otherwise. */}
              {editingProductId &&
                recipeIngredientOptions.length > 0 && (
                  <RecipeEditor
                    productId={editingProductId}
                    ingredients={recipeIngredientOptions}
                    trackStock={trackStock}
                  />
                )}

              {/* Variants — the OTHER question a product can ask, and the one
                  that is constantly mistaken for the first. An add-on adds a
                  line to the order; a variant decides which product the line
                  is. Sized as an add-on, a Large reports a Reguler plus an
                  abstract "upsize" and takes its extra milk out of nobody's
                  stock. Placed above the add-on editor so the owner meets the
                  right tool first when what they want is a size.

                  Not offered for an internal category (a topping has no sizes
                  of its own — the dish it hangs off does) nor for a product
                  that is already somebody's variant: one level deep. */}
              {editingProductId &&
                !isInternalCategory &&
                !editingProduct?.variant_of && (
                  <VariantEditor
                    productId={editingProductId}
                    productName={
                      formData.product_name ||
                      editingProduct?.product_name ||
                      ''
                    }
                  />
                )}

              {/* Add-on groups. Saved independently of the product form, like
                  the composition above: attaching a group is a single PUT, so
                  the owner is never made to re-save the whole product to change
                  what toppings it offers. */}
              {editingProductId && (
                <AddonEditor
                  productId={editingProductId}
                  products={recipeIngredientOptions}
                />
              )}

              {asksImage && (
              <div className="space-y-2">
                <label className="text-sm font-bold flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                  Product Image
                </label>
                <span className="text-xs text-muted-foreground">
                  Ukuran File Maksimal 5 MB
                </span>
                {imageUrl ? (
                  <div className="relative w-full h-48 rounded-xl overflow-hidden border">
                    <Image
                      src={resolveProductImage(imageUrl)}
                      unoptimized={isBackendImage(imageUrl)}
                      fill
                      className="object-cover"
                      alt="Product Image Preview"
                    />
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="absolute top-2 right-2 rounded-xl shadow-md"
                      onClick={handleRemoveImage}
                    >
                      Remove
                    </Button>
                  </div>
                ) : (
                  <input
                    type="file"
                    name="image"
                    accept="image/*"
                    ref={ImageInputRef}
                    onChange={handleImageUpload}
                    className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-xl border-blue-200 bg-blue-50/50 hover:bg-blue-50 transition-colors text-blue-600 font-bold p-4 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  />
                )}
              </div>
              )}

              <div className="pt-4 flex justify-end">
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full sm:w-auto px-8 rounded-xl bg-blue-600 hover:bg-blue-700 h-12 text-md font-bold shadow-lg shadow-blue-600/20"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />{' '}
                      Saving...
                    </>
                  ) : editingProductId ? (
                    'Update Product'
                  ) : (
                    'Publish Product'
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Share Menu modal */}
      {shareOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={() => setShareOpen(false)}
          />
          <div className="fixed inset-x-4 top-1/2 z-50 mx-auto max-w-sm -translate-y-1/2 rounded-2xl border bg-background p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-black">Share Your Menu</h3>
              <button
                onClick={() => setShareOpen(false)}
                className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex justify-center mb-5">
              <div className="rounded-xl bg-white p-3 shadow-lg border">
                <QRCode
                  value={
                    typeof window !== 'undefined'
                      ? `${window.location.origin}/menu/${outletId}`
                      : ''
                  }
                  size={160}
                />
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-xl border bg-muted/30 px-3 py-2.5">
              <p className="flex-1 truncate text-xs text-muted-foreground">
                {typeof window !== 'undefined'
                  ? `${window.location.origin}/menu/${outletId}`
                  : ''}
              </p>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(
                    `${window.location.origin}/menu/${outletId}`,
                  );
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-blue-700"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5" /> Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" /> Copy
                  </>
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
