export const CATEGORY_IN = [
    "Penjualan produk/jasa",
    "Pembayaran piutang pelanggan",
    "Uang muka/down payment dari customer",
    "Pendapatan layanan tambahan",
    "Komisi atau fee",
    "Modal pribadi owner",
    "Tambahan setoran modal partner/investor",
    "Pinjaman bank",
    "Pinjaman keluarga/teman",
    "Dana hibah atau bantuan pemerintah",
    "Penjualan kendaraan operasional",
    "Penjualan mesin/peralatan",
    "Penjualan stok lama/scrap",
    "Kasir",
    "Lain-lain",
] as const;

export const CATEGORY_OUT = [
    "Pembelian bahan baku",
    "Pembelian stok barang dagang",
    "Gaji karyawan",
    "Sewa tempat",
    "Listrik, air, internet",
    "Ongkos kirim",
    "Biaya packaging",
    "Biaya admin marketplace",
    "Iklan/marketing",
    "Transportasi operasional",
    "ATK dan perlengkapan kantor",
    "Maintenance/perbaikan kecil",
    "Cicilan Pinjaman",
    "Prive Owner (Uang Owner yang dipakai sebelumnya)",
    "Pengembalian modal investor",
    "Pengeluaran Darurat",
    "Biaya Notaris atau badan hukum",
    "Pembelian Mesin / Asset",
    "BPJS Karyawan",
    "Lain-lain",
] as const;

/**
 * What the Buku Kas form offers for hand entry: a few everyday categories up
 * front, the rest grouped behind "Lainnya".
 *
 * `value` is the stored category name and must match the lists above exactly
 * (the types enforce it) — the backend looks categories up by that string.
 * `label` is display only, so shortening one never touches existing rows.
 *
 * Deliberately absent, because something else writes them and a hand entry
 * would pass itself off as that source:
 *   - "Penjualan produk/jasa" / "Pembelian stok barang dagang": sales and
 *     purchase invoice payments.
 *   - "Kasir": POS sales. A typed-in one would sit among real counter sales,
 *     and the list hides the delete button on Kasir rows.
 */
type Option<C extends string> = { value: C; label: string };
type Picker<C extends string> = {
    common: Option<C>[];
    groups: { label: string; items: Option<C>[] }[];
};
/** Either list, for a reader that doesn't care which side it is showing. */
export type CashflowCategoryPicker = Picker<string>;

export const CATEGORY_PICKER_IN: Picker<(typeof CATEGORY_IN)[number]> = {
    common: [
        { value: "Modal pribadi owner", label: "Modal owner" },
        { value: "Pembayaran piutang pelanggan", label: "Piutang dibayar" },
        { value: "Uang muka/down payment dari customer", label: "Uang muka (DP)" },
        { value: "Pendapatan layanan tambahan", label: "Layanan tambahan" },
        { value: "Komisi atau fee", label: "Komisi / fee" },
        { value: "Lain-lain", label: "Lain-lain" },
    ],
    groups: [
        {
            label: "Modal & pinjaman",
            items: [
                { value: "Tambahan setoran modal partner/investor", label: "Setoran investor" },
                { value: "Pinjaman bank", label: "Pinjaman bank" },
                { value: "Pinjaman keluarga/teman", label: "Pinjaman keluarga/teman" },
                { value: "Dana hibah atau bantuan pemerintah", label: "Hibah / bantuan" },
            ],
        },
        {
            label: "Jual aset",
            items: [
                { value: "Penjualan kendaraan operasional", label: "Kendaraan" },
                { value: "Penjualan mesin/peralatan", label: "Mesin / peralatan" },
                { value: "Penjualan stok lama/scrap", label: "Stok lama / scrap" },
            ],
        },
    ],
};

export const CATEGORY_PICKER_OUT: Picker<(typeof CATEGORY_OUT)[number]> = {
    common: [
        { value: "Pembelian bahan baku", label: "Bahan baku" },
        { value: "Gaji karyawan", label: "Gaji" },
        { value: "Listrik, air, internet", label: "Listrik & air" },
        { value: "Sewa tempat", label: "Sewa" },
        { value: "Prive Owner (Uang Owner yang dipakai sebelumnya)", label: "Prive owner" },
        { value: "Lain-lain", label: "Lain-lain" },
    ],
    groups: [
        {
            label: "Operasional",
            items: [
                { value: "Ongkos kirim", label: "Ongkir" },
                { value: "Biaya packaging", label: "Packaging" },
                { value: "Biaya admin marketplace", label: "Admin marketplace" },
                { value: "Iklan/marketing", label: "Iklan" },
                { value: "Transportasi operasional", label: "Transport" },
                { value: "ATK dan perlengkapan kantor", label: "ATK" },
                { value: "Maintenance/perbaikan kecil", label: "Perbaikan" },
                { value: "BPJS Karyawan", label: "BPJS" },
            ],
        },
        {
            label: "Pinjaman & modal",
            items: [
                { value: "Cicilan Pinjaman", label: "Cicilan pinjaman" },
                { value: "Pengembalian modal investor", label: "Pengembalian modal investor" },
            ],
        },
        {
            label: "Aset & khusus",
            items: [
                { value: "Pembelian Mesin / Asset", label: "Mesin / aset" },
                { value: "Biaya Notaris atau badan hukum", label: "Notaris" },
                { value: "Pengeluaran Darurat", label: "Darurat" },
            ],
        },
    ],
};
