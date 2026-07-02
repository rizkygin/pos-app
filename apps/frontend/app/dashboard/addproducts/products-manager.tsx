'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import {
  Plus,
  ArrowLeft,
  Coffee,
  Pizza,
  Cookie,
  Package,
  Layers,
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
} from 'lucide-react';
import QRCode from 'react-qr-code';
import { Button } from '@/components/ui/button';
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
import { ORDER_FEATURES } from '@/lib/order-features';
import { resolveProductImage, isBackendImage } from '@/lib/image-src';
import { formatNumberInput, parseNumberInput } from '@/lib/utils/format';

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
  stock: string;
  lowest_price?: string | null;
  highest_price?: string | null;
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
};

const CATEGORIES = ORDER_FEATURES.map((feature) => ({
  id: feature.slug,
  label: feature.label,
  category: feature.category,
  icon: feature.icon,
  isAvailable: feature.isAvailable,
})).sort((a, b) => Number(b.isAvailable) - Number(a.isAvailable));

export const ProductsManager = ({
  outletId,
  initialProducts,
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
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // Inventory list filters
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const productCategories = useMemo(
    () =>
      Array.from(
        new Set(initialProducts.map((p) => p.category).filter(Boolean)),
      ),
    [initialProducts],
  );
  const filteredProducts = useMemo(
    () =>
      initialProducts.filter((p) => {
        const matchesSearch = p.product_name
          .toLowerCase()
          .includes(search.toLowerCase());
        const matchesCategory =
          categoryFilter === 'all' || p.category === categoryFilter;
        return matchesSearch && matchesCategory;
      }),
    [initialProducts, search, categoryFilter],
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
  });

  // Service products (category "jasa") are priced as a negotiable range instead
  // of a fixed selling price + discount.
  const isServiceCategory = selectedCategory === 'jasa';

  const handleCategorySelect = (category: string) => {
    setSelectedCategory(category);
    setIsForSale(false);
    setTrackStock(false);
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

    let result;
    if (editingProductId) {
      result = await updateProductAction(editingProductId, {
        ...formData,
        category: selectedCategory,
        image: imageUrl,
        features: selectedFeatures,
        is_for_sale: isForSale,
        track_stock: trackStock,
      });
    } else {
      result = await addProductAction({
        ...formData,
        category: selectedCategory,
        outlet_id: outletId,
        image: imageUrl,
        features: selectedFeatures,
        is_for_sale: isForSale,
        track_stock: trackStock,
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
    setEditingProductId(product.id);
    setSelectedCategory(product.category);
    setFormData({
      product_name: product.product_name,
      price: product.price,
      price_mark_down: product.price_mark_down,
      buying_price: product.buying_price,
      description: product.description || '',
      unit: product.unit,
      lowest_price: product.lowest_price ?? '',
      highest_price: product.highest_price ?? '',
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
                Manajemen Produk
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {initialProducts.length} produk · kelola harga, stok, &amp; ketersediaan.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setShareOpen(true)}
                className="rounded-xl border-border hover:bg-muted/50 transition-colors"
              >
                <Share2 className="mr-2 h-4 w-4" />
                Share Menu
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
                  });
                  setImageUrl('');
                  setSelectedFeatures([]);
                  setView('category');
                }}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-lg shadow-blue-600/20 transition-all hover:scale-105"
              >
                <Plus className="mr-2 h-5 w-5" />
                Tambah Produk
              </Button>
            </div>
          </div>

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
              {/* Toolbar: search + category filter */}
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center mb-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Cari produk…"
                    className="h-11 w-full rounded-xl border border-input bg-transparent pl-10 pr-4 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  />
                </div>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="h-11 rounded-xl border border-input bg-background px-3 text-sm shadow-sm capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <option value="all">Semua kategori</option>
                  {productCategories.map((c) => (
                    <option key={c} value={c} className="capitalize">
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Inventory table */}
              <div className="rounded-2xl border bg-background overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2.5 font-semibold">Produk</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Harga</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Stok</th>
                        <th className="hidden md:table-cell px-3 py-2.5 font-semibold">Status</th>
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
                                  <span className="text-[11px] text-muted-foreground capitalize">
                                    {product.category || '—'}
                                    {!product.is_for_sale && ' · inventaris'}
                                  </span>
                                </div>
                              </div>
                            </td>
                            {/* Harga */}
                            <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                              {isService ? (
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
                            {/* Status */}
                            <td className="hidden md:table-cell px-3 py-2.5">
                              <span
                                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                  product.isAvailable
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : 'bg-rose-50 text-rose-600'
                                }`}
                              >
                                {product.isAvailable ? 'Aktif' : 'Nonaktif'}
                              </span>
                            </td>
                            {/* Aksi */}
                            <td className="px-3 py-2.5">
                              <div className="flex items-center justify-end gap-1">
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
                            colSpan={5}
                            className="px-3 py-10 text-center text-sm text-muted-foreground"
                          >
                            Tidak ada produk yang cocok dengan pencarian.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
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
            {CATEGORIES.map((cat) => (
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

              <div className="grid grid-cols-2 gap-4 md:gap-6">
                {isServiceCategory ? (
                  <>
                    <div className="space-y-2">
                      <label className="text-sm font-bold flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                        Harga Terendah
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
                        Harga Tertinggi
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
                      Layanan jasa memakai rentang harga. Nanti pian pilih harga
                      pasti (di antara terendah &amp; tertinggi) saat menerima
                      order.
                    </p>
                  </>
                ) : (
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
                )}
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
                  className={`col-span-2 space-y-3 ${isServiceCategory ? 'hidden' : ''}`}
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
              </div>
              {isForSale && (
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
                        : 'Tanpa stok (resep/jasa)'}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {trackStock
                        ? 'Stok bertambah/berkurang lewat kasir, faktur & opname.'
                        : 'Produk olahan dari bahan, atau jasa — tidak dihitung stoknya.'}
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
