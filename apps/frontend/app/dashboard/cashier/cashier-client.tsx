'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  ReceiptModal,
  type ReceiptData,
} from '@/components/dashboard/receipt-modal';
import Image from 'next/image';
import {
  Search,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  CreditCard,
  Coffee,
  Pizza,
  Cookie,
  Package,
  LayoutGrid,
  X,
  ChevronDown,
  Layers,
  Barcode,
  StickyNote,
  Bell,
  Printer,
  ChefHat,
  Tag,
  Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/utils/format';
import {
  openLabelApp,
  openOrderLabelApp,
  buildOrderLabelBatch,
  type LabelBatchJob,
  type ProductLabel,
  type OrderLabel,
} from '@/lib/labelbridge';
import { API_URL } from '@/lib/api-url';
import { POS_PAYMENT_OPTIONS, type PosPaymentMethod } from '@/lib/pos-payment';
import { ShiftBar } from './shift-bar';
import { LabelPreviewModal } from './label-preview-modal';
import { OptionPickerModal, priceOf } from './option-picker-modal';
import { computeTax, taxLineLabel, type TaxConfig } from '@/lib/tax';
import { resolveProductImage, isBackendImage } from '@/lib/image-src';

export type Product = {
  id: string;
  product_name: string;
  price: string;
  price_mark_down: string;
  category: string;
  image: string;
  isAvailable: boolean;
  description: string | null;
  unit: string;
  barcode?: string | null;
  // Owner's menu section, preferred over `category` for the POS tabs — the same
  // arrangement customers see. Null when the product isn't in a section.
  menu_group?: string | null;
  menu_group_order?: number | null;
  /** Add-on questions this product asks ("Topping", "Level Pedas"). */
  addon_groups?: AddonGroup[];
  /**
   * Variants (migration 0071). A variant is a PRODUCT, not a modifier: this
   * row is one when variant_of is set, and the cart line it produces is this
   * row — its own price, its own stock, its own cost.
   *
   * Which is why there is no `variants` array here. The cashier already holds
   * the whole catalogue, variants included, so the base's options are a group-by
   * over rows it has rather than a second copy of them riding along on each
   * product. See variantsByBase below.
   */
  variant_of?: string | null;
  /** Short label among its siblings: "Reguler", "Large". */
  variant_name?: string | null;
  /** On a base: the question its picker asks ("Ukuran"). */
  variant_label?: string | null;
  variant_sort?: number;
};

export type AddonOption = {
  id: number;
  product_id: string;
  name: string;
  price: number;
  available: boolean;
};

export type AddonGroup = {
  id: number;
  name: string;
  /** >= 1 means the cashier must pick something ("wajib pilih"). */
  min_select: number;
  /** null = unlimited. */
  max_select: number | null;
  options: AddonOption[];
};

/** One add-on chosen for a cart line. */
export type CartAddon = {
  product_id: string;
  option_id: number;
  name: string;
  /** Per ONE unit of the parent line. The server multiplies by the line qty. */
  quantity: number;
  price: number;
};

type CartItem = {
  /**
   * Identity of this LINE, not of the product.
   *
   * Two Nasi Goreng with different toppings are two different lines, so the
   * cart can no longer be keyed on product.id the way it was — every handler
   * below (quantity, note, remove) addresses a line by this instead.
   *
   * Held tabs parked before add-ons existed have no lineId; hydration backfills
   * one, the same way it already backfills pagerNumber and orderNote.
   */
  lineId: string;
  product: Product;
  quantity: number;
  /**
   * Kitchen instruction for this line ("jangan pedas", "es sedikit"). Lives in
   * the held tab only — it's prep guidance for the next ten minutes, printed on
   * the kitchen ticket and then gone. Never sent to the backend.
   */
  note?: string;
  /**
   * Add-ons chosen for this line. Unlike the note, these DO reach the backend:
   * each becomes a child order line with its own price, stock and cost.
   */
  addons?: CartAddon[];
};

/**
 * What makes two cart lines "the same thing" for merging.
 *
 * Product alone is no longer enough: a nasi goreng with telur and one without
 * are different orders to the kitchen and different money. Sorted so the same
 * add-ons chosen in a different order still collapse onto one line.
 */
const lineSignature = (productId: string, addons: CartAddon[] | undefined) =>
  [
    productId,
    ...(addons ?? [])
      .map((a) => `${a.product_id}:${a.quantity}:${a.price}`)
      .sort(),
  ].join('|');

/** Per-unit price of a line, add-ons included. */
const unitPriceOf = (item: CartItem) => {
  const base =
    item.product.price_mark_down && item.product.price_mark_down !== '0'
      ? parseFloat(item.product.price_mark_down)
      : parseFloat(item.product.price);
  const addons = (item.addons ?? []).reduce(
    (sum, a) => sum + a.price * a.quantity,
    0,
  );
  return base + addons;
};

// A parked/held order kept in localStorage so a cashier can juggle several open
// carts (e.g. one per table) and check out later without losing anything.
type HeldTab = {
  id: string;
  label: string;
  cart: CartItem[];
  customerName: string;
  /**
   * Number marker-written on the buzzer handed to the customer. It's a handle
   * on a physical device, not a location: the same number comes back around all
   * day as pagers are returned, so it's per-tab and dies with the tab.
   */
  pagerNumber: string;
  /** Whole-order kitchen instruction. Device-local, same as the item notes. */
  orderNote: string;
  discountType: 'percentage' | 'amount';
  discountInput: string;
  paymentMethod: PosPaymentMethod;
  amountPaidInput: string;
};

const newHeldTab = (label: string): HeldTab => ({
  id: crypto.randomUUID(),
  label,
  cart: [],
  customerName: '',
  pagerNumber: '',
  orderNote: '',
  discountType: 'percentage',
  discountInput: '',
  paymentMethod: 'cash',
  amountPaidInput: '0',
});

type CashierClientProps = {
  outletId: number;
  outletName: string;
  outletAddress: string;
  outletPhone: string;
  outletLogo: string;
  cashierName: string;
  /**
   * Plan entitlements, resolved server-side on the page so the counter never
   * flashes a control the merchant can't use. Both are re-checked where they
   * matter: opening a shift is enforced by the backend, while the pager is
   * purely device-local (it never reaches the server), so this IS its only
   * boundary — which is the honest extent of what a UI-only feature can have.
   */
  canUseShift: boolean;
  canUsePager: boolean;
  /**
   * The outlet's counter tax, already resolved against the plan gate on the
   * server (disabled below Max Lite). Used for DISPLAY only — the server
   * recomputes the stored figure from its own copy of these settings.
   */
  taxConfig: TaxConfig;
  initialProducts: Product[];
};

// Ceiling on a hand-typed quantity: four digits is far past any real counter
// sale, and it keeps a fat-fingered paste from turning the order total into
// nonsense. The +/- buttons are unbounded as before.
const MAX_QUANTITY = 9999;

// Categories that exist only inside the dashboard, mirroring INTERNAL_CATEGORIES
// on the backend. Nothing filed under one is sellable at the counter: "bahan" is
// recipe material, "tambahan" is an add-on option that reaches an order as a
// child line through the picker. is_for_sale already keeps both out of the
// catalogue, but the tabs are built from category, so this is what stops an
// outlet growing a "tambahan" shelf full of toppings nobody can ring up.
const INTERNAL_CATEGORIES = new Set(['bahan', 'tambahan']);

const INITIAL_CATEGORIES = [
  {
    id: 'All',
    label: 'All Items',
    icon: LayoutGrid,
    color: 'text-blue-500 m-2',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
  },
];

export const CashierClient = ({
  outletId,
  outletName,
  outletAddress,
  outletPhone,
  outletLogo,
  cashierName,
  canUseShift,
  canUsePager,
  taxConfig,
  initialProducts,
}: CashierClientProps) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  // Dedicated barcode field — separate from the name search above, since a
  // scanner (or a cashier typing a code) means "find this EXACT item", not
  // "filter the grid". Enter/scan looks it up and adds it straight to cart.
  const [barcodeQuery, setBarcodeQuery] = useState('');
  const [barcodeFeedback, setBarcodeFeedback] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  // Two refs, not one: the mobile and desktop barcode inputs below are both
  // mounted at once (toggled by CSS breakpoint classes, not conditional
  // rendering) — a single ref would only ever point at whichever renders
  // last in JSX order.
  const barcodeInputMobileRef = useRef<HTMLInputElement>(null);
  const barcodeInputDesktopRef = useRef<HTMLInputElement>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);

  // ── Live catalogue ────────────────────────────────────────────────────────
  //
  // initialProducts is a server-rendered snapshot, and the POS is a tab that
  // stays open all day. Before this it was never refetched: a cashier who
  // opened the counter at 08:00 kept selling 08:00 prices, and an item marked
  // habis at 10:00 stayed on sale until someone reloaded the page.
  //
  // So the catalogue is state, refreshed whenever the tab is looked at again —
  // cashiers alt-tab constantly, which makes focus a better signal than any
  // interval. This is also the seam a server-sent-events stream would plug
  // into later: something else calls setCatalogue, and everything below is
  // already written against it.
  //
  // IT NEVER TOUCHES A CART. See staleLines below for why.
  const [catalogue, setCatalogue] = useState<Product[]>(initialProducts);
  const catalogueById = useMemo(
    () => new Map(catalogue.map((p) => [p.id, p])),
    [catalogue],
  );

  /**
   * Base product id -> its variants, in menu order.
   *
   * Grouped from the catalogue the cashier already holds rather than fetched:
   * a variant IS a product row, so it arrives with everything else and asking
   * the server for it again would be asking for rows already in memory.
   *
   * Archived variants never appear here because the catalogue endpoint filters
   * deletedAt — which is correct, because this drives COMPOSITION. A held tab
   * that already contains an archived variant still settles: by then the
   * variant is just the product on the line, and nothing in checkout consults
   * this map. Same split add-ons make between the picker and resolveAddons.
   */
  const variantsByBase = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of catalogue) {
      if (!p.variant_of) continue;
      const siblings = map.get(p.variant_of);
      if (siblings) siblings.push(p);
      else map.set(p.variant_of, [p]);
    }
    for (const siblings of map.values()) {
      siblings.sort(
        (a, b) =>
          (a.variant_sort ?? 0) - (b.variant_sort ?? 0) ||
          a.product_name.localeCompare(b.product_name, 'id'),
      );
    }
    return map;
  }, [catalogue]);

  /**
   * The options a base offers, base first.
   *
   * The base leads because it is the default — the thing the owner priced when
   * they created the product, and the one the cashier means when they don't
   * think about size. Empty for a product with no variants, which is what lets
   * the picker skip the question entirely rather than asking one with a single
   * answer.
   */
  const variantOptionsOf = useCallback(
    (base: Product): Product[] => {
      const siblings = variantsByBase.get(base.id);
      return siblings && siblings.length > 0 ? [base, ...siblings] : [];
    },
    [variantsByBase],
  );

  /**
   * Is there anything here the cashier can actually sell?
   *
   * A base marked habis whose Large is still in the fridge must stay tappable,
   * or the sale that IS possible becomes unreachable. The picker then greys out
   * the sold-out options individually.
   */
  const sellable = useCallback(
    (base: Product) =>
      base.isAvailable ||
      (variantsByBase.get(base.id) ?? []).some((v) => v.isAvailable),
    [variantsByBase],
  );

  const refreshCatalogue = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/products/mine`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data?.products)) return;
      // Same filter the server component applies: inventory-only items are not
      // sellable at the counter and must not spawn their own category tabs.
      setCatalogue(
        data.products.filter(
          (p: { is_for_sale?: boolean }) => p.is_for_sale !== false,
        ),
      );
    } catch {
      // A failed refresh leaves the previous catalogue in place. Being one
      // edit behind is a great deal better than a counter that can't sell.
    }
  }, []);

  useEffect(() => {
    const onFocus = () => refreshCatalogue();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshCatalogue();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshCatalogue]);
  // One modal serves both slips; `variant` picks the customer receipt or the
  // money-free kitchen ticket.
  const [receipt, setReceipt] = useState<{
    data: ReceiptData;
    variant: 'customer' | 'kitchen';
    heading: string;
  } | null>(null);
  const [discountType, setDiscountType] = useState<'percentage' | 'amount'>(
    'percentage',
  );
  const [discountInput, setDiscountInput] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [pagerNumber, setPagerNumber] = useState('');
  const [orderNote, setOrderNote] = useState('');
  // Which note is being edited, if any: a cart line or the whole order. The
  // draft is held apart from the cart so cancelling leaves nothing behind.
  const [noteTarget, setNoteTarget] = useState<
    { kind: 'item'; id: string; name: string } | { kind: 'order' } | null
  >(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [amountPaidInput, setAmountPaidInput] = useState('0');
  const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>('cash');
  // Bumped after every checkout so the shift strip's running drawer total picks
  // up the sale that was just rung up.
  const [shiftRefresh, setShiftRefresh] = useState(0);
  // Blocks duplicate checkouts: ref guards synchronously against re-entry (rapid
  // clicks / Cmd+Enter key-repeat), state drives the disabled button UI.
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);

  // Lazy mode: a per-device cashier preference (localStorage, never the DB).
  // When on, cash received is assumed to exactly equal the amount due (uang
  // pas): the cashier skips typing it and no change is calculated.
  const lazyKey = `pos_lazy_${outletId}`;
  const [lazyMode, setLazyMode] = useState(false);
  useEffect(() => {
    try {
      setLazyMode(localStorage.getItem(lazyKey) === '1');
    } catch {
      /* ignore */
    }
  }, [lazyKey]);
  // Lazy mode IS a cash sale — uang pas, nothing tendered, no change counted —
  // so the two can never disagree. Held tabs restore their own saved payment
  // method and lazyMode is a per-DEVICE preference, so a tab parked on QRIS can
  // come back while lazy mode is on; that state has no meaning, and it would
  // also hide the cash row that carries the only way to switch lazy mode off.
  // Snapping to cash keeps the lock honest wherever the mismatch came from.
  useEffect(() => {
    if (lazyMode && paymentMethod !== 'cash') setPaymentMethod('cash');
  }, [lazyMode, paymentMethod]);

  const toggleLazyMode = () => {
    setLazyMode((v) => {
      const next = !v;
      try {
        localStorage.setItem(lazyKey, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // ── Held tabs: multiple parked carts persisted to localStorage (this device) ──
  const tabsKey = `pos_tabs_${outletId}`;
  const [tabs, setTabs] = useState<HeldTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const [hydrated, setHydrated] = useState(false);
  const [tabsMenuOpen, setTabsMenuOpen] = useState(false);
  // Refs mirror the latest values so tab actions never close over stale state.
  const tabsRef = useRef<HeldTab[]>([]);
  const activeIdRef = useRef<string>('');
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  useEffect(() => {
    activeIdRef.current = activeTabId;
  }, [activeTabId]);

  const persistTabs = useCallback(
    (next: HeldTab[], activeId: string) => {
      try {
        localStorage.setItem(tabsKey, JSON.stringify({ tabs: next, activeId }));
      } catch {
        /* ignore quota / serialization errors */
      }
    },
    [tabsKey],
  );

  // Load a tab's saved data into the live editing state.
  const applyTab = useCallback((t: HeldTab) => {
    setCart(t.cart);
    setCustomerName(t.customerName);
    setPagerNumber(t.pagerNumber);
    setOrderNote(t.orderNote);
    setDiscountType(t.discountType);
    setDiscountInput(t.discountInput);
    setPaymentMethod(t.paymentMethod);
    setAmountPaidInput(t.amountPaidInput);
  }, []);

  // Hydrate from localStorage once, client-side (avoids SSR hydration mismatch).
  useEffect(() => {
    let loaded: HeldTab[] = [];
    let activeId = '';
    try {
      const raw = localStorage.getItem(tabsKey);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed?.tabs)) {
        // Tabs parked before pager/notes existed are missing those keys; fill
        // them in so the inputs below never go uncontrolled.
        loaded = parsed.tabs.map((t: HeldTab) => ({
          ...t,
          pagerNumber: t.pagerNumber ?? '',
          orderNote: t.orderNote ?? '',
          // Tabs parked before add-ons existed have no lineId, and every cart
          // handler now addresses lines by it. Minted here rather than left
          // undefined, or the first tap on such a tab would edit every line at
          // once (they would all match `undefined`).
          cart: (t.cart ?? []).map((item) => ({
            ...item,
            lineId: item.lineId ?? crypto.randomUUID(),
            addons: item.addons ?? [],
          })),
        }));
        activeId = parsed.activeId ?? '';
      }
    } catch {
      /* ignore */
    }
    if (loaded.length === 0) loaded = [newHeldTab('Pesanan 1')];
    const active = loaded.find((t) => t.id === activeId) ?? loaded[0];
    setTabs(loaded);
    setActiveTabId(active.id);
    applyTab(active);
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the active tab synced with the live editing state, and persist.
  useEffect(() => {
    if (!hydrated) return;
    const id = activeIdRef.current;
    if (!id) return;
    const next = tabsRef.current.map((t) =>
      t.id === id
        ? {
            ...t,
            cart,
            customerName,
            pagerNumber,
            orderNote,
            discountType,
            discountInput,
            paymentMethod,
            amountPaidInput,
          }
        : t,
    );
    setTabs(next);
    persistTabs(next, id);
  }, [
    cart,
    customerName,
    pagerNumber,
    orderNote,
    discountType,
    discountInput,
    paymentMethod,
    amountPaidInput,
    hydrated,
    persistTabs,
  ]);

  const switchTab = useCallback(
    (id: string) => {
      if (id === activeIdRef.current) return;
      const target = tabsRef.current.find((t) => t.id === id);
      if (!target) return;
      setActiveTabId(id);
      applyTab(target);
      persistTabs(tabsRef.current, id);
    },
    [applyTab, persistTabs],
  );

  const addTab = useCallback(() => {
    const t = newHeldTab(`Pesanan ${tabsRef.current.length + 1}`);
    const next = [...tabsRef.current, t];
    setTabs(next);
    setActiveTabId(t.id);
    applyTab(t);
    persistTabs(next, t.id);
  }, [applyTab, persistTabs]);

  const closeTab = useCallback(
    (id: string) => {
      const t = tabsRef.current.find((x) => x.id === id);
      const count = t ? t.cart.reduce((acc, i) => acc + i.quantity, 0) : 0;
      if (
        count > 0 &&
        !window.confirm(
          'Tutup tab ini? Keranjang yang belum dibayar akan hilang.',
        )
      )
        return;
      const remaining = tabsRef.current.filter((x) => x.id !== id);
      const next = remaining.length ? remaining : [newHeldTab('Pesanan 1')];
      setTabs(next);
      if (id === activeIdRef.current || !remaining.length) {
        const target = next[0];
        setActiveTabId(target.id);
        applyTab(target);
        persistTabs(next, target.id);
      } else {
        persistTabs(next, activeIdRef.current);
      }
    },
    [applyTab, persistTabs],
  );

  // ── Reconciling carts against the live catalogue ──────────────────────────
  //
  // A cart line holds a SNAPSHOT of the product it was added from, and held
  // tabs live in localStorage for days. So a fresh catalogue does not fix a
  // stale cart, and it must not try to: silently re-pricing a line while the
  // customer is counting out cash, after the cashier has already read the total
  // aloud, is worse than the stale price it replaces.
  //
  // So staleness is DERIVED and shown, never applied. Nothing below mutates a
  // cart; the cashier decides, and repriceStaleLines is the only thing that
  // writes. Availability is deliberately NOT auto-removed either — an item that
  // went habis is still in front of the customer.

  type LineStale = {
    tabId: string;
    lineId: string;
    name: string;
    /** null when the product has been archived out of the catalogue. */
    fresh: Product | null;
    oldPrice: number;
    newPrice: number | null;
    unavailable: boolean;
  };

  const staleLines = useMemo(() => {
    const priceOf = (p: Pick<Product, 'price' | 'price_mark_down'>) =>
      p.price_mark_down && p.price_mark_down !== '0'
        ? parseFloat(p.price_mark_down)
        : parseFloat(p.price);

    const out: LineStale[] = [];
    for (const t of tabs) {
      for (const item of t.cart) {
        const fresh = catalogueById.get(item.product.id) ?? null;
        const oldPrice = priceOf(item.product);
        // Archived out of the catalogue: flagged, never auto-removed. The
        // backend settles it from the payload regardless (lib/addons.ts), so
        // this is information, not an obstacle.
        if (!fresh) {
          out.push({
            tabId: t.id,
            lineId: item.lineId,
            name: item.product.product_name,
            fresh: null,
            oldPrice,
            newPrice: null,
            unavailable: true,
          });
          continue;
        }
        const newPrice = priceOf(fresh);
        const unavailable = fresh.isAvailable === false;
        if (newPrice !== oldPrice || unavailable) {
          out.push({
            tabId: t.id,
            lineId: item.lineId,
            name: item.product.product_name,
            fresh,
            oldPrice,
            newPrice,
            unavailable,
          });
        }
      }
    }
    return out;
  }, [tabs, catalogueById]);

  const staleByLineId = useMemo(
    () => new Map(staleLines.map((x) => [x.lineId, x])),
    [staleLines],
  );
  // Which OTHER tabs are affected, so a cashier on tab 1 can see that tab 3 has
  // a problem without opening it.
  const staleTabIds = useMemo(
    () => new Set(staleLines.map((x) => x.tabId)),
    [staleLines],
  );

  /**
   * Accept the new prices — across EVERY tab, not just the active one.
   *
   * The sync effect that persists the cart only ever rewrites the ACTIVE tab
   * (`t.id === id ? {...} : t`), so a held tab has to be updated here directly.
   * That is also where the trap is: the effect rebuilds from `tabsRef.current`,
   * which its own effect refreshes a render later. Calling setTabs and setCart
   * together would let the cart effect fire against the pre-update ref and
   * silently throw the held-tab edits away.
   *
   * Assigning the ref synchronously, before the state updates are queued, is
   * what closes that window.
   */
  const repriceStaleLines = useCallback(() => {
    const refresh = (items: CartItem[]) =>
      items.map((item) => {
        const fresh = catalogueById.get(item.product.id);
        // An archived product keeps its snapshot: there is nothing fresher to
        // swap in, and dropping the line would delete a sale in progress.
        return fresh ? { ...item, product: fresh } : item;
      });

    const next = tabsRef.current.map((t) => ({ ...t, cart: refresh(t.cart) }));
    tabsRef.current = next;
    setTabs(next);
    persistTabs(next, activeIdRef.current);
    // The live editing state is a copy of the active tab's cart, so it has to
    // be refreshed too or the screen would keep showing the old prices.
    setCart((prev) => refresh(prev));
  }, [catalogueById, persistTabs]);

  // After a paid checkout, drop the tab and move to the next (or a fresh one).
  const completeActiveTab = useCallback(() => {
    const remaining = tabsRef.current.filter(
      (t) => t.id !== activeIdRef.current,
    );
    const next = remaining.length ? remaining : [newHeldTab('Pesanan 1')];
    const target = next[0];
    setTabs(next);
    setActiveTabId(target.id);
    applyTab(target);
    persistTabs(next, target.id);
  }, [applyTab, persistTabs]);

  // Tabs come straight from the products the cashier already has, and prefer
  // the owner's own menu sections over the raw platform category — same
  // arrangement the customer sees on /dashboard/order, so staff and customers
  // are talking about the same shelves. Ungrouped products fall back to
  // `category`, so an outlet that never touched Grup Menu is unaffected.
  //
  // The internal categories get no tab regardless of grouping: raw ingredients
  // are stock material and add-on options are sold as child lines through the
  // picker, so neither is ever rung up on its own here.
  const categories = useMemo(() => {
    const groups = new Map<string, number>(); // section name -> sort_order
    const loose = new Set<string>();

    for (const p of catalogue) {
      if (INTERNAL_CATEGORIES.has(p.category)) continue;
      if (p.menu_group) groups.set(p.menu_group, p.menu_group_order ?? 0);
      else if (p.category) loose.add(p.category);
    }

    const ordered = [
      ...[...groups.entries()]
        .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0], 'id'))
        .map(([name]) => name),
      ...[...loose].sort((a, b) => a.localeCompare(b, 'id')),
    ];

    return [
      ...INITIAL_CATEGORIES,
      ...ordered.map((label) => ({
        id: label,
        label,
        icon: LayoutGrid,
        color: 'text-black-500 m-2',
        bg: 'bg-green-50',
        border: 'border-green-200',
      })),
    ];
  }, [catalogue]);

  // What a product files under in the tabs above — its section if it has one.
  const tabKeyOf = (p: Product) => p.menu_group ?? p.category;

  const filteredProducts = useMemo(() => {
    const needle = searchQuery.toLowerCase();
    return catalogue.filter((product) => {
      // Internal products never appear at the POS (no tab either — see the
      // categories memo): ingredients are consumed via recipes, and an add-on
      // is added to a dish through the picker, never rung up beside it.
      // Matched on the same key the tabs are built from, or selecting a section
      // like "Besi" would compare against a value no product carries.
      const internal = INTERNAL_CATEGORIES.has(product.category);
      // A variant gets no tile of its own — it is reached by tapping its base
      // and answering the question. Two tiles for one drink is the duplication
      // this feature exists to remove; the grid shows bases, the picker shows
      // sizes. (The catalogue still holds them: a barcode scan finds a variant
      // directly, and the cart resolves lines through catalogueById.)
      if (product.variant_of) return false;
      const matchesCategory =
        selectedCategory === 'All'
          ? !internal
          : !internal && tabKeyOf(product) === selectedCategory;
      // Typing "large" must find the drink that HAS a Large, even though the
      // Large itself has no tile to land on.
      const matchesSearch =
        product.product_name.toLowerCase().includes(needle) ||
        (variantsByBase.get(product.id) ?? []).some(
          (v) =>
            v.product_name.toLowerCase().includes(needle) ||
            (v.variant_name ?? '').toLowerCase().includes(needle),
        );
      return matchesCategory && matchesSearch;
    });
  }, [catalogue, selectedCategory, searchQuery, variantsByBase]);

  // Cart operations
  const addToCart = (product: Product, addons?: CartAddon[]) => {
    if (!product.isAvailable) return;

    const signature = lineSignature(product.id, addons);
    setCart((prev) => {
      // Same product AND the same add-ons collapses onto one line; the same
      // product with different toppings is a separate line, because it is a
      // separate thing to cook and a separate price.
      const existing = prev.find(
        (item) => lineSignature(item.product.id, item.addons) === signature,
      );
      if (existing) {
        return prev.map((item) =>
          item.lineId === existing.lineId
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      }
      return [
        ...prev,
        { lineId: crypto.randomUUID(), product, quantity: 1, addons },
      ];
    });
  };

  /**
   * Tapping a product opens the picker when it asks any question — which size,
   * which toppings — and drops it straight in the cart when it asks none. The
   * common case must stay one tap.
   */
  const selectProduct = (product: Product) => {
    if (!sellable(product)) return;
    const groups = product.addon_groups ?? [];
    if (variantOptionsOf(product).length > 0 || groups.length > 0) {
      setPickerTarget(product);
      return;
    }
    addToCart(product);
  };

  const handleBarcodeScan = (
    source: React.RefObject<HTMLInputElement | null>,
  ) => {
    const code = barcodeQuery.trim();
    if (!code) return;

    const match = catalogue.find((p) => p.barcode && p.barcode === code);
    if (!match) {
      setBarcodeFeedback({
        ok: false,
        text: `Barcode "${code}" tidak ditemukan.`,
      });
    } else if (!match.isAvailable) {
      setBarcodeFeedback({
        ok: false,
        text: `${match.product_name} sedang tidak tersedia.`,
      });
    } else {
      addToCart(match);
      setBarcodeFeedback({
        ok: true,
        text: `${match.product_name} ditambahkan.`,
      });
    }
    setBarcodeQuery('');
    // Keep the SAME field focused so the next scan can land immediately —
    // there are two mounted inputs (mobile/desktop), only refocus the one
    // that was actually just used.
    source.current?.focus();
  };

  // Feedback is transient — clear it a moment after each scan so a stale
  // "not found" message doesn't linger and get mistaken for the current scan.
  useEffect(() => {
    if (!barcodeFeedback) return;
    const t = setTimeout(() => setBarcodeFeedback(null), 2500);
    return () => clearTimeout(t);
  }, [barcodeFeedback]);

  const updateQuantity = (lineId: string, delta: number) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.lineId === lineId) {
          const newQuantity = item.quantity + delta;
          return newQuantity > 0 ? { ...item, quantity: newQuantity } : item;
        }
        return item;
      }),
    );
  };

  // Typing "100" beats tapping + ninety-nine times. The half-typed value lives
  // in a draft slot rather than in the cart, so an intermediate empty field
  // never writes quantity 0 into the order; the cart only changes on commit.
  // One slot is enough — only the focused input is ever being edited.
  const [qtyDraft, setQtyDraft] = useState<{
    id: string;
    value: string;
  } | null>(null);
  // Escape cancels. Set at keydown and read on the blur it triggers, because
  // the input's DOM value still holds the draft at that point.
  const qtyCancelledRef = useRef(false);

  const setQuantity = (lineId: string, raw: string) => {
    setQtyDraft(null);
    const parsed = parseInt(raw, 10);
    // Blank or junk means "never mind" — keep the previous quantity instead of
    // silently dropping the line. Trash is what the button is for.
    if (!Number.isFinite(parsed) || parsed < 1) return;
    setCart((prev) =>
      prev.map((item) =>
        item.lineId === lineId
          ? { ...item, quantity: Math.min(parsed, MAX_QUANTITY) }
          : item,
      ),
    );
  };

  const removeFromCart = (lineId: string) => {
    setCart((prev) => prev.filter((item) => item.lineId !== lineId));
  };

  const clearCart = () => {
    setCart([]);
    setDiscountInput('');
    setAmountPaidInput('0');
    setOrderNote('');
  };

  // ── Kitchen notes: per-item and per-order, both device-local ──
  const openItemNote = (item: CartItem) => {
    setNoteDraft(item.note ?? '');
    setNoteTarget({
      kind: 'item',
      id: item.lineId,
      name: item.product.product_name,
    });
  };

  const openOrderNote = () => {
    setNoteDraft(orderNote);
    setNoteTarget({ kind: 'order' });
  };

  const saveNote = () => {
    if (!noteTarget) return;
    const value = noteDraft.trim();
    if (noteTarget.kind === 'order') {
      setOrderNote(value);
    } else {
      const { id } = noteTarget;
      setCart((prev) =>
        prev.map((item) =>
          // Empty means "remove the note" — drop the key rather than storing "".
          item.lineId === id ? { ...item, note: value || undefined } : item,
        ),
      );
    }
    setNoteTarget(null);
    setNoteDraft('');
  };

  // Calculations
  // Self-clearing banner, same idiom as barcodeFeedback above.
  const [labelFeedback, setLabelFeedback] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!labelFeedback) return;
    const t = setTimeout(() => setLabelFeedback(null), 3000);
    return () => clearTimeout(t);
  }, [labelFeedback]);

  // The cart lines awaiting confirmation. Labels cost stock, so nothing is sent
  // to the printer until the cashier has seen what it will produce. The modal
  // holds the label size and lays these out, so it takes the items rather than
  // a finished batch — changing the size there re-flows the preview.
  const [labelPreview, setLabelPreview] = useState<ProductLabel[] | null>(null);

  // The product whose option picker is open, if any. Null = closed. Always the
  // BASE the cashier tapped — the variant they choose comes back on confirm.
  const [pickerTarget, setPickerTarget] = useState<Product | null>(null);

  // Read-back view of the cart. The cart panel is narrow and each line packs a
  // name, its add-ons, a note and a price into ~11px rows, which is fine for
  // building an order and poor for checking one — add-on names truncate exactly
  // when the cashier wants to read them back to the customer. This is the same
  // cart, laid out to be READ: nothing here edits anything.
  const [clearView, setClearView] = useState(false);

  /**
   * Stage a product label for every unit in the cart — a line with quantity 3
   * yields three identical labels, because each one goes on a physical item.
   *
   * Discounted lines carry the marked-down price, since that is what the
   * customer pays and what the label is for.
   */
  const openLabelPreview = () => {
    if (cart.length === 0) return;

    const items: ProductLabel[] = cart.map((item) => {
      return {
        name: item.product.product_name,
        // The line's unit price, add-ons included — the label is what the
        // customer pays for that one item, and a topping is part of it.
        price: formatCurrency(unitPriceOf(item)),
        barcode: item.product.barcode,
        note: item.note,
        copies: item.quantity,
      };
    });

    setLabelPreview(items);
  };

  /**
   * Hand the reviewed batch to LabelBridge as a single job rather than a deep
   * link per line: it renders the batch into one command stream, so the printer
   * sees one connection and one paper path.
   */
  const confirmPrintLabels = (batch: LabelBatchJob, total: number) => {
    setLabelPreview(null);
    openLabelApp(batch, () =>
      setLabelFeedback({
        ok: false,
        text: 'LabelBridge belum terpasang di perangkat ini.',
      }),
    );
    setLabelFeedback({ ok: true, text: `Mencetak ${total} label...` });
  };

  const handlePrintOrderLabels = () => {
    if (cart.length === 0) return;
    const orderLabels: OrderLabel[] = cart.map((item) => ({
      orderId: activeTabId,
      customerName: customerName.trim() || 'Pesanan',
      productName: item.product.product_name,
      variant: item.product.variant_name || null,
      addons: (item.addons ?? []).map((a) => a.name),
      date: new Date(),
      outletName,
    }));
    const batch = buildOrderLabelBatch(orderLabels);
    openOrderLabelApp(batch, () =>
      setLabelFeedback({
        ok: false,
        text: 'LabelBridge belum terpasang di perangkat ini.',
      }),
    );
    setLabelFeedback({
      ok: true,
      text: `Mencetak ${orderLabels.length} label pesanan...`,
    });
  };

  // Add-ons are part of what the customer pays, so they are part of the base
  // the discount and the tax are worked out from — the backend computes tax
  // from the `total` this screen sends.
  const cartTotal = cart.reduce(
    (total, item) => total + unitPriceOf(item) * item.quantity,
    0,
  );

  const discountValue = parseFloat(discountInput) || 0;
  const discountAmount =
    discountValue <= 0
      ? 0
      : discountType === 'percentage'
        ? Math.min(cartTotal, (cartTotal * Math.min(discountValue, 100)) / 100)
        : Math.min(cartTotal, discountValue);
  const discountLabel =
    discountAmount > 0
      ? discountType === 'percentage'
        ? `Discount (${discountValue}%)`
        : 'Discount'
      : 'Discount';
  // Net of discount, BEFORE tax. This is what gets posted as `total`: the
  // server charges tax on it from the outlet's own settings rather than
  // trusting a number the client worked out.
  const finalTotal = cartTotal - discountAmount;

  // Tax sits outside the line, so it is added (or extracted) once, here, on the
  // discounted amount — never folded into any item price.
  const tax = computeTax(finalTotal, taxConfig);
  // What the customer actually hands over. Under inclusive pricing this equals
  // finalTotal; under exclusive it is finalTotal plus the tax.
  const grandTotal = tax.total;

  // Lazy mode pays the exact amount due, so change is always 0 and the payment
  // can never be insufficient. Everything about tendering and change is against
  // grandTotal — the customer pays the tax too, and taking cash against the
  // pre-tax figure would hand back the tax as change.
  const amountPaid = lazyMode ? grandTotal : parseFloat(amountPaidInput) || 0;
  const changeDue = Math.max(0, amountPaid - grandTotal);
  const isInsufficient =
    !lazyMode &&
    paymentMethod === 'cash' &&
    amountPaidInput.trim() !== '' &&
    amountPaid < grandTotal;
  const checkoutDisabled = cart.length === 0 || isInsufficient;

  // Two live orders on one buzzer is exactly the mix-up the number is meant to
  // prevent, so surface the clash instead of silently allowing it.
  const pagerClash = useMemo(() => {
    if (!canUsePager) return false;
    const n = pagerNumber.trim();
    if (!n) return false;
    return tabs.some((t) => t.id !== activeTabId && t.pagerNumber.trim() === n);
  }, [canUsePager, pagerNumber, tabs, activeTabId]);

  // Shared slip payload. Before checkout there's no server order id yet, so the
  // active tab's id stands in — stable across reprints of the same tab, which
  // keeps a reprinted struk matching the first one. It is NOT the final order
  // number: that's only minted when Checkout posts the order.
  const buildReceiptData = useCallback(
    (): ReceiptData => ({
      orderId: activeTabId || crypto.randomUUID(),
      customerName: customerName.trim(),
      // A tab held from before a downgrade still carries its number in
      // localStorage; the plan says it isn't printed any more.
      pagerNumber: canUsePager ? pagerNumber.trim() : '',
      orderNote: orderNote.trim(),
      items: cart.map((i) => ({
        product_name: i.product.product_name,
        quantity: i.quantity,
        price: i.product.price,
        price_mark_down: i.product.price_mark_down,
        note: i.note,
        // Passed through rather than folded into price: the slip prints them
        // indented under the item so the printed numbers still sum to Subtotal.
        addons: (i.addons ?? []).map((a) => ({
          product_name: a.name,
          quantity: a.quantity,
          price: a.price,
        })),
      })),
      subtotal: cartTotal,
      discountAmount,
      discountLabel,
      taxLabel: tax.applies ? taxLineLabel(taxConfig) : undefined,
      taxAmount: tax.applies ? tax.amount : undefined,
      taxInclusive: taxConfig.inclusive,
      total: grandTotal,
      paymentMethod,
      amountPaid:
        paymentMethod === 'cash' && amountPaid > 0 ? amountPaid : grandTotal,
      changeDue,
      date: new Date(),
      outletName,
      outletAddress,
      outletPhone,
      outletLogo,
      cashierName,
    }),
    [
      activeTabId,
      cart,
      cartTotal,
      customerName,
      pagerNumber,
      orderNote,
      discountAmount,
      discountLabel,
      grandTotal,
      tax,
      taxConfig,
      paymentMethod,
      canUsePager,
      amountPaid,
      changeDue,
      outletName,
      outletAddress,
      outletPhone,
      outletLogo,
      cashierName,
    ],
  );

  // Customer pays up front: print the struk and take the cash, but leave the
  // tab standing — the order isn't finished until the food is handed over and
  // the pager comes back, which is what Checkout marks.
  const printCustomerReceipt = () => {
    if (cart.length === 0 || isInsufficient) return;
    setReceipt({
      data: buildReceiptData(),
      variant: 'customer',
      heading: 'Struk Pelanggan',
    });
  };

  // Kitchen ticket. Printable at any point and as often as needed — a reprint
  // is the normal fix for a lost or smudged ticket, so nothing here is gated on
  // payment.
  const printKitchenTicket = () => {
    if (cart.length === 0) return;
    setReceipt({
      data: buildReceiptData(),
      variant: 'kitchen',
      heading: 'Tiket Dapur',
    });
  };

  const handleCheckout = useCallback(async () => {
    if (cart.length === 0 || isInsufficient) return;
    // Guard against duplicate submissions (double-click / Cmd+Enter key-repeat):
    // the ref flips synchronously so a second call bails before any await.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    // Capture snapshot before any async work so state changes mid-flight don't corrupt it
    const snapshot = [...cart];
    const snapshotTotal = cartTotal;
    const snapshotDiscountAmount = discountAmount;
    const snapshotDiscountLabel = discountLabel;
    // Posted as `total`: the server wants the pre-tax, post-discount figure and
    // charges tax on it itself. Sending the grand total would tax the tax.
    const snapshotFinalTotal = finalTotal;
    const snapshotGrandTotal = grandTotal;
    const snapshotTax = tax;
    const snapshotCustomerName = customerName.trim();
    const snapshotPagerNumber = canUsePager ? pagerNumber.trim() : '';
    const snapshotPaymentMethod = paymentMethod;
    const snapshotAmountPaid =
      snapshotPaymentMethod === 'cash' && amountPaid > 0
        ? amountPaid
        : snapshotGrandTotal;
    const snapshotChangeDue = Math.max(
      0,
      snapshotAmountPaid - snapshotGrandTotal,
    );
    try {
      const response = await fetch(`${API_URL}/api/add-order-detail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          outletId,
          cart: snapshot,
          total: snapshotFinalTotal,
          customerName: snapshotCustomerName,
          // Without this the order's note carries no cashierName and the
          // cashier report buckets every web sale under "-".
          cashierName,
          discountAmount: snapshotDiscountAmount,
          paymentMethod: snapshotPaymentMethod,
          amountPaid: snapshotAmountPaid,
          changeDue: snapshotChangeDue,
        }),
      });
      // Parse the body exactly once regardless of success/failure
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          data?.error?.message ||
            data?.error ||
            `Server error: ${response.status}`,
        );
      }
      setCartOpen(false);
      // The sale just changed what should be in the drawer, so re-read the
      // shift strip. Cheap: one small indexed query, only after a real sale.
      setShiftRefresh((n) => n + 1);
      // Order is paid: drop this tab and jump to the next / a fresh one. This
      // resets cart, customer, discount, and payment for the new active tab.
      completeActiveTab();
      setReceipt({
        variant: 'customer',
        heading: 'Order Placed!',
        data: {
          orderId: data.orderId ?? crypto.randomUUID(),
          customerName: snapshotCustomerName,
          pagerNumber: snapshotPagerNumber,
          items: snapshot.map((i) => ({
            product_name: i.product.product_name,
            quantity: i.quantity,
            price: i.product.price,
            price_mark_down: i.product.price_mark_down,
            variant_name: i.product.variant_name,
            addons: (i.addons ?? []).map((a) => ({
              product_name: a.name,
              quantity: a.quantity,
              price: a.price,
            })),
          })),
          subtotal: snapshotTotal,
          discountAmount: snapshotDiscountAmount,
          discountLabel: snapshotDiscountLabel,
          taxLabel: snapshotTax.applies ? taxLineLabel(taxConfig) : undefined,
          taxAmount: snapshotTax.applies ? snapshotTax.amount : undefined,
          taxInclusive: taxConfig.inclusive,
          total: snapshotGrandTotal,
          paymentMethod: snapshotPaymentMethod,
          amountPaid: snapshotAmountPaid,
          changeDue: snapshotChangeDue,
          date: new Date(),
          outletName,
          outletAddress,
          outletPhone,
          outletLogo,
          cashierName,
        },
      });
    } catch (error: any) {
      alert(error.message);
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [
    cart,
    cartTotal,
    amountPaid,
    customerName,
    pagerNumber,
    discountAmount,
    discountLabel,
    finalTotal,
    isInsufficient,
    paymentMethod,
    canUsePager,
    grandTotal,
    tax,
    taxConfig,
    outletId,
    outletName,
    outletAddress,
    outletPhone,
    outletLogo,
    cashierName,
    completeActiveTab,
  ]);

  // Adds a keyboard shortcut (CMD/Ctrl + Enter) for Checkout
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        handleCheckout();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleCheckout]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main Content: Products Grid */}
      <div className="flex-1 flex flex-col min-w-0 bg-background/50 backdrop-blur-sm border-r">
        {/* Header & Search */}
        <div className="p-3 pb-0">
          <ShiftBar
            cashierName={cashierName}
            refreshSignal={shiftRefresh}
            canUseShift={canUseShift}
          />

          {/* Mobile: search + barcode */}
          <div className="flex items-center gap-2 mb-1 md:hidden">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search products..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-9 pl-10 pr-4 rounded-xl border bg-background/80 shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none text-sm"
              />
            </div>
            <div className="relative flex-1">
              <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                ref={barcodeInputMobileRef}
                type="text"
                placeholder="Scan barcode..."
                value={barcodeQuery}
                onChange={(e) => setBarcodeQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleBarcodeScan(barcodeInputMobileRef);
                  }
                }}
                className="w-full h-9 pl-10 pr-4 rounded-xl border bg-background/80 shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none text-sm font-mono"
              />
            </div>
          </div>
          {barcodeFeedback && (
            <p
              className={`text-xs mb-1 md:hidden ${barcodeFeedback.ok ? 'text-emerald-600' : 'text-rose-600'}`}
            >
              {barcodeFeedback.text}
            </p>
          )}

          {/* Desktop: full header */}
          <div className="hidden md:flex flex-row gap-4 items-center justify-between">
            <div className="flex flex-col items-end gap-1">
              <div className="flex gap-3">
                <div className="relative w-56">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search products..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full h-11 pl-10 pr-4 rounded-xl border bg-background/80 shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none"
                  />
                </div>
                <div className="relative w-56">
                  <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    ref={barcodeInputDesktopRef}
                    type="text"
                    placeholder="Scan barcode..."
                    value={barcodeQuery}
                    onChange={(e) => setBarcodeQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleBarcodeScan(barcodeInputDesktopRef);
                      }
                    }}
                    className="w-full h-11 pl-10 pr-4 rounded-xl border bg-background/80 shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none font-mono"
                  />
                </div>
              </div>
              {barcodeFeedback && (
                <p
                  className={`text-xs ${barcodeFeedback.ok ? 'text-emerald-600' : 'text-rose-600'}`}
                >
                  {barcodeFeedback.text}
                </p>
              )}
            </div>
          </div>

          {/* Categories */}
          <div className="flex gap-2 md:gap-3 overflow-x-auto scrollbar-hide">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                // capitalize: owner-typed section names already read properly,
                // but the raw category fallback is stored lowercase.
                className={`flex items-center gap-1.5 md:gap-2 px-3 py-1.5 md:px-4 md:py-2.5 rounded-xl border-2 whitespace-nowrap capitalize transition-all duration-300 font-semibold text-xs md:text-sm ${
                  selectedCategory === cat.id
                    ? `${cat.border} ${cat.bg} ${cat.color} shadow-sm ring-1 ring-current`
                    : 'border-transparent bg-background/60 hover:bg-muted text-muted-foreground hover:text-foreground hover:border-border'
                }`}
              >
                <cat.icon className="h-3.5 w-3.5 md:h-4 md:w-4" />
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Products Grid */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 pt-2 pb-24 md:pb-6">
          {filteredProducts.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
              <Package className="h-16 w-16 mb-4" />
              <h3 className="text-xl font-bold mb-2">No products found</h3>
              <p className="max-w-[250px]">
                Try adjusting your search or category filter.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-6 pb-20">
              {filteredProducts.map((product) => {
                const isDiscounted =
                  product.price_mark_down && product.price_mark_down !== '0';
                const displayPrice = isDiscounted
                  ? product.price_mark_down
                  : product.price;
                // Summed, not found: one product can now occupy several lines
                // (different toppings), and the badge means "how many of this
                // are in the cart" regardless of how they were configured.
                // The tile's options: base first, empty when it has none.
                const options = variantOptionsOf(product);
                const optionIds = new Set(options.map((o) => o.id));
                // Summed, and across variants: a Large in the cart belongs to
                // the tile the cashier tapped to put it there, so the badge has
                // to count it — otherwise the one tile that could explain the
                // cart is the one showing nothing.
                const inCart = cart.reduce(
                  (n, item) =>
                    item.product.id === product.id ||
                    optionIds.has(item.product.id)
                      ? n + item.quantity
                      : n,
                  0,
                );
                // A base whose own row is sold out but whose Large is not stays
                // tappable — the picker greys out what's actually gone.
                const available = sellable(product);
                // What one costs, at least. With variants the headline is the
                // cheapest option rather than the base's price: the base is the
                // default, but the grid is a menu and a menu quotes its floor.
                const fromPrice =
                  options.length > 0
                    ? Math.min(...options.map(priceOf))
                    : Number(displayPrice);

                return (
                  <button
                    key={product.id}
                    onClick={() => selectProduct(product)}
                    disabled={!available}
                    className={`group relative flex flex-col text-left bg-background rounded-2xl overflow-hidden border-2 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 ${
                      !available
                        ? 'opacity-60 cursor-not-allowed border-muted grayscale-[0.5]'
                        : inCart > 0
                          ? 'border-blue-500 ring-2 ring-blue-500/20'
                          : 'border-transparent hover:border-blue-200'
                    }`}
                  >
                    {/* Image Container */}
                    <div className="relative aspect-[4/3] md:aspect-square w-full bg-muted/20 overflow-hidden">
                      {product.image && product.image !== 'avatar.png' ? (
                        <Image
                          src={resolveProductImage(product.image)}
                          unoptimized={isBackendImage(product.image)}
                          fill
                          className="object-cover transition-transform duration-700 group-hover:scale-110"
                          alt={product.product_name}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-muted/30">
                          <Package className="h-12 w-12 text-muted-foreground/40" />
                        </div>
                      )}

                      {/* Stock Badge */}
                      <div className="absolute top-3 left-3 flex flex-col gap-2">
                        {!available && (
                          <span className="bg-rose-500/90 backdrop-blur text-white text-[10px] font-black uppercase px-2.5 py-1 rounded-full shadow-sm">
                            Out of Stock
                          </span>
                        )}
                        {options.length > 0 && available && (
                          <span className="bg-violet-500/90 backdrop-blur text-white text-[10px] font-black uppercase px-2.5 py-1 rounded-full shadow-sm">
                            {options.length} {product.variant_label?.trim() || 'Varian'}
                          </span>
                        )}
                        {isDiscounted && available && (
                          <span className="bg-emerald-500/90 backdrop-blur text-white text-[10px] font-black uppercase px-2.5 py-1 rounded-full shadow-sm">
                            Promo
                          </span>
                        )}
                      </div>

                      {/* In Cart Indicator */}
                      {inCart > 0 && (
                        <div className="absolute top-3 right-3 bg-blue-600 text-white font-bold h-7 w-7 rounded-full flex items-center justify-center shadow-lg border-2 border-background animate-in zoom-in">
                          {inCart}
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="p-2 md:p-4 flex flex-col flex-1">
                      <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">
                        {product.category}
                      </span>
                      <h3 className="font-bold text-xs md:text-sm leading-tight line-clamp-2 mb-1 md:mb-2 group-hover:text-blue-600 transition-colors">
                        {product.product_name}
                      </h3>

                      <div className="mt-auto flex items-end justify-between">
                        <div className="flex flex-col">
                          {isDiscounted && options.length === 0 && (
                            <span className="text-[10px] md:text-xs text-muted-foreground line-through decoration-rose-500/50">
                              {formatCurrency(Number(product.price))}
                            </span>
                          )}
                          {options.length > 0 && (
                            <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              mulai
                            </span>
                          )}
                          <span className="font-extrabold text-blue-600 text-sm md:text-base">
                            {formatCurrency(fromPrice)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Sidebar: Shopping Cart */}

      <div
        className={`fixed bottom-0 left-0 right-0 z-40 flex flex-col bg-background h-[95vh] sm:h-[97vh] rounded-t-3xl border-t shadow-2xl transition-transform duration-300 ease-in-out ${cartOpen ? 'translate-y-0' : 'translate-y-full'} md:static md:translate-y-0 md:z-10 md:rounded-none md:border-t-0 md:border-l md:h-full md:w-[350px] lg:w-[350px] md:flex-shrink-0`}
      >
        {/* Mobile drag handle */}
        <div className="relative flex justify-center items-center px-5 pt-3 pb-1 md:hidden">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/20" />
          <button
            onClick={() => setCartOpen(false)}
            className="absolute right-5 text-muted-foreground hover:text-foreground p-1"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Held-order tabs — collapsed into a popup so its controls can't be
            fumbled while ringing up an order. */}
        <div className="relative border-b px-3 py-2">
          {(() => {
            const activeTab = tabs.find((t) => t.id === activeTabId);
            const activeLabel =
              activeTab?.customerName.trim() || activeTab?.label || 'Pesanan';
            const activePager = canUsePager
              ? activeTab?.pagerNumber.trim()
              : '';
            return (
              <button
                onClick={() => setTabsMenuOpen((v) => !v)}
                className="flex w-full items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2 text-sm font-bold transition-colors hover:bg-muted"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {activePager ? (
                    <span className="flex h-5 shrink-0 items-center gap-1 rounded-full bg-blue-600 px-2 text-[11px] font-black text-white">
                      <Bell className="h-3 w-3" />
                      {activePager}
                    </span>
                  ) : (
                    <Layers className="h-4 w-4 shrink-0 text-blue-600" />
                  )}
                  <span className="truncate">{activeLabel}</span>
                  <span className="shrink-0 rounded-full bg-blue-50 px-1.5 text-[10px] text-blue-700">
                    {tabs.length} tab
                  </span>
                </span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 transition-transform ${tabsMenuOpen ? 'rotate-180' : ''}`}
                />
              </button>
            );
          })()}

          {tabsMenuOpen && (
            <>
              {/* click-away to close */}
              <div
                className="fixed inset-0 z-30"
                onClick={() => setTabsMenuOpen(false)}
              />
              <div className="absolute inset-x-3 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-xl border bg-background p-1.5 shadow-xl">
                {tabs.map((t) => {
                  const count = t.cart.reduce((acc, i) => acc + i.quantity, 0);
                  const label = t.customerName.trim() || t.label;
                  const active = t.id === activeTabId;
                  return (
                    <div
                      key={t.id}
                      onClick={() => {
                        switchTab(t.id);
                        setTabsMenuOpen(false);
                      }}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors ${
                        active
                          ? 'bg-blue-50 font-bold text-blue-700'
                          : 'hover:bg-muted'
                      }`}
                    >
                      {/* Pager number leads: when the kitchen calls out a
                          number, this list is what gets scanned. Without the
                          feature the column is dropped rather than left as a
                          row of empty placeholders. */}
                      {canUsePager && (
                        <span
                          className={`flex h-6 w-8 shrink-0 items-center justify-center rounded-md text-xs font-black tabular-nums ${
                            t.pagerNumber.trim()
                              ? 'bg-blue-600 text-white'
                              : 'bg-muted text-muted-foreground/50'
                          }`}
                        >
                          {t.pagerNumber.trim() || '--'}
                        </span>
                      )}
                      <span className="flex-1 truncate">{label}</span>
                      {staleTabIds.has(t.id) && (
                        <span
                          title="Ada item yang berubah di menu"
                          className="shrink-0 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white"
                        >
                          !
                        </span>
                      )}
                      {count > 0 && (
                        <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] font-semibold">
                          {count} item
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          closeTab(t.id);
                        }}
                        className="shrink-0 p-1 text-muted-foreground hover:text-rose-500"
                        aria-label="Tutup tab"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
                <button
                  onClick={() => {
                    addTab();
                    setTabsMenuOpen(false);
                  }}
                  className="mt-1 flex w-full items-center gap-2 rounded-lg border border-dashed border-blue-300 px-2 py-2 text-sm font-bold text-blue-600 hover:bg-blue-50"
                >
                  <Plus className="h-4 w-4" /> Tab baru
                </button>
              </div>
            </>
          )}
        </div>

        {/* Cart Header */}
        <div className="sticky top-0 z-20 border-b bg-background/80 px-4 py-3 backdrop-blur-md">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {/* The pager box takes the slot the decorative cart icon used to
                  occupy, so the number is always on screen without costing a
                  row in an already-tight sidebar. Below Max Lite it isn't
                  rendered at all — a disabled box that explains itself would
                  cost more room than the feature does. */}
              {canUsePager && (
                <label
                  className={`flex shrink-0 flex-col items-center rounded-xl border-2 px-1.5 py-1 transition-colors ${
                    pagerClash
                      ? 'border-rose-400 bg-rose-50'
                      : pagerNumber.trim()
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-transparent bg-muted/50'
                  }`}
                  title="Nomor pager"
                >
                  <Bell
                    className={`h-3 w-3 ${pagerClash ? 'text-rose-500' : 'text-blue-600'}`}
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label="Nomor pager"
                    value={pagerNumber}
                    onChange={(e) =>
                      setPagerNumber(
                        e.target.value.replace(/\D/g, '').slice(0, 3),
                      )
                    }
                    placeholder="--"
                    className="w-8 bg-transparent text-center text-base font-black tabular-nums outline-none placeholder:font-bold placeholder:text-muted-foreground/50"
                  />
                </label>
              )}
              <div className="min-w-0 flex-1">
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Nama Pelanggan"
                  className="w-full text-lg font-bold bg-transparent outline-none border-b-2 border-transparent focus:border-blue-500 placeholder:text-foreground placeholder:font-bold transition-colors truncate"
                />
                <p className="text-sm text-muted-foreground">
                  {cart.reduce((acc, item) => acc + item.quantity, 0)} Items
                </p>
              </div>
            </div>
            {/* Side by side, not stacked. Labelled buttons in a column made
                the header two rows tall on a panel where every row costs a
                cart item, so note / read-back / clear all ride here as icons.
                Read-back only appears once there is something to misread: a
                single plain item reads fine in the panel itself. */}
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={openOrderNote}
                className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                  orderNote.trim()
                    ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
                title="Catatan pesanan (dapur)"
                aria-label="Catatan pesanan"
              >
                <StickyNote className="h-4 w-4" />
              </button>
              {(cart.length > 1 ||
                cart.some((i) => (i.addons?.length ?? 0) > 0 || i.note)) && (
                <button
                  onClick={() => setClearView(true)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title="Lihat lebih jelas"
                  aria-label="Lihat lebih jelas"
                >
                  <Eye className="h-4 w-4" />
                </button>
              )}
              {cart.length > 0 && (
                <button
                  onClick={clearCart}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-rose-50 hover:text-rose-600"
                  title="Kosongkan keranjang"
                  aria-label="Kosongkan keranjang"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          {pagerClash && (
            <p className="mt-1 text-[11px] font-semibold text-rose-500">
              Pager {pagerNumber.trim()} sedang dipakai tab lain.
            </p>
          )}
          {labelFeedback && (
            <p
              className={`mt-1 text-[11px] font-semibold ${
                labelFeedback.ok ? 'text-emerald-600' : 'text-rose-500'
              }`}
            >
              {labelFeedback.text}
            </p>
          )}
          {orderNote.trim() && (
            <p className="mt-1 line-clamp-2 rounded-lg bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
              {orderNote}
            </p>
          )}
        </div>

        {/* The owner changed something a parked cart still references. Shown,
            never applied — accepting is the cashier's call. */}
        {staleLines.length > 0 && (
          <div className="mx-4 mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 dark:bg-amber-950/30">
            <p className="text-[11px] font-semibold text-amber-900 dark:text-amber-200">
              {staleLines.length} item berubah di menu
            </p>
            <p className="mt-0.5 text-[11px] text-amber-800 dark:text-amber-300">
              Keranjang masih memakai harga lama.
            </p>
            <button
              onClick={repriceStaleLines}
              className="mt-1.5 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-700"
            >
              Pakai harga baru
            </button>
          </div>
        )}

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-50 px-6">
              <ShoppingCart className="h-16 w-16 mb-4 text-muted-foreground" />
              <h3 className="font-bold text-lg mb-1">Cart is empty</h3>
              <p className="text-sm text-muted-foreground">
                Select products from the left to add them to your cart.
              </p>
            </div>
          ) : (
            cart.map((item) => {
              const isDiscounted =
                item.product.price_mark_down &&
                item.product.price_mark_down !== '0';
              const displayPrice = isDiscounted
                ? item.product.price_mark_down
                : item.product.price;

              return (
                <div
                  key={item.lineId}
                  className="flex gap-3 bg-muted/30 p-3 rounded-2xl border animate-in slide-in-from-right-4"
                >
                  {/* Item Image */}
                  <div className="relative h-16 w-16 rounded-xl overflow-hidden bg-background border shrink-0">
                    {item.product.image &&
                    item.product.image !== 'avatar.png' ? (
                      <Image
                        src={resolveProductImage(item.product.image)}
                        unoptimized={isBackendImage(item.product.image)}
                        fill
                        className="object-cover"
                        alt={item.product.product_name}
                      />
                    ) : (
                      <Package className="h-8 w-8 m-auto mt-4 text-muted-foreground/30" />
                    )}
                  </div>

                  {/* Item Details */}
                  <div className="flex-1 flex flex-col justify-between min-w-0">
                    <div className="flex justify-between items-start gap-2">
                      <h4 className="font-bold text-sm line-clamp-2 leading-tight">
                        {item.product.product_name}
                      </h4>
                      <div className="flex shrink-0 items-center">
                        <button
                          onClick={() => openItemNote(item)}
                          aria-label={`Catatan ${item.product.product_name}`}
                          title="Catatan untuk item ini"
                          className={`p-1 transition-colors ${
                            item.note
                              ? 'text-amber-600 hover:text-amber-700'
                              : 'text-muted-foreground hover:text-amber-600'
                          }`}
                        >
                          <StickyNote className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => removeFromCart(item.lineId)}
                          className="text-muted-foreground hover:text-rose-500 transition-colors p-1"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    {(() => {
                      const stale = staleByLineId.get(item.lineId);
                      if (!stale) return null;
                      return (
                        <p className="mt-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                          {stale.newPrice === null
                            ? 'Produk sudah diarsipkan'
                            : stale.unavailable
                              ? 'Sudah habis di menu'
                              : `Harga berubah ${formatCurrency(stale.oldPrice)} \u2192 ${formatCurrency(stale.newPrice)}`}
                        </p>
                      );
                    })()}
                    {(item.addons ?? []).map((a) => (
                      <p
                        key={a.option_id}
                        className="mt-0.5 flex justify-between gap-2 pl-1 text-[11px] text-muted-foreground"
                      >
                        <span className="truncate">
                          + {a.quantity > 1 ? `${a.quantity}x ` : ''}
                          {a.name}
                        </span>
                        {a.price > 0 && (
                          <span className="shrink-0">
                            {formatCurrency(a.price * a.quantity)}
                          </span>
                        )}
                      </p>
                    ))}
                    {item.note && (
                      <p className="mt-1 line-clamp-2 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">
                        {item.note}
                      </p>
                    )}

                    <div className="flex items-center justify-between mt-2">
                      {/* The LINE's unit price, add-ons included — this is the
                          number the quantity beside it multiplies. */}
                      <span className="font-bold text-blue-600 text-sm">
                        {formatCurrency(unitPriceOf(item))}
                        {(item.addons?.length ?? 0) > 0 && (
                          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                            (dasar {formatCurrency(Number(displayPrice))})
                          </span>
                        )}
                      </span>

                      {/* Quantity Controls */}
                      <div className="flex items-center gap-3 bg-background border rounded-lg p-1 shadow-sm">
                        <button
                          onClick={() => updateQuantity(item.lineId, -1)}
                          className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground transition-colors"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <input
                          type="text"
                          inputMode="numeric"
                          aria-label={`Jumlah ${item.product.product_name}`}
                          value={
                            qtyDraft?.id === item.lineId
                              ? qtyDraft.value
                              : String(item.quantity)
                          }
                          onFocus={(e) => {
                            setQtyDraft({
                              id: item.lineId,
                              value: String(item.quantity),
                            });
                            // Select-all so the cashier can just type over it.
                            e.currentTarget.select();
                          }}
                          onChange={(e) =>
                            setQtyDraft({
                              id: item.lineId,
                              value: e.target.value
                                .replace(/\D/g, '')
                                .slice(0, 4),
                            })
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              e.currentTarget.blur();
                            } else if (e.key === 'Escape') {
                              qtyCancelledRef.current = true;
                              e.currentTarget.blur();
                            }
                          }}
                          onBlur={(e) => {
                            if (qtyCancelledRef.current) {
                              qtyCancelledRef.current = false;
                              setQtyDraft(null);
                              return;
                            }
                            setQuantity(item.lineId, e.target.value);
                          }}
                          className="w-10 h-6 text-sm font-bold text-center bg-transparent rounded-md outline-none transition-colors focus:bg-muted focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                          onClick={() => updateQuantity(item.lineId, 1)}
                          className="w-6 h-6 flex items-center justify-center rounded-md bg-blue-50 hover:bg-blue-100 text-blue-600 transition-colors"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Checkout Section
            ------------------------------------------------------------------
            Ordered by what the cashier decides, in the order they decide it:
            how the customer is paying, what they owe, what they handed over,
            then the buttons. It used to be five separately-bordered blocks
            stacked down the panel — a summary, a full-width Lazy Mode card, a
            cash card, a wrapping row of payment chips, and two button rows —
            which is what made it read as clutter rather than as a sequence. */}
        <div className="border-t bg-background p-3 shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.1)]">
          {/* How the customer paid. First, because it decides whether the cash
              block below exists at all — putting it last meant the panel
              reshuffled under the cashier's finger mid-sale.

              A fixed 5-up grid rather than wrapping chips: the old flex-wrap
              row broke to two lines at this panel width, and where it broke
              depended on the label lengths, so the whole footer shifted
              vertically for no reason the cashier could see.

              Still always visible rather than behind a toggle: it is what the
              shift report and every payment report bucket on, and a cashier who
              has to go looking for it leaves it on Tunai. Picking anything but
              Tunai also clears an insufficient-cash state, which is the usual
              reason to switch mid-sale.

              While Lazy Mode is on the other four are disabled rather than
              hidden: lazy mode is a cash sale by definition, and a cashier who
              reaches for QRIS needs to see WHY it won't take, not find the row
              silently missing two thirds of its buttons. */}
          <div className="mb-2 grid grid-cols-5 gap-1">
            {POS_PAYMENT_OPTIONS.map((opt) => {
              const locked = lazyMode && opt.value !== 'cash';
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={locked}
                  onClick={() => setPaymentMethod(opt.value)}
                  title={
                    locked
                      ? 'Lazy Mode aktif — pembayaran terkunci ke Tunai'
                      : opt.label
                  }
                  className={`truncate rounded-lg border-2 px-1 py-1.5 text-[11px] font-bold transition-colors ${
                    paymentMethod === opt.value
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : locked
                        ? 'cursor-not-allowed border-border/50 bg-muted/40 text-muted-foreground/40'
                        : 'border-border bg-background text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {opt.chip}
                </button>
              );
            })}
          </div>

          {/* Says why four of the five just went grey. Without it the lock
              reads as the app being broken. */}
          {lazyMode && (
            <p className="mb-2 -mt-1 text-[11px] text-muted-foreground">
              Lazy Mode aktif — pembayaran terkunci ke Tunai.
            </p>
          )}

          {/* What is owed. One bordered card so the arithmetic reads as a
              single block that adds up, instead of loose rows sharing space
              with the controls that change them. */}
          <div className="mb-2 rounded-xl border bg-muted/30 px-3 py-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Subtotal</span>
              <span className="tabular-nums">
                {formatCurrency(Number(cartTotal))}
              </span>
            </div>

            {/* The discount controls stay inline, but inside ONE bordered
                cluster. Previously the %/Rp toggle and the number field floated
                loose between the label and its value, reading as three
                unrelated controls that happened to share a line. */}
            <div className="mt-1.5 flex items-center justify-between gap-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <span>Diskon</span>
                <div className="flex items-center overflow-hidden rounded-md border bg-background">
                  <button
                    type="button"
                    onClick={() => setDiscountType('percentage')}
                    className={`px-1.5 py-1 text-[11px] font-bold transition-colors ${
                      discountType === 'percentage'
                        ? 'bg-blue-600 text-white'
                        : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    %
                  </button>
                  <button
                    type="button"
                    onClick={() => setDiscountType('amount')}
                    className={`px-1.5 py-1 text-[11px] font-bold transition-colors ${
                      discountType === 'amount'
                        ? 'bg-blue-600 text-white'
                        : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    Rp
                  </button>
                  <input
                    type="number"
                    min={0}
                    max={discountType === 'percentage' ? 100 : undefined}
                    value={discountInput}
                    onChange={(e) => setDiscountInput(e.target.value)}
                    placeholder="0"
                    aria-label="Nilai diskon"
                    className="h-6 w-14 border-l bg-transparent px-1.5 text-xs font-bold outline-none focus:bg-muted"
                  />
                </div>
              </div>
              <span
                className={`tabular-nums ${discountAmount > 0 ? 'font-semibold text-rose-500' : ''}`}
              >
                {discountAmount > 0 ? '-' : ''}
                {formatCurrency(discountAmount)}
              </span>
            </div>

            {tax.applies && (
              <div className="mt-1.5 flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  {taxLineLabel(taxConfig)}
                  {/* Inclusive tax doesn't change what's owed, so say so —
                      otherwise the row reads like a charge left out of Total. */}
                  {taxConfig.inclusive && (
                    <span className="ml-1 text-[11px]">(termasuk)</span>
                  )}
                </span>
                <span className="font-semibold tabular-nums">
                  {formatCurrency(tax.amount)}
                </span>
              </div>
            )}

            <div className="my-2 h-px bg-border" />
            <div className="flex items-end justify-between">
              <span className="text-base font-bold">Total</span>
              <span className="text-2xl font-black tabular-nums tracking-tight text-blue-600">
                {formatCurrency(Number(grandTotal))}
              </span>
            </div>
          </div>

          {/* Cash tendered. Only for a cash sale — there is nothing to tender
              on a QRIS or card payment, and a "Kembali Rp 0" under one reads
              like a receipt for a transaction that didn't happen that way. */}
          {paymentMethod === 'cash' && (
            <div className="mb-2 rounded-xl border bg-muted/30 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-muted-foreground">
                    Bayar
                  </span>
                  {/* Lazy mode used to own a full-width card with a two-line
                      explanation, for a device preference that is set once and
                      then never touched again. It only ever means "uang pas"
                      and it only applies to cash, so it belongs here, next to
                      the field it overrides.

                      Deliberately still rendered while it is ON: the old layout
                      hid this whole block when lazy mode was active, so the
                      only way back was the separate card. Without that card it
                      has to stay reachable from here. */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={lazyMode}
                    onClick={toggleLazyMode}
                    title="Uang pas otomatis, tanpa hitung kembalian"
                    className={`rounded-md border px-2 py-0.5 text-[11px] font-bold transition-colors ${
                      lazyMode
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-border text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    Lazy Mode
                  </button>
                </div>
                {lazyMode ? (
                  <span className="text-sm font-bold tabular-nums">
                    {formatCurrency(grandTotal)}
                  </span>
                ) : (
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label="Uang diterima"
                    value={
                      amountPaidInput && Number(amountPaidInput) > 0
                        ? formatCurrency(Number(amountPaidInput))
                        : ''
                    }
                    onChange={(e) =>
                      setAmountPaidInput(e.target.value.replace(/\D/g, ''))
                    }
                    placeholder="Rp 0"
                    className="h-9 w-36 rounded-lg border bg-background px-3 text-right text-sm font-bold tabular-nums outline-none focus:border-transparent focus:ring-2 focus:ring-blue-500"
                  />
                )}
              </div>
              {!lazyMode && (
                <div className="mt-1.5 flex items-center justify-between">
                  <span className="text-sm font-semibold text-muted-foreground">
                    {isInsufficient ? 'Kurang' : 'Kembali'}
                  </span>
                  <span
                    className={`text-sm font-bold tabular-nums ${isInsufficient ? 'text-rose-500' : 'text-emerald-600'}`}
                  >
                    {formatCurrency(
                      isInsufficient ? grandTotal - amountPaid : changeDue,
                    )}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Pay-first flow: take the money and print the slips while the tab
              stays open, so the pager number and notes remain on screen until
              the food is handed over. They run BEFORE Checkout rather than
              instead of it, so they ride the same row as unlabelled squares:
              same reach, a third of the weight, and the row that ends the
              order stays one row. Icon-only, so each needs its own label. */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={printCustomerReceipt}
              disabled={checkoutDisabled}
              className="h-10 w-10 shrink-0 rounded-xl border-2 p-0"
              title="Cetak struk pelanggan"
              aria-label="Cetak struk pelanggan"
            >
              <Printer className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={openLabelPreview}
              disabled={cart.length === 0}
              className="h-10 w-10 shrink-0 rounded-xl border-2 p-0"
              title="Pratinjau & cetak label produk"
              aria-label="Cetak label produk"
            >
              <Tag className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handlePrintOrderLabels}
              disabled={cart.length === 0}
              className="h-10 w-10 shrink-0 rounded-xl border-2 p-0 bg-purple-50 border-purple-200 hover:bg-purple-100 text-purple-600"
              title="Cetak label pesanan (order labels)"
              aria-label="Cetak label pesanan"
            >
              <Printer className="h-4 w-4" />
            </Button>
            {canUsePager && (
              <Button
                type="button"
                variant="outline"
                onClick={printKitchenTicket}
                disabled={cart.length === 0}
                className="h-10 w-10 shrink-0 rounded-xl border-2 p-0"
                title="Cetak tiket dapur"
                aria-label="Cetak tiket dapur"
              >
                <ChefHat className="h-4 w-4" />
              </Button>
            )}
            <Button
              onClick={handleCheckout}
              disabled={checkoutDisabled || isSubmitting}
              className="h-12 flex-1 rounded-2xl text-lg font-bold shadow-xl shadow-blue-600/20 bg-blue-600 hover:bg-blue-700 transition-all hover:-translate-y-1 relative group"
            >
              <CreditCard className="mr-2 h-5 w-5" />
              {isSubmitting ? 'Processing…' : 'Checkout Now'}
              <span className="absolute right-4 text-xs font-medium text-white/50 bg-white/10 px-2 py-1 rounded hidden lg:block group-hover:bg-white/20 transition-colors">
                ⌘ ↵
              </span>
            </Button>
          </div>
        </div>
      </div>

      {/* Receipt / kitchen ticket modal */}
      {receipt && (
        <ReceiptModal
          data={receipt.data}
          variant={receipt.variant}
          heading={receipt.heading}
          onClose={() => setReceipt(null)}
        />
      )}

      {/* What the label printer is about to produce, drawn from the same
          element list that gets sent to it. */}
      {pickerTarget && (
        <OptionPickerModal
          product={pickerTarget}
          variantLabel={pickerTarget.variant_label?.trim() || 'Varian'}
          variants={variantOptionsOf(pickerTarget)}
          // Add-on groups are the BASE's, and a variant inherits them: "Ukuran"
          // and "Topping" are separate questions, so a Large gets the same
          // toppings offered as a Reguler without the owner attaching the group
          // to every size by hand.
          groups={pickerTarget.addon_groups ?? []}
          onCancel={() => setPickerTarget(null)}
          onConfirm={({ product, addons }) => {
            // The chosen variant IS the line's product. Nothing downstream —
            // pricing, stock, cost, the receipt — needs to know a question was
            // asked to get here.
            addToCart(product, addons.length ? addons : undefined);
            setPickerTarget(null);
          }}
        />
      )}

      {labelPreview && (
        <LabelPreviewModal
          items={labelPreview}
          onConfirm={confirmPrintLabels}
          onClose={() => setLabelPreview(null)}
        />
      )}

      {/* Read-back view: the same cart at a size a cashier can read aloud to
          the customer. Deliberately inert — no quantity steppers, no remove, no
          note buttons — because the one job here is checking, and a stray tap
          on a control while reading an order back is how a wrong sale happens.
          Editing stays in the panel behind it. */}
      {clearView && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => setClearView(false)}
        >
          <div
            className="flex max-h-[88vh] w-full flex-col rounded-t-3xl bg-background shadow-2xl sm:max-w-lg sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b px-5 py-4">
              <div className="min-w-0">
                <h3 className="text-lg font-bold">Rincian Pesanan</h3>
                <p className="text-xs text-muted-foreground">
                  {cart.reduce((n, i) => n + i.quantity, 0)} item
                  {customerName.trim() ? ` · ${customerName.trim()}` : ''}
                  {canUsePager && pagerNumber.trim()
                    ? ` · Pager ${pagerNumber.trim()}`
                    : ''}
                </p>
              </div>
              <button
                onClick={() => setClearView(false)}
                className="p-1 text-muted-foreground hover:text-foreground"
                aria-label="Tutup"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 divide-y overflow-y-auto px-5">
              {cart.map((item) => (
                <div key={item.lineId} className="py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 text-base font-bold leading-snug">
                      <span className="text-blue-600">{item.quantity}x</span>{' '}
                      {item.product.product_name}
                    </p>
                    {/* The line total, which is what the customer is being read
                        — the per-unit price is detail they did not ask for. */}
                    <span className="shrink-0 text-base font-bold tabular-nums">
                      {formatCurrency(unitPriceOf(item) * item.quantity)}
                    </span>
                  </div>

                  {/* Full names, no truncation and no 11px type: this is the
                      whole reason the view exists. */}
                  {(item.addons ?? []).map((a) => (
                    <div
                      key={a.option_id}
                      className="mt-1 flex items-baseline justify-between gap-3 pl-4 text-sm"
                    >
                      <span className="min-w-0 text-muted-foreground">
                        + {a.quantity > 1 ? `${a.quantity}x ` : ''}
                        {a.name}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {a.price > 0
                          ? formatCurrency(a.price * a.quantity * item.quantity)
                          : 'Gratis'}
                      </span>
                    </div>
                  ))}

                  {item.note && (
                    <p className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                      {item.note}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="shrink-0 space-y-1 border-t px-5 py-4 text-sm">
              {orderNote.trim() && (
                <p className="mb-2 rounded-lg bg-amber-50 px-2 py-1 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  {orderNote}
                </p>
              )}
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="tabular-nums">
                  {formatCurrency(cartTotal)}
                </span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-emerald-600">
                  <span>
                    Diskon{discountLabel ? ` (${discountLabel})` : ''}
                  </span>
                  <span className="tabular-nums">
                    -{formatCurrency(discountAmount)}
                  </span>
                </div>
              )}
              {tax.applies && (
                <div className="flex justify-between text-muted-foreground">
                  <span>{taxLineLabel(taxConfig)}</span>
                  <span className="tabular-nums">
                    {formatCurrency(tax.amount)}
                  </span>
                </div>
              )}
              <div className="flex justify-between pt-1 text-lg font-bold">
                <span>Total</span>
                <span className="tabular-nums">
                  {formatCurrency(grandTotal)}
                </span>
              </div>
              <Button
                onClick={() => setClearView(false)}
                className="mt-3 h-12 w-full rounded-xl bg-blue-600 font-bold hover:bg-blue-700"
              >
                Tutup
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Kitchen note editor — one small dialog for both the per-item and the
          whole-order note. Notes never leave this device. */}
      {noteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-background p-5 shadow-2xl">
            <div className="mb-1 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-base font-bold">
                  {noteTarget.kind === 'order'
                    ? 'Catatan Pesanan'
                    : 'Catatan Item'}
                </h3>
                <p className="truncate text-xs text-muted-foreground">
                  {noteTarget.kind === 'order'
                    ? 'Berlaku untuk seluruh pesanan'
                    : noteTarget.name}
                </p>
              </div>
              <button
                onClick={() => setNoteTarget(null)}
                className="p-1 text-muted-foreground hover:text-foreground"
                aria-label="Tutup"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <textarea
              autoFocus
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value.slice(0, 200))}
              onKeyDown={(e) => {
                // Enter saves; Shift+Enter for a second line.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  saveNote();
                } else if (e.key === 'Escape') {
                  setNoteTarget(null);
                }
              }}
              rows={3}
              placeholder="cth. jangan pedas, es sedikit"
              className="mt-2 w-full resize-none rounded-xl border-2 bg-background p-3 text-sm outline-none focus:border-blue-500"
            />
            <p className="mt-1 text-right text-[11px] text-muted-foreground">
              {noteDraft.length}/200
            </p>

            <div className="mt-3 flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setNoteTarget(null)}
                className="h-11 flex-1 rounded-xl border-2 font-bold"
              >
                Batal
              </Button>
              <Button
                type="button"
                onClick={saveNote}
                className="h-11 flex-1 rounded-xl bg-blue-600 font-bold hover:bg-blue-700"
              >
                Simpan
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile backdrop */}
      {cartOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setCartOpen(false)}
        />
      )}

      {/* Mobile bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 z-20 p-3 bg-background/95 backdrop-blur-sm border-t md:hidden">
        <button
          onClick={() => setCartOpen(true)}
          className="w-full h-14 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-bold flex items-center justify-between px-5 shadow-lg transition-colors"
        >
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            <span className="text-sm">
              {cart.reduce((acc, item) => acc + item.quantity, 0)} items
            </span>
          </div>
          <span className="font-black">{formatCurrency(grandTotal)}</span>
        </button>
      </div>
    </div>
  );
};
