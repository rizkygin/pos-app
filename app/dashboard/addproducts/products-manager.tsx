'use client';

import { useState, useRef, useEffect } from 'react';
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
import { DashboardHeader } from '@/components/dashboard-header';
import { ORDER_FEATURES } from '@/lib/order-features';

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
};

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
  const [view, setView] = useState<'list' | 'category' | 'form'>('list');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasDiscount, setHasDiscount] = useState(false);
  const [imageUrl, setImageUrl] = useState<string>('');
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    product_name: '',
    price: '',
    price_mark_down: '',
    buying_price: '',
    description: '',
    unit: 'pcs',
  });

  const handleCategorySelect = (category: string) => {
    setSelectedCategory(category);
    setView('form');
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
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
      });
    } else {
      result = await addProductAction({
        ...formData,
        category: selectedCategory,
        outlet_id: outletId,
        image: imageUrl,
        features: selectedFeatures,
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
      });
      setImageUrl('');
      setEditingProductId(null);
      setSelectedFeatures([]);
      setView('list');
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
      console.log(result)
      if (!result?.success) {
        setImageUrl('');
      } else {
        setImageUrl(product.image);
      }
    }
    console.log(product.image);
    setHasDiscount(
      !!product.price_mark_down && product.price_mark_down !== '0',
    );
    setSelectedFeatures(product.features ?? []);
    setEditingProductId(product.id);
    setSelectedCategory(product.category);
    setFormData({
      product_name: product.product_name,
      price: product.price,
      price_mark_down: product.price_mark_down,
      buying_price: product.buying_price,
      description: product.description || '',
      unit: product.unit,
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
    }
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
      if (file.size >= 1000000) {
        alert('Image size must be less than 1MB.');
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
    console.log(imageUrl);
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
          <div className="flex items-center justify-between mb-4 md:mb-8">
            <div>
              <h2 className="text-xl md:text-3xl font-extrabold tracking-tight text-foreground">
                Your Products
              </h2>
              <p className="text-muted-foreground mt-1 text-sm md:text-base">
                Manage inventory across your outlet.
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
                  });
                  setImageUrl('');
                  setSelectedFeatures([]);
                  setView('category');
                }}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-lg shadow-blue-600/20 transition-all hover:scale-105"
              >
                <Plus className="mr-2 h-5 w-5" />
                Add Product
              </Button>
            </div>
          </div>

          {initialProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-3xl bg-muted/10">
              <div className="p-4 rounded-full bg-blue-50 text-blue-500 mb-4">
                <Package className="h-8 w-8" />
              </div>
              <h3 className="text-xl font-bold text-foreground">
                No Products Yet
              </h3>
              <p className="text-muted-foreground max-w-sm text-center mt-2 mb-6">
                Start building your inventory by adding your first product.
              </p>
              <Button
                onClick={() => setView('category')}
                variant="outline"
                className="rounded-xl border-dashed hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors"
              >
                Add Your First Product
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 lg:grid-cols-4 xl:grid-cols-5 md:gap-6">
              {initialProducts.map((product) => (
                <div
                  key={product.id}
                  className="group relative overflow-hidden rounded-xl md:rounded-2xl border bg-background p-2 md:p-5 transition-all hover:shadow-xl hover:border-blue-600/30 flex flex-col h-full"
                >
                  <div className="flex items-center justify-between mb-1.5 md:mb-2">
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[8px] md:text-[10px] font-bold uppercase tracking-wider ${product.isAvailable ? 'text-emerald-700 bg-emerald-50' : 'text-rose-700 bg-rose-50'}`}
                    >
                      {product.isAvailable ? 'In Stock' : 'Out'}
                    </span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleEdit(product)}
                        className="p-1 md:p-1.5 rounded-lg bg-muted/60 text-muted-foreground hover:text-blue-600 hover:bg-blue-50 transition-colors md:opacity-0 md:group-hover:opacity-100"
                      >
                        <Edit className="h-3 w-3 md:h-4 md:w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(product.id)}
                        disabled={isSubmitting}
                        className="p-1 md:p-1.5 rounded-lg bg-muted/60 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 transition-colors md:opacity-0 md:group-hover:opacity-100 disabled:opacity-50"
                      >
                        <Trash2 className="h-3 w-3 md:h-4 md:w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="relative aspect-[4/3] md:aspect-square rounded-lg md:rounded-xl bg-muted/30 mb-2 md:mb-4 flex items-center justify-center overflow-hidden border">
                    {product.image && product.image !== 'avatar.png' ? (
                      <Image
                        src={product.image}
                        fill
                        className="object-cover group-hover:scale-110 transition-transform duration-500"
                        alt={product.product_name}
                      />
                    ) : (
                      <Package className="h-6 w-6 md:h-12 md:w-12 text-muted-foreground/50 group-hover:scale-110 transition-transform duration-500" />
                    )}
                  </div>
                  <div className="flex-1 flex flex-col">
                    <span className="text-[8px] md:text-[10px] font-bold uppercase tracking-wider text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full w-fit mb-1">
                      {product.category}
                    </span>
                    <h3 className="font-bold text-[11px] md:text-lg leading-tight line-clamp-2 mb-1 md:mb-2 group-hover:text-blue-600 transition-colors">
                      {product.product_name}
                    </h3>
                    <div className="mt-auto pt-2 md:pt-4 flex flex-col gap-0.5 border-t border-muted/50 overflow-hidden">
                      <span className="text-xs md:text-xl font-extrabold tracking-tight truncate">
                        {new Intl.NumberFormat('id-ID', {
                          style: 'currency',
                          currency: 'IDR',
                          minimumFractionDigits: 0,
                        }).format(
                          Number(
                            product.price_mark_down &&
                              product.price_mark_down !== '0'
                              ? product.price_mark_down
                              : product.price,
                          ),
                        )}
                      </span>
                      {product.price_mark_down &&
                        product.price_mark_down !== '0' && (
                          <span className="text-[10px] md:text-sm font-medium text-muted-foreground line-through truncate">
                            {new Intl.NumberFormat('id-ID', {
                              style: 'currency',
                              currency: 'IDR',
                              minimumFractionDigits: 0,
                            }).format(Number(product.price))}
                          </span>
                        )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
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
                <span className={`font-bold text-sm md:text-lg relative z-10 transition-colors text-center ${
                  !cat.isAvailable ? 'text-muted-foreground' : 'text-foreground group-hover:text-blue-600'
                }`}>
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
                  {editingProductId ? 'Edit' : 'Add New'} {selectedCategory}
                </h2>
                <p className="text-muted-foreground text-sm font-medium">
                  Fill in the details below to{' '}
                  {editingProductId ? 'update' : 'add to'} your inventory.
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-bold flex items-center gap-2">
                  <Tag className="h-4 w-4 text-muted-foreground" />
                  Product Name
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
                      type="number"
                      value={formData.price}
                      onChange={handleInputChange}
                      className="flex h-12 w-full rounded-xl border border-input bg-transparent pl-12 pr-4 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      placeholder="25000"
                    />
                  </div>
                </div>
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
                      type="number"
                      value={formData.buying_price}
                      onChange={handleInputChange}
                      className="flex h-12 w-full rounded-xl border border-amber-200 bg-amber-50/30 pl-12 pr-4 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                      placeholder="15000"
                    />
                  </div>
                </div>
                <div className="col-span-2 space-y-3">
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
                        type="number"
                        value={formData.price_mark_down}
                        onChange={handleInputChange}
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

              <div className="space-y-2">
                <label className="text-sm font-bold flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                  Product Image
                </label>
                <span className="text-xs text-muted-foreground">
                  Ukuran File Maksimal 1 MB
                </span>
                {imageUrl ? (
                  <div className="relative w-full h-48 rounded-xl overflow-hidden border">
                    <Image
                      src={imageUrl}
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
                  value={typeof window !== 'undefined' ? `${window.location.origin}/menu/${outletId}` : ''}
                  size={160}
                />
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-xl border bg-muted/30 px-3 py-2.5">
              <p className="flex-1 truncate text-xs text-muted-foreground">
                {typeof window !== 'undefined' ? `${window.location.origin}/menu/${outletId}` : ''}
              </p>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(`${window.location.origin}/menu/${outletId}`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-blue-700"
              >
                {copied ? (
                  <><Check className="h-3.5 w-3.5" /> Copied!</>
                ) : (
                  <><Copy className="h-3.5 w-3.5" /> Copy</>
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
