'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Plus,
  ArrowLeft,
  Package,
  Layers,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Loader2,
  Image as ImageIcon,
  ImagePlus,
  Edit,
  Trash2,
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
  Sprout,
  SlidersHorizontal,
  Circle,
  CircleCheck,
  TrendingUp,
  TrendingDown,
  Lock,
  EyeOff,
  type LucideIcon,
} from 'lucide-react';
import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import QRCode from 'react-qr-code';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  addProductAction,
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
  /** From /api/products/mine: does this product have recipe rows of its own. */
  has_recipe?: boolean;
  /** …and is it inside another live product's recipe (a Paket Hemat's item). */
  is_ingredient?: boolean;
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
  iconBg: feature.iconBg,
  iconColor: feature.iconColor,
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
  iconBg: 'bg-zinc-100',
  iconColor: 'text-zinc-600',
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
  iconBg: 'bg-violet-100',
  iconColor: 'text-violet-600',
  isAvailable: true,
};

/** The two internal categories, in picker order after the browsable ones. */
const INTERNAL_CATEGORIES = [INGREDIENT_CATEGORY, ADDON_CATEGORY];

/**
 * The item's code — every category gets to have one.
 *
 * It started as a BARCODE: the number a manufacturer printed on a package,
 * which a plate of nasi goreng has never had, so food, drink and services
 * were not asked. But the same column is the only per-outlet-unique code the
 * catalogue has, and a shop counting stock wants to find "RAK-A12" whether or
 * not a factory printed it. So the field is offered everywhere and named for
 * both uses; products has no separate SKU column, deliberately.
 */

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

// ── Add/edit form ──────────────────────────────────────────────────────────

const EMPTY_FORM = {
  product_name: '',
  price: '',
  price_mark_down: '',
  buying_price: '',
  description: '',
  unit: 'pcs',
  lowest_price: '',
  highest_price: '',
  barcode: '',
};

/**
 * What picking each kind means, in the OWNER's words. ORDER_FEATURES carries
 * the customer's copy ("Makanan lezat dari restoran terdekat"), which tells an
 * owner nothing about what the choice changes in this form.
 */
const TYPE_COPY: Record<string, { short: string; hint: string; example: string }> = {
  makanan: { short: 'Makanan', hint: 'Nasi, mie, kue — dijual per porsi.', example: 'Nasi Goreng Spesial' },
  minuman: { short: 'Minuman', hint: 'Kopi, teh, jus, es.', example: 'Es Kopi Susu' },
  jasa: {
    short: 'Jasa',
    hint: 'Servis & reparasi. Harganya rentang, dipastikan saat terima order.',
    example: 'Servis AC',
  },
  mart: { short: 'Belanja', hint: 'Sembako, obat, kebutuhan rumah.', example: 'Beras Premium 5 kg' },
  'bahan bangunan': {
    short: 'Bahan Bangunan',
    hint: 'Semen, cat, besi. Barang besar boleh diantar sendiri.',
    example: 'Semen 50 kg',
  },
  bahan: {
    short: 'Bahan Dapur',
    hint: 'Beras, minyak, gas. Tidak dijual — dipakai lewat resep.',
    example: 'Beras',
  },
  tambahan: {
    short: 'Add-on',
    hint: 'Extra keju, telur ceplok — menempel di produk lain.',
    example: 'Extra Keju',
  },
};

// One-tap units per kind. The field stays free text (max 10 chars); these are
// only the answers each kind of shop gives most, so nobody types "porsi" fifty
// times while entering a menu.
const UNIT_SUGGESTIONS: Record<string, string[]> = {
  makanan: ['porsi', 'pcs', 'bungkus', 'box'],
  minuman: ['gelas', 'cup', 'botol', 'pcs'],
  jasa: ['unit', 'jam', 'hari', 'kali'],
  mart: ['pcs', 'pack', 'kg', 'liter', 'lusin'],
  'bahan bangunan': ['sak', 'batang', 'meter', 'lembar', 'kg', 'dus'],
  bahan: ['kg', 'gram', 'liter', 'ml', 'pcs', 'butir'],
  tambahan: ['porsi', 'pcs', 'shot'],
};
const DEFAULT_UNIT_SUGGESTIONS = ['pcs', 'porsi', 'pack', 'kg', 'liter'];

const DISCOUNT_PRESETS = [10, 20, 25, 50];

// Border, background and ring colour live together per tone so no input ever
// carries two competing values for the same property.
const INPUT_TONES = {
  default: 'border-input bg-transparent focus-visible:ring-blue-500',
  amber:
    'border-amber-200 bg-amber-50/30 focus-visible:ring-amber-500 dark:border-amber-900/60 dark:bg-amber-950/20',
  emerald:
    'border-emerald-300 bg-emerald-50/40 focus-visible:ring-emerald-500 dark:border-emerald-900/60 dark:bg-emerald-950/20',
} as const;
type InputTone = keyof typeof INPUT_TONES;

// Width and text size are left to the caller for the same reason.
const fieldClass = (extra: string, tone: InputTone = 'default') =>
  `rounded-xl border shadow-sm transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${INPUT_TONES[tone]} ${extra}`;

// The pieces below are module-level on purpose: declared inside
// ProductsManager they would get a fresh identity every render and remount,
// dropping focus from the input being typed in.

function FormSection({
  id,
  step,
  title,
  description,
  children,
}: {
  id?: string;
  step: number;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-16 rounded-2xl border bg-background p-4 shadow-sm md:p-6"
    >
      <header className="mb-4 flex items-start gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
          {step}
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-bold leading-7">{title}</h3>
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
      </header>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function FieldLabel({
  htmlFor,
  required,
  optional,
  className = '',
  children,
}: {
  htmlFor?: string;
  required?: boolean;
  optional?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const cls = `mb-1.5 flex items-center gap-1 text-sm font-semibold ${className}`;
  const inner = (
    <>
      {children}
      {required && <span className="text-rose-500">*</span>}
      {optional && (
        <span className="text-xs font-normal text-muted-foreground">(opsional)</span>
      )}
    </>
  );
  // A chip group has no single control to point at, so it gets a plain
  // caption rather than a <label> that labels nothing.
  return htmlFor ? (
    <label htmlFor={htmlFor} className={cls}>
      {inner}
    </label>
  ) : (
    <p className={cls}>{inner}</p>
  );
}

function Chip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'border-blue-600 bg-blue-600 text-white'
          : 'border-input bg-background text-muted-foreground hover:border-blue-300 hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

const TOGGLE_TONES = {
  teal: { on: 'border-teal-500 bg-teal-50 dark:bg-teal-950/30', track: 'bg-teal-600' },
  blue: { on: 'border-blue-500 bg-blue-50 dark:bg-blue-950/30', track: 'bg-blue-600' },
} as const;

/** A question answered by one big switch, with the consequence spelled out. */
function ToggleCard({
  question,
  checked,
  onToggle,
  onTitle,
  offTitle,
  onHint,
  offHint,
  tone = 'teal',
  warnWhenOff = false,
}: {
  question: string;
  checked: boolean;
  onToggle: () => void;
  onTitle: string;
  offTitle: string;
  onHint: string;
  offHint: string;
  tone?: keyof typeof TOGGLE_TONES;
  warnWhenOff?: boolean;
}) {
  const t = TOGGLE_TONES[tone];
  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold">{question}</p>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onToggle}
        className={`flex w-full items-center justify-between gap-3 rounded-xl border-2 px-4 py-3 text-left transition-colors ${
          checked
            ? t.on
            : warnWhenOff
              ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30'
              : 'border-border bg-muted/30'
        }`}
      >
        <span>
          <span className="block text-sm font-semibold">{checked ? onTitle : offTitle}</span>
          <span className="block text-xs text-muted-foreground">
            {checked ? onHint : offHint}
          </span>
        </span>
        <span
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            checked ? t.track : 'bg-zinc-300 dark:bg-zinc-700'
          }`}
        >
          <span
            className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${
              checked ? 'left-5.5' : 'left-0.5'
            }`}
          />
        </span>
      </button>
    </div>
  );
}

/** Rupiah input: shows thousand separators, stores raw digits. */
function MoneyInput({
  id,
  name,
  value,
  onChange,
  placeholder,
  required,
  unit,
  tone = 'default',
}: {
  id: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  required?: boolean;
  unit?: string;
  tone?: InputTone;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
        Rp
      </span>
      <input
        id={id}
        name={name}
        required={required}
        inputMode="numeric"
        autoComplete="off"
        value={formatNumberInput(value)}
        onChange={onChange}
        placeholder={placeholder}
        className={fieldClass(
          `h-11 w-full pl-11 text-sm tabular-nums ${unit ? 'pr-20' : 'pr-3.5'}`,
          tone,
        )}
      />
      {unit && (
        <span className="pointer-events-none absolute right-3.5 top-1/2 max-w-16 -translate-y-1/2 truncate text-xs text-muted-foreground">
          / {unit}
        </span>
      )}
    </div>
  );
}

export const ProductsManager = ({
  outletId,
  initialProducts,
  gate,
}: ProductsManagerProps) => {
  const router = useRouter();
  // Bahan and Tambahan piggyback on the `stock` plan feature: both shelves are
  // pointless without inventory tracking, and `stock` already draws the same
  // basic/pro-vs-max_lite/max line for the Stock & Invoice pages.
  const bahanAddonsAllowed = (gate?.features?.stock as boolean) === true;
  // The composition editor and the HPP explorer it feeds are one capability on
  // one flag, off on Basic only: a recipe is worth having for costing long
  // before an outlet pays for inventory tracking.
  const recipeAllowed = (gate?.features?.recipeExplorer as boolean) === true;
  // Variants and add-ons sit on the same Max Lite line as the shelves they
  // need. An add-on option IS a `tambahan` product, so offering the editor on
  // a plan whose Tambahan shelf is hidden would only ever build an empty
  // group; variants are whole products too, and land in the same etalase.
  const productOptionsAllowed = bahanAddonsAllowed;
  // No separate category screen any more: the kind is the first section of the
  // form. An outlet with nothing yet lands straight in it.
  const [view, setView] = useState<'list' | 'form'>(() =>
    initialProducts.length > 0 ? 'list' : 'form',
  );
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
  // Form feedback lives on the page, not in alert(): a blocking dialog on a
  // phone hides the very field the message is about.
  const [formError, setFormError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  // Which row's Edit is loading — opening it checks the image first, and a
  // button that does nothing for a second reads as broken.
  const [openingId, setOpeningId] = useState<string | null>(null);
  // "Simpan & Tambah Lagi" run count, so a long menu entry session shows
  // progress instead of the same blank form over and over.
  const [savedCount, setSavedCount] = useState(0);
  const [notice, setNotice] = useState<{ text: string; at: number } | null>(null);
  const showNotice = (text: string) => setNotice({ text, at: Date.now() });
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  const pageTopRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  // Which button asked for the submit; see submitWithIntent.
  const intentRef = useRef<'new' | 'configure' | null>(null);
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
  // it can see the whole graph. Add-ons stay in this list — the add-on editor
  // picks its options from it, and the recipe editor needs them to name one
  // saved into a recipe before that was refused — but the recipe picker
  // itself never offers one (see isAddon in recipe-editor.tsx).
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
  const [formData, setFormData] = useState(EMPTY_FORM);

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

  const typeCopy = TYPE_COPY[selectedCategory];
  const unitLabel = formData.unit.trim() || 'satuan';
  const unitSuggestions = UNIT_SUGGESTIONS[selectedCategory] ?? DEFAULT_UNIT_SUGGESTIONS;

  // The placeholder picture an image-less product is stored with. It is not a
  // photo the owner chose, so the form offers an upload rather than a preview.
  const hasRealImage =
    !!imageUrl && imageUrl !== '/avatar.png' && imageUrl !== '/products/avatar.png';

  // ── Money feedback ────────────────────────────────────────────────────────
  const sellNum = Number(formData.price) || 0;
  const buyNum = Number(formData.buying_price) || 0;
  const discNum = hasDiscount ? Number(formData.price_mark_down) || 0 : 0;
  const discountInvalid = hasDiscount && discNum > 0 && discNum >= sellNum;
  const discountPct =
    hasDiscount && sellNum > 0 && discNum > 0 && !discountInvalid
      ? Math.round((1 - discNum / sellNum) * 100)
      : null;
  // What the customer actually pays, which is what the margin is made on.
  const effectiveSell = discountPct !== null ? discNum : sellNum;
  const showMargin =
    asksSellingPrice && !usesPriceRange && effectiveSell > 0 && buyNum > 0;
  const profit = effectiveSell - buyNum;
  const marginPct = effectiveSell > 0 ? Math.round((profit / effectiveSell) * 100) : 0;
  const lowNum = Number(formData.lowest_price) || 0;
  const highNum = Number(formData.highest_price) || 0;
  const rangeInvalid = usesPriceRange && lowNum > 0 && highNum > 0 && highNum < lowNum;

  // ── Recipe / variants / add-ons ───────────────────────────────────────────
  // All three hang off a saved row, so a new product shows them locked with a
  // way through, instead of not at all — before, an owner only found them by
  // saving, hunting the product down in the list and opening it again.
  const showsRecipeEditor =
    recipeAllowed && recipeIngredientOptions.some((p) => kindOf(p.category) !== 'tambahan');
  // Not for an internal kind (a topping has no sizes — the dish does) nor for
  // a product that is already somebody's variant: one level deep.
  const showsVariantEditor =
    productOptionsAllowed && !isInternalCategory && !editingProduct?.variant_of;
  const showsAddonEditor = productOptionsAllowed;
  const extrasNames = [
    showsRecipeEditor && 'Resep',
    showsVariantEditor && 'Varian',
    showsAddonEditor && 'Add-on',
  ].filter(Boolean) as string[];
  const showsExtras = extrasNames.length > 0;
  const extrasTitle = extrasNames.join(' · ');

  // ── Unsaved-changes guard ─────────────────────────────────────────────────
  // A new product counts as touched once anything is typed or uploaded. An
  // edit compares against how the product looked when it was opened.
  const makeSnapshot = (d: {
    formData: typeof EMPTY_FORM;
    category: string;
    image: string;
    isForSale: boolean;
    trackStock: boolean;
    courierDeliverable: boolean;
    menuGroupId: number | null;
    features: string[];
    hasDiscount: boolean;
  }) =>
    JSON.stringify([
      d.formData,
      d.category,
      d.image,
      d.isForSale,
      d.trackStock,
      d.courierDeliverable,
      d.menuGroupId,
      d.features,
      d.hasDiscount,
    ]);
  const formSnapshot = makeSnapshot({
    formData,
    category: selectedCategory,
    image: imageUrl,
    isForSale,
    trackStock,
    courierDeliverable,
    menuGroupId: selectedMenuGroupId,
    features: selectedFeatures,
    hasDiscount,
  });
  // Set where an existing product is opened (handleEdit) or a new one first
  // becomes one ("Simpan & atur sekarang"); null for a new product.
  const [baseline, setBaseline] = useState<string | null>(null);
  const hasTypedAnything =
    Object.entries(formData).some(([k, v]) => k !== 'unit' && v.trim() !== '') ||
    hasRealImage;
  const isDirty =
    view === 'form' &&
    (editingProductId
      ? baseline !== null && baseline !== formSnapshot
      : hasTypedAnything);

  useEffect(() => {
    if (!isDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  // Switching views keeps the scroll position of the shell, which opened the
  // form halfway down whenever Edit was clicked on a lower row.
  useEffect(() => {
    pageTopRef.current?.scrollIntoView({ block: 'start' });
  }, [view]);

  const resetDraft = () => {
    setFormData(EMPTY_FORM);
    setImageUrl('');
    setImageError(null);
    setFormError(null);
    setSelectedFeatures([]);
    setHasDiscount(false);
    setEditingProductId(null);
    setGroupManagerOpen(false);
    setBaseline(null);
  };

  /** Blank form. `category` preselects the kind (the Bahan/Tambahan shelves). */
  const openNewForm = (category = '') => {
    resetDraft();
    setSelectedCategory(category);
    setSelectedMenuGroupId(null);
    setIsForSale(false);
    // Ingredients exist to be counted: default them to tracked stock.
    setTrackStock(category === INGREDIENT_CATEGORY.category);
    setCourierDeliverable(true);
    setSavedCount(0);
    setView('form');
  };

  const closeForm = () => {
    resetDraft();
    setView('list');
  };

  const handleBack = () => {
    if (isDirty && !window.confirm('Perubahan belum disimpan. Tetap keluar?')) return;
    closeForm();
  };

  const chooseCategory = (category: string) => {
    setSelectedCategory(category);
    // A new product takes each kind's own starting point. An existing one is
    // only being re-filed, so its settings stay as the owner left them.
    if (!editingProductId) setTrackStock(category === INGREDIENT_CATEGORY.category);
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

  /**
   * Submit on behalf of a secondary button. Those are type="button" so that
   * the form's only submit button is the plain Simpan — pressing Enter in a
   * field must never mean "save and open a blank form" or "save and jump to
   * the recipe". requestSubmit() fires the submit event synchronously, so the
   * intent is read before it is cleared again.
   */
  const submitWithIntent = (intent: 'new' | 'configure') => {
    intentRef.current = intent;
    formRef.current?.requestSubmit();
    intentRef.current = null;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const intent = intentRef.current ?? 'save';
    if (isSubmitting || uploadingImage) return;
    setFormError(null);

    if (!selectedCategory) {
      setFormError('Pilih jenis produk dulu.');
      return;
    }
    if (asksSellingPrice && !usesPriceRange && discountInvalid) {
      setFormError('Harga diskon harus lebih kecil dari harga jual.');
      return;
    }
    if (rangeInvalid) {
      setFormError(
        isMaterialsProduct
          ? '"Harga + diantar" tidak boleh lebih kecil dari harga barang.'
          : 'Harga tertinggi tidak boleh lebih kecil dari harga terendah.',
      );
      return;
    }

    setIsSubmitting(true);

    // Categories that don't ask are always deliverable. Forced here rather than
    // trusting the state: an owner can set this on a bahan-bangunan product,
    // switch the category to makanan, and the toggle disappears while still
    // holding false — which would silently push their food order down the
    // no-courier flow with nothing on screen explaining why.
    const courierDeliverableToSave = asksCourierQuestion ? courierDeliverable : true;

    // Always saved now that the field is shown for every category: there is no
    // longer a state where an owner types a code and then loses sight of it.
    const barcodeToSave = formData.barcode;

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

    const savedName = formData.product_name.trim();
    const wasEditing = !!editingProductId;

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

    if (!result.success) {
      setFormError(result.message ?? 'Gagal menyimpan produk. Coba lagi.');
      return;
    }

    // Re-run the server component so the list reflects the new/edited product.
    router.refresh();

    // Stay on the product, now saved, and unlock what needs a saved row. An
    // older backend that does not return the id falls through to a plain save.
    if (intent === 'configure' && !wasEditing && result.id) {
      setEditingProductId(result.id);
      setBaseline(formSnapshot);
      showNotice(`"${savedName}" tersimpan. Sekarang atur ${extrasTitle.toLowerCase()} di bawah.`);
      requestAnimationFrame(() =>
        document
          .getElementById('pf-extras')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      );
      return;
    }

    // Bulk entry: the next product is usually the same kind, in the same
    // menu section, sold the same way — so only what identifies THIS product
    // is cleared.
    if (intent === 'new' && !wasEditing) {
      setSavedCount((c) => c + 1);
      setFormData((prev) => ({ ...EMPTY_FORM, unit: prev.unit }));
      setImageUrl('');
      setImageError(null);
      setHasDiscount(false);
      setBaseline(null);
      showNotice(`"${savedName}" tersimpan. Lanjut isi produk berikutnya.`);
      requestAnimationFrame(() => {
        pageTopRef.current?.scrollIntoView({ block: 'start' });
        nameInputRef.current?.focus({ preventScroll: true });
      });
      return;
    }

    closeForm();
    showNotice(
      wasEditing ? `Perubahan "${savedName}" tersimpan.` : `"${savedName}" ditambahkan.`,
    );
  };

  const handleToggleDiscount = (checked: boolean) => {
    setHasDiscount(checked);
    if (!checked) setFormData((prev) => ({ ...prev, price_mark_down: '' }));
  };

  // Rounded to Rp100: nobody prices a nasi goreng at Rp19.975.
  const applyDiscountPct = (pct: number) => {
    if (!sellNum) return;
    const next = Math.round((sellNum * (100 - pct)) / 100 / 100) * 100;
    setFormData((prev) => ({ ...prev, price_mark_down: String(next) }));
  };

  const handleEdit = async (product: Product) => {
    setOpeningId(product.id);
    let image = '';
    if (product.image === 'avatar.png') {
      image = '/avatar.png';
    } else {
      const result = await checkImageUrlAccessable(product.image);
      image = result?.success ? product.image : '';
    }
    setOpeningId(null);
    const opened = {
      formData: {
        product_name: product.product_name,
        price: product.price,
        price_mark_down: product.price_mark_down,
        buying_price: product.buying_price,
        description: product.description || '',
        unit: product.unit,
        lowest_price: product.lowest_price ?? '',
        highest_price: product.highest_price ?? '',
        barcode: product.barcode ?? '',
      },
      category: product.category,
      image,
      isForSale: product.is_for_sale ?? true,
      trackStock: product.track_stock ?? true,
      courierDeliverable: product.courier_deliverable ?? true,
      menuGroupId: product.menu_group_id ?? null,
      features: product.features ?? [],
      hasDiscount: !!product.price_mark_down && product.price_mark_down !== '0',
    };
    resetDraft();
    setImageUrl(opened.image);
    setHasDiscount(opened.hasDiscount);
    setSelectedFeatures(opened.features);
    setIsForSale(opened.isForSale);
    setTrackStock(opened.trackStock);
    setCourierDeliverable(opened.courierDeliverable);
    setEditingProductId(product.id);
    setSelectedCategory(opened.category);
    setSelectedMenuGroupId(opened.menuGroupId);
    setFormData(opened.formData);
    setBaseline(makeSnapshot(opened));
    setSavedCount(0);
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

  // ── Photo ─────────────────────────────────────────────────────────────────

  const handleRemoveImage = async () => {
    setImageError(null);
    if (!hasRealImage) {
      setImageUrl('');
      return;
    }
    const result = await removeImage(imageUrl);
    if (!result.success) {
      setImageError(result.message ?? 'Gagal menghapus foto.');
      return;
    }
    // A saved product still points at the file just deleted — clear that too.
    if (editingProductId) {
      const removeResult = await removeOnDatabase(imageUrl);
      if (!removeResult.success) {
        setImageError(removeResult.message ?? 'Gagal menghapus foto.');
        return;
      }
    }
    setImageUrl('');
  };

  const uploadImageFile = async (file: File) => {
    setImageError(null);
    if (!file.type.startsWith('image/')) {
      setImageError('File harus berupa gambar (JPG, PNG atau WEBP).');
      return;
    }
    if (file.size >= 5000000) {
      setImageError('Ukuran foto maksimal 5 MB.');
      return;
    }
    const body = new FormData();
    body.append('image', file);
    setUploadingImage(true);
    try {
      const result = await uploadImage(body);
      if (result.success && result.imageUrl) setImageUrl(result.imageUrl);
      else setImageError(result.message ?? 'Gagal mengunggah foto.');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Cleared so picking the same file again after an error still fires.
    e.target.value = '';
    if (file) uploadImageFile(file);
  };

  // ── Form rendering ────────────────────────────────────────────────────────
  // Plain render functions, not components, for the same reason as
  // renderMenuGroupManager: an inline component remounts its inputs.

  const busy = isSubmitting || uploadingImage;

  // Kinds on offer. Bahan/Tambahan only on plans with the stock shelves.
  const typeOptions = categoryOptions.filter(
    (c) =>
      bahanAddonsAllowed ||
      !INTERNAL_CATEGORIES.some((i) => i.category === c.category),
  );
  const isInternalOption = (category: string) =>
    INTERNAL_CATEGORIES.some((i) => i.category === category);

  const renderNotice = () =>
    notice && (
      <div
        role="status"
        className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
      >
        <CircleCheck className="h-4 w-4 shrink-0" />
        {notice.text}
      </div>
    );

  const renderTypeSection = () => {
    // Nothing picked yet: the whole choice, laid out big, with what each kind
    // means. Every field below depends on it, so nothing else shows until then.
    if (!selectedCategory) {
      const tile = (c: (typeof typeOptions)[number]) => (
        <button
          key={c.category}
          type="button"
          onClick={() => chooseCategory(c.category)}
          className="group flex flex-col items-start gap-2 rounded-2xl border-2 bg-background p-3 text-left transition-all hover:-translate-y-0.5 hover:border-blue-500 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 md:p-4"
        >
          <span className={`rounded-xl p-2 ${c.iconBg} ${c.iconColor} dark:bg-white/10`}>
            <c.icon className="h-5 w-5 md:h-6 md:w-6" />
          </span>
          <span className="text-sm font-bold group-hover:text-blue-600 md:text-base">
            {TYPE_COPY[c.category]?.short ?? c.label}
          </span>
          <span className="text-[11px] leading-snug text-muted-foreground md:text-xs">
            {TYPE_COPY[c.category]?.hint}
          </span>
        </button>
      );
      const sellable = typeOptions.filter((c) => !isInternalOption(c.category));
      const internal = typeOptions.filter((c) => isInternalOption(c.category));
      return (
        <FormSection
          step={1}
          title="Jenis produk"
          description="Pilih dulu — isian di bawahnya menyesuaikan jenisnya."
        >
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Dijual ke pelanggan
            </p>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {sellable.map(tile)}
            </div>
          </div>
          {internal.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Untuk dapur &amp; kasir
              </p>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {internal.map(tile)}
              </div>
            </div>
          )}
        </FormSection>
      );
    }

    return (
      <FormSection step={1} title="Jenis produk" description={typeCopy?.hint}>
        <div className="flex flex-wrap gap-2">
          {typeOptions.map((c) => (
            <Chip
              key={c.category}
              active={c.category === selectedCategory}
              onClick={() => chooseCategory(c.category)}
            >
              <c.icon className="h-3.5 w-3.5" />
              {TYPE_COPY[c.category]?.short ?? c.label}
            </Chip>
          ))}
          {/* Legacy/renamed category no longer offered — keep it on screen so
              an edit doesn't silently move the product. */}
          {!typeOptions.some((c) => c.category === selectedCategory) && (
            <Chip active onClick={() => {}}>
              {selectedCategory}
            </Chip>
          )}
        </div>
      </FormSection>
    );
  };

  const renderImageTile = () => (
    <div className="w-24 shrink-0 sm:w-32">
      {hasRealImage ? (
        <div className="relative aspect-square overflow-hidden rounded-2xl border">
          <Image
            src={resolveProductImage(imageUrl)}
            unoptimized={isBackendImage(imageUrl)}
            fill
            sizes="128px"
            className="object-cover"
            alt="Foto produk"
          />
          <button
            type="button"
            onClick={handleRemoveImage}
            aria-label="Hapus foto"
            title="Hapus foto"
            className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white transition-colors hover:bg-rose-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            const file = e.dataTransfer.files?.[0];
            if (file && !uploadingImage) uploadImageFile(file);
          }}
          className={`flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed p-2 text-center transition-colors ${
            dragActive
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40'
              : 'border-blue-200 bg-blue-50/40 hover:bg-blue-50 dark:border-blue-900 dark:bg-blue-950/20 dark:hover:bg-blue-950/40'
          } ${uploadingImage ? 'pointer-events-none' : ''}`}
        >
          {uploadingImage ? (
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
          ) : (
            <ImagePlus className="h-6 w-6 text-blue-600" />
          )}
          <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-400">
            {uploadingImage ? 'Mengunggah…' : 'Tambah foto'}
          </span>
          <span className="text-[10px] text-muted-foreground">maks. 5 MB</span>
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={uploadingImage}
            onChange={handleImageUpload}
          />
        </label>
      )}
    </div>
  );

  const renderDetailSections = () => {
    // Numbered in render order, so a hidden section never leaves a gap.
    let step = 1;
    const nextStep = () => ++step;
    return (
      <>
        {/* ── Info ── */}
        <FormSection step={nextStep()} title="Info produk">
          <div className="flex items-start gap-4">
            {asksImage && renderImageTile()}
            <div className="min-w-0 flex-1">
              <FieldLabel htmlFor="pf-name" required>
                Nama produk
              </FieldLabel>
              <input
                ref={nameInputRef}
                id="pf-name"
                required
                name="product_name"
                value={formData.product_name}
                onChange={handleInputChange}
                autoComplete="off"
                className={fieldClass('h-11 w-full px-3.5 text-sm')}
                placeholder={typeCopy ? `mis. ${typeCopy.example}` : 'Nama produk'}
              />
              {asksImage && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Foto boleh diseret ke kotak di samping. JPG, PNG atau WEBP.
                </p>
              )}
            </div>
          </div>
          {imageError && (
            <p className="-mt-2 text-xs font-medium text-rose-600">{imageError}</p>
          )}
          <div>
            <FieldLabel htmlFor="pf-desc" optional>
              Deskripsi
            </FieldLabel>
            <textarea
              id="pf-desc"
              name="description"
              value={formData.description}
              onChange={handleInputChange}
              rows={3}
              className={fieldClass('min-h-24 w-full resize-none px-3.5 py-2.5 text-sm')}
              placeholder={
                isInternalCategory
                  ? 'Catatan untuk dapur, mis. merek atau ukuran kemasan.'
                  : 'Isi, rasa, ukuran — yang perlu pelanggan tahu.'
              }
            />
          </div>
        </FormSection>

        {/* ── Penjualan ──
            ABOVE the prices deliberately: the two toggles together decide
            whether this product is priced with one number or a band (see
            isMaterialsProduct). Below the prices, flipping one would reshape a
            section the owner had already filled in and scrolled past. */}
        <FormSection
          step={nextStep()}
          title="Penjualan"
          description={
            isInternalCategory
              ? 'Jenis ini tidak pernah tampil di menu pelanggan.'
              : 'Tampil atau tidak di menu pelanggan, dan di bagian mana.'
          }
        >
          <ToggleCard
            question="Jual ke pelanggan ?"
            checked={isForSale}
            onToggle={() => setIsForSale((v) => !v)}
            onTitle="Dijual ke pelanggan"
            offTitle="Hanya inventaris"
            onHint="Produk tampil di menu pelanggan."
            offHint="Disembunyikan dari menu pelanggan; hanya untuk stok & faktur."
          />
          {isForSale && isInternalCategory && (
            <p className="-mt-3 text-xs text-amber-700 dark:text-amber-500">
              Kategori ini internal, jadi produknya tetap tidak muncul di menu
              pelanggan. Sakelar ini cuma membukanya untuk faktur dan laporan.
            </p>
          )}

          {/* Asked only for mart & bahan bangunan — see asksCourierQuestion. */}
          {isForSale && asksCourierQuestion && (
            <ToggleCard
              question="Apakah produk ini bisa diantar kurir?"
              checked={courierDeliverable}
              onToggle={() => setCourierDeliverable((v) => !v)}
              onTitle="Bisa diantar kurir"
              offTitle="Tidak bisa diantar kurir"
              onHint="Cukup ringan buat dibawa kurir (sembako, obat, cat, paku)."
              offHint="Barang berat/besar (besi, keramik, wastafel, kulkas) — pesanan diantar sendiri oleh outlet, tanpa kurir."
              tone="blue"
              warnWhenOff
            />
          )}

          {/* Grup Menu — not the same thing as the kind above: that is the
              fixed platform list driving marketplace browse, this is purely
              how THIS outlet's public menu is laid out. Meaningless for the
              internal kinds, which never reach that menu. */}
          {!isInternalCategory && (
            <div>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel optional>Grup menu</FieldLabel>
                <button
                  type="button"
                  onClick={() => setGroupManagerOpen((v) => !v)}
                  className="mb-1.5 text-xs font-bold text-blue-600 hover:text-blue-700"
                >
                  {groupManagerOpen ? 'Tutup' : 'Kelola grup'}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Chip
                  active={selectedMenuGroupId === null}
                  onClick={() => setSelectedMenuGroupId(null)}
                >
                  Tanpa grup
                </Chip>
                {menuGroups.map((g) => (
                  <Chip
                    key={g.id}
                    active={selectedMenuGroupId === g.id}
                    onClick={() => setSelectedMenuGroupId(g.id)}
                  >
                    {g.name}
                  </Chip>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Judul bagian di halaman menu pelanggan, mis. &quot;Nasi&quot; atau
                &quot;Minuman Dingin&quot;. Tanpa grup = ikut kategorinya.
              </p>
              {groupManagerOpen && <div className="mt-2">{renderMenuGroupManager()}</div>}
            </div>
          )}

          {isForSale && !isInternalCategory && (
            <div>
              <FieldLabel optional>Fitur produk</FieldLabel>
              <div className="flex flex-wrap gap-1.5">
                {/* Coming-soon services are left out: a greyed chip nobody
                    can press is only noise. One already on the product stays
                    so it can still be removed. */}
                {CATEGORIES.filter(
                  (f) => f.isAvailable || selectedFeatures.includes(f.id),
                ).map((f) => (
                  <Chip
                    key={f.id}
                    active={selectedFeatures.includes(f.id)}
                    onClick={() =>
                      setSelectedFeatures((prev) =>
                        prev.includes(f.id)
                          ? prev.filter((x) => x !== f.id)
                          : [...prev, f.id],
                      )
                    }
                  >
                    {f.label}
                  </Chip>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Membantu pelanggan menemukan produk ini saat menjelajah layanan.
              </p>
            </div>
          )}
        </FormSection>

        {/* ── Harga ── */}
        <FormSection
          step={nextStep()}
          title="Harga"
          description={
            asksSellingPrice
              ? undefined
              : 'Bahan tidak dijual — cukup harga belinya, untuk menghitung modal resep.'
          }
        >
          {/* Satuan first: every price below reads "per <satuan>". */}
          <div>
            <FieldLabel htmlFor="pf-unit">Satuan</FieldLabel>
            <div className="flex flex-wrap items-center gap-1.5">
              {unitSuggestions.map((u) => (
                <Chip
                  key={u}
                  active={formData.unit === u}
                  onClick={() => setFormData((prev) => ({ ...prev, unit: u }))}
                >
                  {u}
                </Chip>
              ))}
              <input
                id="pf-unit"
                name="unit"
                value={formData.unit}
                onChange={handleInputChange}
                maxLength={10}
                list="unit-suggestions"
                autoComplete="off"
                className={fieldClass('h-8 w-28 px-3 text-xs')}
                placeholder="lainnya…"
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
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Satuan hitung harga, stok &amp; resep (maks. 10 huruf).
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {usesPriceRange ? (
              <>
                <div>
                  <FieldLabel htmlFor="pf-low" required>
                    {isMaterialsProduct ? 'Harga barang' : 'Harga terendah'}
                  </FieldLabel>
                  <MoneyInput
                    id="pf-low"
                    name="lowest_price"
                    required
                    value={formData.lowest_price}
                    onChange={handleMoneyChange}
                    placeholder="50.000"
                    unit={unitLabel}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="pf-high" required>
                    {isMaterialsProduct ? 'Harga + diantar' : 'Harga tertinggi'}
                  </FieldLabel>
                  <MoneyInput
                    id="pf-high"
                    name="highest_price"
                    required
                    value={formData.highest_price}
                    onChange={handleMoneyChange}
                    placeholder="150.000"
                    unit={unitLabel}
                  />
                </div>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  {isMaterialsProduct ? (
                    <>
                      Pelanggan bayar <strong>Harga barang</strong>. Selisih ke{' '}
                      <strong>Harga + diantar</strong> jadi jatah ongkos angkut —
                      pian tetapkan angka pastinya setelah lihat alamat, dan tidak
                      boleh lebih dari selisih itu.
                    </>
                  ) : (
                    <>
                      Layanan jasa memakai rentang harga. Nanti pian pilih harga
                      pasti (di antara terendah &amp; tertinggi) saat menerima
                      order.
                    </>
                  )}
                </p>
                {rangeInvalid && (
                  <p className="text-xs font-medium text-rose-600 sm:col-span-2">
                    {isMaterialsProduct
                      ? '"Harga + diantar" tidak boleh lebih kecil dari harga barang.'
                      : 'Harga tertinggi tidak boleh lebih kecil dari harga terendah.'}
                  </p>
                )}
              </>
            ) : asksSellingPrice ? (
              <div>
                <FieldLabel htmlFor="pf-price" required>
                  Harga jual
                </FieldLabel>
                <MoneyInput
                  id="pf-price"
                  name="price"
                  required
                  value={formData.price}
                  onChange={handleMoneyChange}
                  placeholder="25.000"
                  unit={unitLabel}
                />
              </div>
            ) : null}

            <div>
              <FieldLabel
                htmlFor="pf-buy"
                optional={asksSellingPrice}
                className="text-amber-700 dark:text-amber-500"
              >
                {asksSellingPrice ? 'Harga modal' : 'Harga beli'}
              </FieldLabel>
              <MoneyInput
                id="pf-buy"
                name="buying_price"
                tone="amber"
                value={formData.buying_price}
                onChange={handleMoneyChange}
                placeholder="15.000"
                unit={unitLabel}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                {asksSellingPrice
                  ? 'Untuk menghitung untung. Tidak dilihat pelanggan.'
                  : `Harga beli per ${unitLabel}.`}
              </p>
            </div>
          </div>

          {showMargin && (
            <div
              className={`flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-sm ${
                profit > 0
                  ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : profit === 0
                    ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                    : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
              }`}
            >
              {profit >= 0 ? (
                <TrendingUp className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <TrendingDown className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span>
                {profit > 0 ? (
                  <>
                    Untung <b>{rupiah(profit)}</b> per {unitLabel} · {marginPct}% dari
                    harga {discountPct !== null ? 'setelah diskon' : 'jual'}
                  </>
                ) : profit === 0 ? (
                  'Harga jual sama dengan modal — belum ada untung.'
                ) : (
                  <>
                    Rugi <b>{rupiah(-profit)}</b> per {unitLabel} — harga jual di
                    bawah modal.
                  </>
                )}
              </span>
            </div>
          )}

          {/* Not offered for range-priced kinds: the backend mirrors
              price_mark_down to the range floor, so a discount entered there
              would be silently discarded. Nor for ingredients, for the plainer
              reason that there is no price to discount. */}
          {asksSellingPrice && !usesPriceRange && (
            <div className="space-y-3 rounded-xl border p-3.5">
              <div className="flex items-center justify-between gap-3">
                <span>
                  <span className="block text-sm font-semibold">Ada diskon?</span>
                  <span className="block text-xs text-muted-foreground">
                    Pelanggan melihat harga lama dicoret.
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={hasDiscount}
                  aria-label="Ada diskon"
                  onClick={() => handleToggleDiscount(!hasDiscount)}
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                    hasDiscount ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md transition-transform ${
                      hasDiscount ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              {hasDiscount && (
                <>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-xs text-muted-foreground">Cepat:</span>
                    {DISCOUNT_PRESETS.map((p) => (
                      <Chip
                        key={p}
                        active={discountPct === p}
                        disabled={!sellNum}
                        onClick={() => applyDiscountPct(p)}
                      >
                        {p}%
                      </Chip>
                    ))}
                  </div>
                  <div>
                    <FieldLabel htmlFor="pf-disc" required>
                      Harga setelah diskon
                    </FieldLabel>
                    <MoneyInput
                      id="pf-disc"
                      name="price_mark_down"
                      tone="emerald"
                      required
                      value={formData.price_mark_down}
                      onChange={handleMoneyChange}
                      placeholder="20.000"
                      unit={unitLabel}
                    />
                  </div>
                  {discountInvalid ? (
                    <p className="text-xs font-medium text-rose-600">
                      Harga diskon harus lebih kecil dari harga jual ({rupiah(sellNum)}).
                    </p>
                  ) : discountPct !== null ? (
                    <p className="text-xs text-emerald-700 dark:text-emerald-400">
                      Diskon {discountPct}% — dari {rupiah(sellNum)} jadi{' '}
                      {rupiah(discNum)}.
                    </p>
                  ) : !sellNum ? (
                    <p className="text-xs text-muted-foreground">
                      Isi harga jual dulu untuk memakai tombol persen.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          )}
        </FormSection>

        {/* ── Stok & kode ── */}
        <FormSection
          step={nextStep()}
          title={asksStockQuestion ? 'Stok & kode barang' : 'Kode barang'}
        >
          {asksStockQuestion && (
            <div>
              <ToggleCard
                question="Bagaimana stoknya dihitung?"
                checked={trackStock}
                onToggle={() => setTrackStock((v) => !v)}
                onTitle="Punya stok sendiri"
                offTitle="Ambil dari stok produk lain"
                onHint="Stok bertambah/berkurang lewat kasir, faktur & opname."
                offHint="Produk olahan, paket/eceran, atau jasa — stoknya dipotong dari produk lain (atau tidak dihitung sama sekali)."
              />
              {trackStock && !editingProductId && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Jumlah stok awal diisi setelah produk tersimpan — lewat faktur
                  pembelian atau stok opname.
                </p>
              )}
            </div>
          )}
          <div>
            <FieldLabel htmlFor="pf-barcode" optional>
              Barcode / kode barang
            </FieldLabel>
            <div className="relative">
              <Barcode className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="pf-barcode"
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
                autoComplete="off"
                className={fieldClass('h-11 w-full pl-10 pr-3.5 font-mono text-sm')}
                placeholder="Scan barcode atau ketik kode sendiri…"
              />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Boleh barcode pabrik, boleh kode buatan sendiri (mis. RAK-A12) untuk
              barang tanpa barcode. Harus unik per outlet, dan bisa dipakai
              mencari barang saat stok opname.
            </p>
          </div>
        </FormSection>

        {/* ── Resep · Varian · Add-on ──
            Composition: any saved product may have one, with or without stock
            of its own — a menu item or pass-through bundle expanded at sale
            time, or an in-house intermediate (sambal, adonan) produced in
            batches. Variants: which product the line IS (Reguler / Large), one
            level deep, so not on a product that is itself a variant. Add-ons:
            what can be added to the line. All three save on their own. */}
        {showsExtras && (
          <FormSection
            id="pf-extras"
            step={nextStep()}
            title={extrasTitle}
            description={
              editingProductId
                ? 'Masing-masing tersimpan sendiri — tidak ikut tombol Simpan di bawah.'
                : undefined
            }
          >
            {editingProductId ? (
              <>
                {showsRecipeEditor && (
                  <RecipeEditor
                    productId={editingProductId}
                    ingredients={recipeIngredientOptions}
                    trackStock={trackStock}
                  />
                )}
                {showsVariantEditor && (
                  <VariantEditor
                    productId={editingProductId}
                    productName={
                      formData.product_name || editingProduct?.product_name || ''
                    }
                  />
                )}
                {showsAddonEditor && (
                  <AddonEditor
                    productId={editingProductId}
                    products={recipeIngredientOptions}
                  />
                )}
              </>
            ) : (
              <div className="flex flex-col gap-3 rounded-xl border-2 border-dashed p-4 sm:flex-row sm:items-center">
                <Lock className="h-5 w-5 shrink-0 text-muted-foreground" />
                <p className="flex-1 text-sm text-muted-foreground">
                  {extrasTitle} bisa diatur setelah produk tersimpan.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => submitWithIntent('configure')}
                  className="h-10 rounded-xl"
                >
                  Simpan &amp; atur sekarang
                </Button>
              </div>
            )}
          </FormSection>
        )}
      </>
    );
  };

  const renderPreview = () => {
    if (isInternalCategory) {
      return (
        <div className="rounded-2xl border bg-muted/30 p-4">
          <p className="flex items-center gap-2 text-sm font-bold">
            <EyeOff className="h-4 w-4 text-muted-foreground" />
            Tidak tampil di menu pelanggan
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {selectedCategory === INGREDIENT_CATEGORY.category
              ? 'Bahan dipakai lewat resep dan dihitung stoknya. Pelanggan tidak pernah melihatnya.'
              : 'Muncul sebagai pilihan tambahan di kasir, pada produk yang menawarkannya. Grupnya diatur dari form produk tersebut.'}
          </p>
        </div>
      );
    }
    const groupName =
      selectedMenuGroupId != null ? groupById.get(selectedMenuGroupId)?.name : null;
    const showStrike = !usesPriceRange && discountPct !== null;
    const shownPrice = usesPriceRange ? lowNum : showStrike ? discNum : sellNum;
    const name = formData.product_name.trim();
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pratinjau di menu
          </p>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              isForSale
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400'
                : 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-400'
            }`}
          >
            {isForSale ? 'Tampil' : 'Belum tampil'}
          </span>
        </div>
        {/* Always dark: it mirrors the public /menu page, which is. */}
        <div className="rounded-2xl bg-zinc-950 p-4">
          {groupName && (
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-amber-300/80">
              {groupName}
            </p>
          )}
          <div
            className={`mx-auto w-full max-w-56 overflow-hidden rounded-2xl border border-white/10 bg-white/5 transition-opacity ${
              isForSale ? '' : 'opacity-50'
            }`}
          >
            <div className="relative aspect-4/3 w-full overflow-hidden bg-white/5">
              {hasRealImage ? (
                <Image
                  src={resolveProductImage(imageUrl)}
                  unoptimized={isBackendImage(imageUrl)}
                  fill
                  sizes="224px"
                  className="object-cover"
                  alt=""
                />
              ) : (
                <div className="flex h-full items-center justify-center text-white/20">
                  <ImageIcon className="h-8 w-8" />
                </div>
              )}
              <div className="absolute inset-0 bg-linear-to-t from-black/70 via-black/5 to-transparent" />
              {showStrike && (
                <span className="absolute left-2 top-2 rounded-full bg-rose-500/90 px-2 py-0.5 text-[10px] font-black text-white">
                  -{discountPct}%
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1 p-3">
              <p
                className={`line-clamp-2 text-sm font-bold leading-snug ${
                  name ? 'text-white' : 'italic text-white/30'
                }`}
              >
                {name || 'Nama produk'}
              </p>
              {formData.description.trim() && (
                <p className="line-clamp-2 text-[11px] leading-relaxed text-white/45">
                  {formData.description}
                </p>
              )}
              <div className="pt-1">
                {usesPriceRange && (
                  <span className="block text-[10px] font-bold leading-none text-white/45">
                    mulai
                  </span>
                )}
                <span className="block text-[15px] font-black text-white">
                  {rupiah(shownPrice)}
                </span>
                {showStrike && (
                  <span className="block text-[11px] leading-none text-white/35 line-through">
                    {rupiah(sellNum)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
        {!isForSale && (
          <p className="text-xs text-muted-foreground">
            Nyalakan <b>Jual ke pelanggan online</b> di bagian Penjualan supaya
            produk ini muncul di menu.
          </p>
        )}
      </div>
    );
  };

  const renderChecklist = () => {
    const items: { label: string; done: boolean; optional?: boolean }[] = [
      { label: 'Jenis produk', done: !!selectedCategory },
      { label: 'Nama produk', done: !!formData.product_name.trim() },
    ];
    if (usesPriceRange) {
      items.push({
        label: isMaterialsProduct ? 'Harga barang & antar' : 'Rentang harga',
        done: lowNum > 0 && highNum > 0 && !rangeInvalid,
      });
    } else if (asksSellingPrice) {
      items.push({ label: 'Harga jual', done: sellNum > 0 });
    }
    if (asksImage) items.push({ label: 'Foto', done: hasRealImage, optional: true });
    items.push({
      label: asksSellingPrice ? 'Harga modal' : 'Harga beli',
      done: buyNum > 0,
      optional: true,
    });
    return (
      <div className="hidden rounded-2xl border bg-background p-4 lg:block">
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Kelengkapan
        </p>
        <ul className="space-y-1.5">
          {items.map((it) => (
            <li key={it.label} className="flex items-center gap-2 text-sm">
              {it.done ? (
                <CircleCheck className="h-4 w-4 shrink-0 text-emerald-600" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-muted-foreground/50" />
              )}
              <span className={it.done ? '' : 'text-muted-foreground'}>{it.label}</span>
              {it.optional && (
                <span className="text-[11px] text-muted-foreground">(opsional)</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  };

  // Sticky at the bottom of the viewport the whole way down a long form: on a
  // phone the old button sat below the image uploader, several screens away
  // from the price the owner had just typed.
  const renderSaveBar = () => (
    <div className="sticky bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-20 mt-5 rounded-2xl border bg-background/95 p-3 shadow-xl backdrop-blur">
      {formError && (
        <p
          role="alert"
          className="mb-2.5 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {formError}
        </p>
      )}
      <div className="flex items-center gap-2">
        <p className="mr-auto hidden text-xs text-muted-foreground sm:block">
          {uploadingImage
            ? 'Menunggu foto selesai diunggah…'
            : isDirty
              ? 'Ada perubahan yang belum disimpan.'
              : editingProductId
                ? 'Belum ada perubahan.'
                : savedCount > 0
                  ? `${savedCount} produk ditambahkan.`
                  : ''}
        </p>
        {!editingProductId && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => submitWithIntent('new')}
            className="h-11 flex-1 rounded-xl px-3 text-[13px] sm:flex-none sm:px-4 sm:text-sm"
          >
            Simpan &amp; Tambah Lagi
          </Button>
        )}
        <Button
          type="submit"
          disabled={busy}
          className="h-11 flex-1 rounded-xl bg-blue-600 px-6 font-bold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 sm:flex-none"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Menyimpan…
            </>
          ) : editingProductId ? (
            'Simpan Perubahan'
          ) : (
            'Simpan'
          )}
        </Button>
      </div>
    </div>
  );
  return (
    <div ref={pageTopRef} className="mt-4 scroll-mt-16 space-y-6">
      {view === 'list' && (
        <>
          {renderNotice()}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4 md:mb-6">
            <div>
              <h2 className="text-xl md:text-3xl font-extrabold tracking-tight text-foreground">
                Manajemen Produk
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
                onClick={() => openNewForm()}
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
                onClick={() => openNewForm()}
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
                {TABLE_TABS.filter(
                  (t) => t.id === 'produk' || bahanAddonsAllowed,
                ).map((t) => {
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
                    onClick={() =>
                      openNewForm(
                        tab === 'bahan'
                          ? INGREDIENT_CATEGORY.category
                          : tab === 'tambahan'
                            ? ADDON_CATEGORY.category
                            : '',
                      )
                    }
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
                                    tree. A product with no recipe still gets
                                    it — the empty state points at the recipe
                                    form rather than a dead end — but a bahan
                                    with no recipe is bought, never made, so
                                    there is nothing for it to open; its page
                                    is Jelajah Barang Jadi below. An add-on is
                                    left out until the explorers learn how one
                                    hangs off a dish. */}
                                {(gate?.features?.recipeExplorer as boolean) &&
                                  kindOf(product.category) !== 'tambahan' &&
                                  !(kindOf(product.category) === 'bahan' && !product.has_recipe) && (
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
                                {/* Jelajah Barang Jadi: the reverse — what
                                    this becomes, product by product. Every
                                    bahan (it is also where a bahan's cost is
                                    set), and a product only when another one
                                    is made from it (a Paket Hemat). Never an
                                    add-on: it cannot be an ingredient. */}
                                {(gate?.features?.recipeExplorer as boolean) &&
                                  (kindOf(product.category) === 'bahan' ||
                                    (kindOf(product.category) === 'produk' && product.is_ingredient)) && (
                                  <button
                                    onClick={() =>
                                      router.push(
                                        `/dashboard/addproducts/finished-goods/${product.id}?name=${encodeURIComponent(product.product_name)}`,
                                      )
                                    }
                                    className="p-1.5 rounded-lg bg-muted/60 text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
                                    aria-label="Jelajah barang jadi"
                                    title="Jelajah barang jadi"
                                  >
                                    <Sprout className="h-4 w-4" />
                                  </button>
                                )}
                                <button
                                  onClick={() => handleEdit(product)}
                                  disabled={openingId !== null}
                                  className="p-1.5 rounded-lg bg-muted/60 text-muted-foreground hover:text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-60"
                                  aria-label="Edit produk"
                                >
                                  {openingId === product.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Edit className="h-4 w-4" />
                                  )}
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

      {view === 'form' && (
        <div className="mx-auto max-w-6xl">
          <Button
            type="button"
            variant="ghost"
            onClick={handleBack}
            className="mb-3 -ml-3 rounded-xl text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Daftar Produk
          </Button>

          <div className="mb-5">
            <h2 className="text-xl font-extrabold tracking-tight text-foreground md:text-3xl">
              {editingProductId ? 'Edit Produk' : 'Tambah Produk'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {editingProductId ? (
                <>
                  Perubahan berlaku setelah pian tekan <b>Simpan</b>.
                  {editingProduct?.variant_of && (
                    <>
                      {' '}Produk ini varian dari{' '}
                      <b>
                        {productNameById.get(editingProduct.variant_of) ?? 'produk lain'}
                      </b>
                      .
                    </>
                  )}
                </>
              ) : (
                'Yang bertanda * wajib diisi. Sisanya boleh dilengkapi nanti.'
              )}
            </p>
          </div>

          {notice && <div className="mb-5">{renderNotice()}</div>}

          {/* The save bar sits OUTSIDE the grid on purpose: a sticky grid item
              is pinned only within its own row, which for a bar in a row of
              its own means not at all. */}
          {/* Scroll margins keep a focused field clear of the sticky header
              above and the sticky save bar below — on a phone, tapping
              "Harga modal" otherwise scrolled it to sit right under the bar. */}
          <form
            ref={formRef}
            onSubmit={handleSubmit}
            className="[&_input]:scroll-mb-28 [&_input]:scroll-mt-16 [&_textarea]:scroll-mb-28 [&_textarea]:scroll-mt-16"
          >
            <div
              className={`grid items-start gap-5 ${
                selectedCategory ? 'lg:grid-cols-[minmax(0,1fr)_300px]' : ''
              }`}
            >
              <div className="min-w-0 space-y-5">
                {renderTypeSection()}
                {selectedCategory && renderDetailSections()}
              </div>

              {selectedCategory && (
                <aside className="space-y-4 lg:sticky lg:top-14">
                  {renderPreview()}
                  {renderChecklist()}
                </aside>
              )}
            </div>

            {selectedCategory && renderSaveBar()}
          </form>
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
