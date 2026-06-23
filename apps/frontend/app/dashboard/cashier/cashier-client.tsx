'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { ReceiptModal, type ReceiptData } from './receipt-modal';
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/utils/format';

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
};

type CartItem = {
  product: Product;
  quantity: number;
};

type CashierClientProps = {
  outletId: number;
  outletName: string;
  outletAddress: string;
  outletPhone: string;
  cashierName: string;
  initialProducts: Product[];
};

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
  cashierName,
  initialProducts,
}: CashierClientProps) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [discountType, setDiscountType] = useState<'percentage' | 'amount'>(
    'percentage',
  );
  const [discountInput, setDiscountInput] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [amountPaidInput, setAmountPaidInput] = useState('0');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'non_cash'>(
    'cash',
  );

  const [categories, setCatagories] = useState(INITIAL_CATEGORIES);

  const fetchCategories = async () => {
    try {
      // GET requests cannot have a body, so we pass outletId as a query parameter
      const res = await fetch(`/api/get-categories?outletId=${outletId}`);
      if (!res.ok) {
        throw new Error('Failed to fetch categories');
      }
      const { data } = await res.json();

      const waitAllCategories = data?.map((category: any) => {
        return {
          id: category.category,
          label: category.category,
          icon: LayoutGrid,
          color: 'text-black-500 m-2',
          bg: 'bg-green-50',
          border: 'border-green-200',
        };
      });
      setCatagories([...INITIAL_CATEGORIES, ...waitAllCategories]);
    } catch (err) {
      console.error(err);
    }
  };
  // Fetch categories
  useEffect(() => {
    fetchCategories();
  }, []);

  const filteredProducts = useMemo(() => {
    return initialProducts.filter((product) => {
      const matchesCategory =
        selectedCategory === 'All' || product.category === selectedCategory;
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

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  const clearCart = () => {
    setCart([]);
    setDiscountInput('');
    setAmountPaidInput('0');
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

  const amountPaid = parseFloat(amountPaidInput) || 0;
  const changeDue = Math.max(0, amountPaid - finalTotal);
  const isInsufficient =
    paymentMethod === 'cash' &&
    amountPaidInput.trim() !== '' &&
    amountPaid < finalTotal;
  const checkoutDisabled = cart.length === 0 || isInsufficient;

  const handleCheckout = useCallback(async () => {
    if (cart.length === 0 || isInsufficient) return;
    // Capture snapshot before any async work so state changes mid-flight don't corrupt it
    const snapshot = [...cart];
    const snapshotTotal = cartTotal;
    const snapshotDiscountAmount = discountAmount;
    const snapshotDiscountLabel = discountLabel;
    const snapshotFinalTotal = finalTotal;
    const snapshotCustomerName = customerName.trim();
    const snapshotPaymentMethod = paymentMethod;
    const snapshotAmountPaid =
      snapshotPaymentMethod === 'cash' && amountPaid > 0
        ? amountPaid
        : snapshotFinalTotal;
    const snapshotChangeDue = Math.max(0, snapshotAmountPaid - snapshotFinalTotal);
    try {
      const response = await fetch('/api/add-order-detail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outletId,
          cart: snapshot,
          total: snapshotFinalTotal,
          customerName: snapshotCustomerName,
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
      clearCart();
      setCartOpen(false);
      setCustomerName('');
      setPaymentMethod('cash');
      setReceipt({
        orderId: data.orderId ?? crypto.randomUUID(),
        customerName: snapshotCustomerName,
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
        cashierName,
      });
    } catch (error: any) {
      alert(error.message);
    }
  }, [
    cart,
    cartTotal,
    amountPaid,
    customerName,
    discountAmount,
    discountLabel,
    finalTotal,
    isInsufficient,
    paymentMethod,
    outletId,
    outletName,
    outletAddress,
    outletPhone,
    cashierName,
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
          {/* Mobile: search only */}
          <div className="flex items-center gap-2 mb-2 md:hidden">
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
          </div>

          {/* Desktop: full header */}
          <div className="hidden md:flex flex-row gap-4 items-center justify-between">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight">
                Point of Sale
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                Select items to add to cart
              </p>
            </div>
            <div className="relative w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search products..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-11 pl-10 pr-4 rounded-xl border bg-background/80 shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none"
              />
            </div>
          </div>

          {/* Categories */}
          <div className="flex gap-2 md:gap-3 overflow-x-auto scrollbar-hide">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`flex items-center gap-1.5 md:gap-2 px-3 py-1.5 md:px-4 md:py-2.5 rounded-xl border-2 whitespace-nowrap transition-all duration-300 font-semibold text-xs md:text-sm ${
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
                          src={product.image}
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

        {/* Cart Header */}
        <div className="p-4 border-b bg-background/80 backdrop-blur-md sticky top-0 z-20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                <ShoppingCart className="h-5 w-5" />
              </div>
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
            {cart.length > 0 && (
              <button
                onClick={clearCart}
                className="text-xs font-bold text-rose-500 hover:text-rose-600 hover:bg-rose-50 px-3 py-1.5 rounded-lg transition-colors"
              >
                Clear
              </button>
            )}
          </div>
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
                        src={item.product.image}
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
                      <button
                        onClick={() => removeFromCart(item.product.id)}
                        className="text-muted-foreground hover:text-rose-500 transition-colors p-1"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

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
                        <span className="text-sm font-bold w-4 text-center">
                          {item.quantity}
                        </span>
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
              disabled={checkoutDisabled}
              className="h-12 flex-1 rounded-2xl text-lg font-bold shadow-xl shadow-blue-600/20 bg-blue-600 hover:bg-blue-700 transition-all hover:-translate-y-1 relative group"
            >
              <CreditCard className="mr-2 h-5 w-5" />
              Checkout Now
              <span className="absolute right-4 text-xs font-medium text-white/50 bg-white/10 px-2 py-1 rounded hidden lg:block group-hover:bg-white/20 transition-colors">
                ⌘ ↵
              </span>
            </Button>
          </div>
        </div>
      </div>

      {/* Receipt modal */}
      {receipt && (
        <ReceiptModal data={receipt} onClose={() => setReceipt(null)} />
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
