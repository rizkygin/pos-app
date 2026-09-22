import { Boxes, Calculator, CopyX, type LucideIcon } from "lucide-react";

// The list of guides, read by the index page. Each guide is its own static
// route under /dashboard/panduan/<slug>, so a new one is a folder with a
// page.tsx plus one entry here. Content lives in the page itself as JSX, not in
// MDX or a CMS: it describes screens that change with the code, so it should
// change in the same commit, and it adds no dependency to a build whose
// lockfile is deleted in Docker (the root Dockerfile's `rm -f package-lock.json`).
export type Guide = {
  slug: string;
  title: string;
  summary: string;
  category: GuideCategory;
  icon: LucideIcon;
};

export type GuideCategory = "Stok & Barang" | "Laporan & Keuangan" | "Kasir";

// Display order of the category groups on the index page.
export const guideCategories: GuideCategory[] = ["Stok & Barang", "Laporan & Keuangan", "Kasir"];

export const guides: Guide[] = [
  {
    slug: "stok",
    title: "Mengelola stok & opname",
    summary:
      "Apa yang menggerakkan stok, cara menghitung fisik lewat sesi opname yang boleh berhari-hari, dan kapan HPP perlu diisi sendiri.",
    category: "Stok & Barang",
    icon: Boxes,
  },
  {
    slug: "laba-kotor",
    title: "Cara laba kotor dihitung",
    summary:
      "Dari mana angka HPP di laporan berasal: kapan memakai Harga Beli, kapan memakai HPP rata-rata dari stok, dan kapan Rp 0.",
    category: "Laporan & Keuangan",
    icon: Calculator,
  },
  {
    slug: "transaksi-ganda",
    title: "Cara cek transaksi ganda",
    summary:
      "Menemukan penjualan kasir yang tercatat dua kali, membaca tandanya, dan membatalkan nota keduanya.",
    category: "Kasir",
    icon: CopyX,
  },
];

export function guidePath(slug: string) {
  return `/dashboard/panduan/${slug}`;
}
