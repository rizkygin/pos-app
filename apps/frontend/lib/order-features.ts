import { Utensils, Coffee, Wrench, ShoppingBag, PackageOpen, Sparkles, Bike, Scissors, HardHat } from "lucide-react";

export type OrderFeature = {
    slug: string;
    label: string;
    category: string;
    description: string;
    icon: React.ElementType;
    gradient: string;
    iconBg: string;
    iconColor: string;
    badge?: string;
    /**
     * Optional artwork sitting in the bottom-right corner of the feature tile.
     *
     * Undefined — or a file that fails to load — falls back to the flat
     * `gradient` below, so a missing asset costs the tile its illustration and
     * nothing else. See `public/features/README.md` for the asset contract.
     */
    image?: string;
    isAvailable:boolean;
    color: string;
};


export const ORDER_FEATURES: OrderFeature[] = [
    {
        slug: "food",
        category: "makanan",
        label: "Layanan Makan",
        description: "Makanan lezat dari restoran & warung terdekat",
        icon: Utensils,
        gradient: "from-rose-50 to-orange-50",
        iconBg: "bg-rose-100",
        iconColor: "text-rose-600",
        badge: "Terpopuler",
        image: "/features/food.svg",
        isAvailable: true,
        color: "text-rose-600"
    },
    {
        slug: "drink",
        category: "minuman",
        label: "Layanan Minum",
        description: "Kopi, teh, jus, dan minuman segar lainnya",
        icon: Coffee,
        gradient: "from-amber-50 to-yellow-50",
        iconBg: "bg-amber-100",
        iconColor: "text-amber-700",
        image: "/features/drink.svg",
        isAvailable: true,
        color: 'text-amber-700'
    },
    {
        slug: "service",
        category: "jasa",
        label: "Layanan Jasa",
        description: "Servis rumah tangga, reparasi, dan kebutuhan teknis",
        icon: Wrench,
        gradient: "from-blue-50 to-sky-50",
        iconBg: "bg-blue-100",
        iconColor: "text-blue-600",
        image: "/features/service.svg",
        isAvailable: true,
        color: "text-orange-600"
    },
    {
        slug: "mart",
        category: 'mart',
        label: "Belanja",
        description: "Kebutuhan sehari-hari, sembako, dan produk rumah",
        icon: ShoppingBag,
        gradient: "from-emerald-50 to-teal-50",
        iconBg: "bg-emerald-100",
        iconColor: "text-emerald-600",
        badge: "Baru",
        image: "/features/mart.svg",
        isAvailable: true,
        color: "text-emerald-600"
    },
    {
        slug: "delivery",
        category: 'antar',
        label: "Kirim Paket",
        description: "Pengiriman cepat ke seluruh kota",
        icon: PackageOpen,
        gradient: "from-violet-50 to-purple-50",
        iconBg: "bg-violet-100",
        iconColor: "text-violet-600",
        isAvailable: false,
        color: "text-violet-600"
    },
    {
        slug: "beauty",
        category: 'kecantikan',
        label: "Kecantikan & Spa",
        description: "Salon, barbershop, perawatan tubuh & kecantikan",
        icon: Scissors,
        gradient: "from-pink-50 to-fuchsia-50",
        iconBg: "bg-pink-100",
        iconColor: "text-pink-600",
        isAvailable: false,
        color: 'text-violet-600'
    },
    {
        slug: "ride",
        category: 'sewa kendaraan',
        label: "Sewa Kendaraan",
        description: "Motor, mobil, dan ojek instan di sekitarmu",
        icon: Bike,
        gradient: "from-cyan-50 to-sky-50",
        iconBg: "bg-cyan-100",
        iconColor: "text-cyan-600",
        isAvailable: false,
        color: 'text-cyan-600'
    },
    {
        slug: "entertainment",
        category: 'hiburan',
        label: "Hiburan & Aktivitas",
        description: "Tiket, workshop, event, dan pengalaman seru",
        icon: Sparkles,
        gradient: "from-indigo-50 to-blue-50",
        iconBg: "bg-indigo-100",
        iconColor: "text-indigo-600",
        badge: "Segera",
        isAvailable: false,
        color: 'text-indigo-600'
    },
    {
        slug: "building-materials",
        category: 'bahan bangunan',
        label: "Bahan Bangunan",
        description: "Semen, cat, besi, keramik, dan material konstruksi",
        icon: HardHat,
        gradient: "from-orange-50 to-amber-50",
        iconBg: "bg-orange-100",
        iconColor: "text-orange-600",
        image: "/features/building-materials.svg",
        isAvailable: true,
        color: "text-orange-600"
    },
];
