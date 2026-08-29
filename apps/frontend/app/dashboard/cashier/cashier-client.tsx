'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { ReceiptModal, type ReceiptData } from '@/components/dashboard/receipt-modal';
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/utils/format';
import { API_URL } from '@/lib/api-url';
import { resolveProductImage, isBackendImage } from '@/lib/image-src';

type Product = {
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
};

type CartItem = {
  product: Product;
  quantity: number;
  /**
   * Kitchen instruction for this line ("jangan pedas", "es sedikit"). Lives in
   * the held tab only — it's prep guidance for the next ten minutes, printed on
   * the kitchen ticket and then gone. Never sent to the backend.
   */
  note?: string;
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
  paymentMethod: 'cash' | 'non_cash';
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
  initialProducts: Product[];
};

// Ceiling on a hand-typed quantity: four digits is far past any real counter
// sale, and it keeps a fat-fingered paste from turning the order total into
// nonsense. The +/- buttons are unbounded as before.
const MAX_QUANTITY = 9999;

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
  initialProducts,
}: CashierClientProps) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  // Dedicated barcode field — separate from the name search above, since a
  // scanner (or a cashier typing a code) means "find this EXACT item", not
  // "filter the grid". Enter/scan looks it up and adds it straight to cart.
  const [barcodeQuery, setBarcodeQuery] = useState('');
  const [barcodeFeedback, setBarcodeFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  // Two refs, not one: the mobile and desktop barcode inputs below are both
  // mounted at once (toggled by CSS breakpoint classes, not conditional
  // rendering) — a single ref would only ever point at whichever renders
  // last in JSX order.
  const barcodeInputMobileRef = useRef<HTMLInputElement>(null);
  const barcodeInputDesktopRef = useRef<HTMLInputElement>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
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
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'non_cash'>(
    'cash',
  );
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
      const count = t
        ? t.cart.reduce((acc, i) => acc + i.quantity, 0)
        : 0;
      if (
        count > 0 &&
        !window.confirm('Tutup tab ini? Keranjang yang belum dibayar akan hilang.')
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

  // After a paid checkout, drop the tab and move to the next (or a fresh one).
  const completeActiveTab = useCallback(() => {
    const remaining = tabsRef.current.filter((t) => t.id !== activeIdRef.current);
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
  // 'bahan' gets no tab regardless of grouping: raw ingredients are stock
  // material, not something rung up at the POS.
  const categories = useMemo(() => {
    const groups = new Map<string, number>(); // section name -> sort_order
    const loose = new Set<string>();

    for (const p of initialProducts) {
      if (p.category === 'bahan') continue;
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
  }, [initialProducts]);

  // What a product files under in the tabs above — its section if it has one.
  const tabKeyOf = (p: Product) => p.menu_group ?? p.category;

  const filteredProducts = useMemo(() => {
    return initialProducts.filter((product) => {
      // 'bahan' products never appear at the POS (no tab either — see the
      // categories memo): ingredients are consumed via recipes, not sold.
      // Matched on the same key the tabs are built from, or selecting a section
      // like "Besi" would compare against a value no product carries.
      const matchesCategory =
        selectedCategory === 'All'
          ? product.category !== 'bahan'
          : product.category !== 'bahan' && tabKeyOf(product) === selectedCategory;
      const matchesSearch = product.product_name
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [initialProducts, selectedCategory, searchQuery]);

  // Cart operations
  const addToCart = (product: Product) => {
    if (!product.isAvailable) return;

    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const handleBarcodeScan = (source: React.RefObject<HTMLInputElement | null>) => {
    const code = barcodeQuery.trim();
    if (!code) return;

    const match = initialProducts.find((p) => p.barcode && p.barcode === code);
    if (!match) {
      setBarcodeFeedback({ ok: false, text: `Barcode "${code}" tidak ditemukan.` });
    } else if (!match.isAvailable) {
      setBarcodeFeedback({ ok: false, text: `${match.product_name} sedang tidak tersedia.` });
    } else {
      addToCart(match);
      setBarcodeFeedback({ ok: true, text: `${match.product_name} ditambahkan.` });
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

  const updateQuantity = (productId: string, delta: number) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.product.id === productId) {
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
  const [qtyDraft, setQtyDraft] = useState<{ id: string; value: string } | null>(
    null,
  );
  // Escape cancels. Set at keydown and read on the blur it triggers, because
  // the input's DOM value still holds the draft at that point.
  const qtyCancelledRef = useRef(false);

  const setQuantity = (productId: string, raw: string) => {
    setQtyDraft(null);
    const parsed = parseInt(raw, 10);
    // Blank or junk means "never mind" — keep the previous quantity instead of
    // silently dropping the line. Trash is what the button is for.
    if (!Number.isFinite(parsed) || parsed < 1) return;
    setCart((prev) =>
      prev.map((item) =>
        item.product.id === productId
          ? { ...item, quantity: Math.min(parsed, MAX_QUANTITY) }
          : item,
      ),
    );
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
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
      id: item.product.id,
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
          item.product.id === id ? { ...item, note: value || undefined } : item,
        ),
      );
    }
    setNoteTarget(null);
    setNoteDraft('');
  };

  // Calculations
  const cartTotal = cart.reduce((total, item) => {
    const price =
      item.product.price_mark_down && item.product.price_mark_down !== '0'
        ? parseFloat(item.product.price_mark_down)
        : parseFloat(item.product.price);
    return total + price * item.quantity;
  }, 0);

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
  const finalTotal = cartTotal - discountAmount;

  // Lazy mode pays the exact amount due, so change is always 0 and the payment
  // can never be insufficient.
  const amountPaid = lazyMode ? finalTotal : parseFloat(amountPaidInput) || 0;
  const changeDue = Math.max(0, amountPaid - finalTotal);
  const isInsufficient =
    !lazyMode &&
    paymentMethod === 'cash' &&
    amountPaidInput.trim() !== '' &&
    amountPaid < finalTotal;
  const checkoutDisabled = cart.length === 0 || isInsufficient;

  // Two live orders on one buzzer is exactly the mix-up the number is meant to
  // prevent, so surface the clash instead of silently allowing it.
  const pagerClash = useMemo(() => {
    const n = pagerNumber.trim();
    if (!n) return false;
    return tabs.some((t) => t.id !== activeTabId && t.pagerNumber.trim() === n);
  }, [pagerNumber, tabs, activeTabId]);

  // Shared slip payload. Before checkout there's no server order id yet, so the
  // active tab's id stands in — stable across reprints of the same tab, which
  // keeps a reprinted struk matching the first one. It is NOT the final order
  // number: that's only minted when Checkout posts the order.
  const buildReceiptData = useCallback(
    (): ReceiptData => ({
      orderId: activeTabId || crypto.randomUUID(),
      customerName: customerName.trim(),
      pagerNumber: pagerNumber.trim(),
      orderNote: orderNote.trim(),
      items: cart.map((i) => ({
        product_name: i.product.product_name,
        quantity: i.quantity,
        price: i.product.price,
        price_mark_down: i.product.price_mark_down,
        note: i.note,
      })),
      subtotal: cartTotal,
      discountAmount,
      discountLabel,
      total: finalTotal,
      paymentMethod,
      amountPaid:
        paymentMethod === 'cash' && amountPaid > 0 ? amountPaid : finalTotal,
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
      finalTotal,
      paymentMethod,
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
    const snapshotFinalTotal = finalTotal;
    const snapshotCustomerName = customerName.trim();
    const snapshotPagerNumber = pagerNumber.trim();
    const snapshotPaymentMethod = paymentMethod;
    const snapshotAmountPaid =
      snapshotPaymentMethod === 'cash' && amountPaid > 0
        ? amountPaid
        : snapshotFinalTotal;
    const snapshotChangeDue = Math.max(0, snapshotAmountPaid - snapshotFinalTotal);
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
          })),
          subtotal: snapshotTotal,
          discountAmount: snapshotDiscountAmount,
          discountLabel: snapshotDiscountLabel,
          total: snapshotFinalTotal,
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
            <p className={`text-xs mb-1 md:hidden ${barcodeFeedback.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
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
                <p className={`text-xs ${barcodeFeedback.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
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
                const inCart =
                  cart.find((item) => item.product.id === product.id)
                    ?.quantity || 0;

                return (
                  <button
                    key={product.id}
                    onClick={() => addToCart(product)}
                    disabled={!product.isAvailable}
                    className={`group relative flex flex-col text-left bg-background rounded-2xl overflow-hidden border-2 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 ${
                      !product.isAvailable
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
                        {!product.isAvailable && (
                          <span className="bg-rose-500/90 backdrop-blur text-white text-[10px] font-black uppercase px-2.5 py-1 rounded-full shadow-sm">
                            Out of Stock
                          </span>
                        )}
                        {isDiscounted && product.isAvailable && (
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
                          {isDiscounted && (
                            <span className="text-[10px] md:text-xs text-muted-foreground line-through decoration-rose-500/50">
                              {formatCurrency(Number(product.price))}
                            </span>
                          )}
                          <span className="font-extrabold text-blue-600 text-sm md:text-base">
                            {formatCurrency(Number(displayPrice))}
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
            const activePager = activeTab?.pagerNumber.trim();
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
                          number, this list is what gets scanned. */}
                      <span
                        className={`flex h-6 w-8 shrink-0 items-center justify-center rounded-md text-xs font-black tabular-nums ${
                          t.pagerNumber.trim()
                            ? 'bg-blue-600 text-white'
                            : 'bg-muted text-muted-foreground/50'
                        }`}
                      >
                        {t.pagerNumber.trim() || '--'}
                      </span>
                      <span className="flex-1 truncate">{label}</span>
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
        <div className="p-4 border-b bg-background/80 backdrop-blur-md sticky top-0 z-20">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {/* The pager box takes the slot the decorative cart icon used to
                  occupy, so the number is always on screen without costing a
                  row in an already-tight sidebar. */}
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
                    setPagerNumber(e.target.value.replace(/\D/g, '').slice(0, 3))
                  }
                  placeholder="--"
                  className="w-8 bg-transparent text-center text-base font-black tabular-nums outline-none placeholder:font-bold placeholder:text-muted-foreground/50"
                />
              </label>
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
            <div className="flex shrink-0 flex-col items-stretch gap-1">
              {cart.length > 0 && (
                <button
                  onClick={clearCart}
                  className="text-xs font-bold text-rose-500 hover:text-rose-600 hover:bg-rose-50 px-3 py-1.5 rounded-lg transition-colors"
                >
                  Clear
                </button>
              )}
              <button
                onClick={openOrderNote}
                className={`flex items-center justify-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                  orderNote.trim()
                    ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
                title="Catatan pesanan (dapur)"
              >
                <StickyNote className="h-3.5 w-3.5" />
                Catatan
              </button>
            </div>
          </div>
          {pagerClash && (
            <p className="mt-1 text-[11px] font-semibold text-rose-500">
              Pager {pagerNumber.trim()} sedang dipakai tab lain.
            </p>
          )}
          {orderNote.trim() && (
            <p className="mt-1 line-clamp-2 rounded-lg bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
              {orderNote}
            </p>
          )}
        </div>

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
                  key={item.product.id}
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
                          onClick={() => removeFromCart(item.product.id)}
                          className="text-muted-foreground hover:text-rose-500 transition-colors p-1"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    {item.note && (
                      <p className="mt-1 line-clamp-2 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">
                        {item.note}
                      </p>
                    )}

                    <div className="flex items-center justify-between mt-2">
                      <span className="font-bold text-blue-600 text-sm">
                        {formatCurrency(Number(displayPrice))}
                      </span>

                      {/* Quantity Controls */}
                      <div className="flex items-center gap-3 bg-background border rounded-lg p-1 shadow-sm">
                        <button
                          onClick={() => updateQuantity(item.product.id, -1)}
                          className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground transition-colors"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <input
                          type="text"
                          inputMode="numeric"
                          aria-label={`Jumlah ${item.product.product_name}`}
                          value={
                            qtyDraft?.id === item.product.id
                              ? qtyDraft.value
                              : String(item.quantity)
                          }
                          onFocus={(e) => {
                            setQtyDraft({
                              id: item.product.id,
                              value: String(item.quantity),
                            });
                            // Select-all so the cashier can just type over it.
                            e.currentTarget.select();
                          }}
                          onChange={(e) =>
                            setQtyDraft({
                              id: item.product.id,
                              value: e.target.value.replace(/\D/g, '').slice(0, 4),
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
                            setQuantity(item.product.id, e.target.value);
                          }}
                          className="w-10 h-6 text-sm font-bold text-center bg-transparent rounded-md outline-none transition-colors focus:bg-muted focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                          onClick={() => updateQuantity(item.product.id, 1)}
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

        {/* Checkout Section */}
        <div className="p-4 bg-background border-t shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.1)]">
          <div className="space-y-1.5 mb-3">
            <div className="flex justify-between text-muted-foreground text-sm font-medium">
              <span>Subtotal</span>
              <span>{formatCurrency(Number(cartTotal))}</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-muted-foreground text-sm font-medium">
              <div className="flex items-center gap-1.5">
                <span>Discount</span>
                <div className="flex items-center rounded-lg border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setDiscountType('percentage')}
                    className={`px-2 py-0.5 text-[11px] font-bold transition-colors ${
                      discountType === 'percentage'
                        ? 'bg-blue-600 text-white'
                        : 'bg-background text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    %
                  </button>
                  <button
                    type="button"
                    onClick={() => setDiscountType('amount')}
                    className={`px-2 py-0.5 text-[11px] font-bold transition-colors ${
                      discountType === 'amount'
                        ? 'bg-blue-600 text-white'
                        : 'bg-background text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    Rp
                  </button>
                </div>
                <input
                  type="number"
                  min={0}
                  max={discountType === 'percentage' ? 100 : undefined}
                  value={discountInput}
                  onChange={(e) => setDiscountInput(e.target.value)}
                  placeholder="0"
                  className="w-16 h-7 px-2 rounded-lg border bg-background text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <span
                className={discountAmount > 0 ? 'text-rose-500 font-semibold' : ''}
              >
                {discountAmount > 0 ? '-' : ''}
                {formatCurrency(discountAmount)}
              </span>
            </div>
            <div className="h-px w-full bg-border my-1.5" />
            <div className="flex justify-between items-end">
              <span className="text-base font-bold">Total</span>
              <span className="text-2xl font-black text-blue-600 tracking-tight">
                {formatCurrency(Number(finalTotal))}
              </span>
            </div>
          </div>

          {/* Lazy mode toggle — device-local preference. When on, cash received
              is auto-set to the exact amount due and the entry box is hidden. */}
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border bg-muted/30 px-3 py-2">
            <div className="flex flex-col">
              <span className="text-sm font-semibold">Lazy Mode</span>
              <span className="text-[11px] text-muted-foreground">
                Uang pas otomatis, tanpa hitung kembalian
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={lazyMode}
              aria-label="Lazy mode"
              onClick={toggleLazyMode}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                lazyMode ? 'bg-blue-600' : 'bg-muted-foreground/30'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  lazyMode ? 'translate-x-5' : ''
                }`}
              />
            </button>
          </div>

          {/* Cash tendered/change only makes sense for a cash sale the cashier
              actually counts: lazy mode assumes uang pas, and a non-cash sale
              has nothing to tender. */}
          {!lazyMode && paymentMethod === 'cash' && (
            <div className="mb-3 space-y-2 rounded-xl border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-semibold text-muted-foreground">
                  Cash Received
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={amountPaidInput && Number(amountPaidInput) > 0 ? formatCurrency(Number(amountPaidInput)) : ''}
                  onChange={(e) => setAmountPaidInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="Rp 0"
                  className="w-36 h-9 px-3 rounded-lg border bg-background text-right text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-muted-foreground">
                  {isInsufficient ? 'Shortfall' : 'Change'}
                </span>
                <span
                  className={`text-sm font-bold ${isInsufficient ? 'text-rose-500' : 'text-emerald-600'}`}
                >
                  {formatCurrency(isInsufficient ? finalTotal - amountPaid : changeDue)}
                </span>
              </div>
            </div>
          )}

          {paymentMethod === 'non_cash' && (
            <div className="mb-3 flex items-center justify-between rounded-lg bg-blue-50 px-3 py-2">
              <span className="text-xs font-bold text-blue-600">
                Non-cash payment selected
              </span>
              <button
                type="button"
                onClick={() => setPaymentMethod('cash')}
                className="text-xs font-bold text-blue-600 underline underline-offset-2 hover:text-blue-700"
              >
                Undo
              </button>
            </div>
          )}

          {/* Pay-first flow: take the money and print both slips while the tab
              stays open, so the pager number and notes remain on screen until
              the food is handed over. Checkout below is what ends the order. */}
          <div className="mb-2 flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={printCustomerReceipt}
              disabled={checkoutDisabled}
              className="h-11 flex-1 rounded-2xl border-2 text-sm font-bold"
            >
              <Printer className="mr-1.5 h-4 w-4" />
              Struk
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={printKitchenTicket}
              disabled={cart.length === 0}
              className="h-11 flex-1 rounded-2xl border-2 text-sm font-bold"
            >
              <ChefHat className="mr-1.5 h-4 w-4" />
              Dapur
            </Button>
          </div>

          <div className="flex gap-2">
            {isInsufficient && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setPaymentMethod('non_cash')}
                className="h-12 shrink-0 rounded-2xl border-2 px-4 text-sm font-bold"
              >
                Non-Cash
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
          <span className="font-black">
            {formatCurrency(finalTotal)}
          </span>
        </button>
      </div>
    </div>
  );
};
