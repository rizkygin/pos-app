'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { Loader2, Megaphone, Image as ImageIcon, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  createAdAction,
  deleteAdAction,
  toggleAdActiveAction,
  uploadAdBanner,
  type DisplayAs,
} from './actions';

type Product = {
  id: string;
  product_name: string;
  image: string;
};

type Ad = {
  id: number;
  product_id: string;
  product_name: string;
  title: string;
  description: string;
  banner_image: string;
  status: 'pending' | 'approved' | 'rejected';
  is_active: boolean;
  rejection_reason: string | null;
};

type PromoteManagerProps = {
  products: Product[];
  ads: Ad[];
};

function getBannerSrc(image: string): string {
  if (!image) return '/avatar.png';
  if (image.startsWith('http') || image.startsWith('/')) return image;
  return `/ads/${image}`;
}

const STATUS_LABEL: Record<Ad['status'], string> = {
  pending: 'Menunggu Persetujuan',
  approved: 'Disetujui',
  rejected: 'Ditolak',
};

const STATUS_CLASS: Record<Ad['status'], string> = {
  pending: 'text-amber-700 bg-amber-50',
  approved: 'text-emerald-700 bg-emerald-50',
  rejected: 'text-rose-700 bg-rose-50',
};

const DISPLAY_AS_LABEL: Record<DisplayAs, string> = {
  'once a week': 'Setiap minggu (rutin)',
  'only 1 day': 'Sekali tampil',
  'only weekend': 'Akhir pekan (Sabtu & Minggu)',
  'only weekdays': 'Hari kerja (Senin - Jumat)',
};

const DAY_OPTIONS = [
  { value: 'sunday', label: 'Minggu' },
  { value: 'monday', label: 'Senin' },
  { value: 'tuesday', label: 'Selasa' },
  { value: 'wednesday', label: 'Rabu' },
  { value: 'thursday', label: 'Kamis' },
  { value: 'friday', label: 'Jumat' },
  { value: 'saturday', label: 'Sabtu' },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => {
  const value = String(i + 1).padStart(2, '0');
  return { value, label: `${value}:00` };
});

export const PromoteManager = ({ products, ads }: PromoteManagerProps) => {
  const [productId, setProductId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [displayAs, setDisplayAs] = useState<DisplayAs>('once a week');
  const [day, setDay] = useState('monday');
  const [hourStart, setHourStart] = useState('08');
  const [hourEnd, setHourEnd] = useState('17');
  const [duration, setDuration] = useState(1);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const needsDay = displayAs === 'once a week' || displayAs === 'only 1 day';
  const needsDuration = displayAs === 'only weekend' || displayAs === 'only weekdays';

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size >= 1000000) {
      alert('Image size must be less than 1MB.');
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append('image', file);
    const result = await uploadAdBanner(formData);
    setIsUploading(false);

    if (result.success && result.imageUrl) {
      setBannerUrl(result.imageUrl);
    } else {
      alert(result.message);
    }
  };

  const resetForm = () => {
    setProductId('');
    setTitle('');
    setDescription('');
    setBannerUrl('');
    setDisplayAs('once a week');
    setDay('monday');
    setHourStart('08');
    setHourEnd('17');
    setDuration(1);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId || !title || !bannerUrl) {
      alert('Pilih produk, isi judul, dan unggah banner terlebih dahulu.');
      return;
    }
    if (Number(hourStart) > Number(hourEnd)) {
      alert('Jam mulai harus lebih awal dari jam selesai.');
      return;
    }

    setIsSubmitting(true);
    const result = await createAdAction({
      product_id: productId,
      title,
      description,
      banner_image: bannerUrl,
      display_as: displayAs,
      day: needsDay ? day : undefined,
      hour_start: hourStart,
      hour_end: hourEnd,
      duration: needsDuration ? duration : undefined,
    });
    setIsSubmitting(false);

    if (result.success) {
      resetForm();
    } else {
      alert(result.message);
    }
  };

  const handleToggleActive = async (ad: Ad, value: boolean) => {
    const result = await toggleAdActiveAction(ad.id, value);
    if (!result.success) {
      alert(result.message);
    }
  };

  const handleDelete = async (ad: Ad) => {
    if (!window.confirm('Yakin pian handak hapus iklan ini?')) return;
    const result = await deleteAdAction(ad.id);
    if (!result.success) {
      alert(result.message);
    }
  };

  return (
    <div className="space-y-8">
      <div className="bg-background border rounded-2xl md:rounded-3xl p-4 md:p-8 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-rose-500 to-amber-500" />

        <div className="flex items-center gap-4 mb-6">
          <div className="p-3 rounded-xl bg-rose-50 text-rose-600">
            <Megaphone className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-xl md:text-2xl font-bold tracking-tight">Buat Iklan Baru</h2>
            <p className="text-muted-foreground text-sm font-medium">
              Pilih produk, beri judul menarik, dan unggah banner.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-bold">Produk</label>
            <select
              required
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="flex h-12 w-full rounded-xl border border-input bg-transparent px-4 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
            >
              <option value="">Pilih produk...</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.product_name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold">Judul Iklan</label>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={255}
              className="flex h-12 w-full rounded-xl border border-input bg-transparent px-4 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
              placeholder="e.g. Promo Spesial Hari Ini!"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold">Deskripsi</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              className="flex min-h-[80px] w-full rounded-xl border border-input bg-transparent px-4 py-3 text-sm shadow-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
              placeholder="Jelaskan promo pian secara singkat..."
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold">Jadwal Tampil</label>
            <select
              value={displayAs}
              onChange={(e) => setDisplayAs(e.target.value as DisplayAs)}
              className="flex h-12 w-full rounded-xl border border-input bg-transparent px-4 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
            >
              {Object.entries(DISPLAY_AS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {needsDay && (
            <div className="space-y-2">
              <label className="text-sm font-bold">Hari</label>
              <select
                value={day}
                onChange={(e) => setDay(e.target.value)}
                className="flex h-12 w-full rounded-xl border border-input bg-transparent px-4 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
              >
                {DAY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-bold">Jam Mulai</label>
              <select
                value={hourStart}
                onChange={(e) => setHourStart(e.target.value)}
                className="flex h-12 w-full rounded-xl border border-input bg-transparent px-4 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
              >
                {HOUR_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-bold">Jam Selesai</label>
              <select
                value={hourEnd}
                onChange={(e) => setHourEnd(e.target.value)}
                className="flex h-12 w-full rounded-xl border border-input bg-transparent px-4 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
              >
                {HOUR_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {needsDuration && (
            <div className="space-y-2">
              <label className="text-sm font-bold">
                Berapa {displayAs === 'only weekend' ? 'akhir pekan' : 'minggu'}?
              </label>
              <input
                type="number"
                min={1}
                value={duration}
                onChange={(e) => setDuration(Math.max(1, Number(e.target.value)))}
                className="flex h-12 w-full rounded-xl border border-input bg-transparent px-4 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
              />
              <span className="text-xs text-muted-foreground">
                Iklan akan tampil selama {duration}{' '}
                {displayAs === 'only weekend' ? 'akhir pekan' : 'minggu'} berturut-turut.
              </span>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-bold flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
              Banner Iklan
            </label>
            <span className="text-xs text-muted-foreground">
              Ukuran File Maksimal 1 MB. Disarankan rasio lebar (1200x500).
            </span>
            {bannerUrl ? (
              <div className="relative w-full aspect-[12/5] rounded-xl overflow-hidden border">
                <Image src={getBannerSrc(bannerUrl)} fill className="object-cover" alt="Banner Preview" />
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="absolute top-2 right-2 rounded-xl shadow-md"
                  onClick={() => {
                    setBannerUrl('');
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                >
                  Remove
                </Button>
              </div>
            ) : isUploading ? (
              <div className="flex items-center justify-center w-full h-32 border-2 border-dashed rounded-xl border-rose-200 bg-rose-50/50">
                <Loader2 className="h-6 w-6 animate-spin text-rose-500" />
              </div>
            ) : (
              <input
                type="file"
                accept="image/*"
                ref={fileInputRef}
                onChange={handleImageUpload}
                className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-xl border-rose-200 bg-rose-50/50 hover:bg-rose-50 transition-colors text-rose-600 font-bold p-4 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-rose-50 file:text-rose-700 hover:file:bg-rose-100"
              />
            )}
          </div>

          <div className="pt-2 flex justify-end">
            <Button
              type="submit"
              disabled={isSubmitting || isUploading}
              className="w-full sm:w-auto px-8 rounded-xl bg-rose-600 hover:bg-rose-700 h-12 text-md font-bold shadow-lg shadow-rose-600/20"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Mengirim...
                </>
              ) : (
                'Ajukan Iklan'
              )}
            </Button>
          </div>
        </form>
      </div>

      <div className="space-y-4">
        <h3 className="text-xl font-bold tracking-tight">Iklan Pian</h3>
        {ads.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-3xl bg-muted/10 text-center">
            <p className="text-muted-foreground">Belum ada iklan yang diajukan.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ads.map((ad) => (
              <div key={ad.id} className="rounded-2xl border bg-background overflow-hidden">
                <div className="relative w-full aspect-[12/5]">
                  <Image src={getBannerSrc(ad.banner_image)} fill className="object-cover" alt={ad.title} />
                </div>
                <div className="p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-bold leading-tight">{ad.title}</h4>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${STATUS_CLASS[ad.status]}`}>
                      {STATUS_LABEL[ad.status]}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{ad.product_name}</p>
                  {ad.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">{ad.description}</p>
                  )}
                  {ad.status === 'rejected' && ad.rejection_reason && (
                    <p className="text-xs text-rose-600 font-medium">
                      Alasan ditolak: {ad.rejection_reason}
                    </p>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t">
                    {ad.status === 'approved' ? (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={ad.is_active}
                          onClick={() => handleToggleActive(ad, !ad.is_active)}
                          className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ${ad.is_active ? 'bg-emerald-500' : 'bg-muted'}`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md ring-0 transition-transform duration-200 ${ad.is_active ? 'translate-x-5' : 'translate-x-0'}`}
                          />
                        </button>
                        <span className="text-xs font-bold text-muted-foreground">
                          {ad.is_active ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </label>
                    ) : (
                      <span />
                    )}
                    <button
                      onClick={() => handleDelete(ad)}
                      className="p-1.5 rounded-lg bg-muted/60 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
