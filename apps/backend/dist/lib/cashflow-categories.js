"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CATEGORY_POS_CANCELLATION = exports.CATEGORY_POS_SALE = exports.CATEGORY_OUT = exports.CATEGORY_IN = void 0;
exports.CATEGORY_IN = [
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
];
exports.CATEGORY_OUT = [
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
    "Pembatalan Order Kasir",
    "Lain-lain",
];
// The cash-in category every POS sale is booked under, and the cash-out that
// reverses one. Both are found-or-created at write time (categories are rows,
// not an enum), so these are the single source of truth for the spelling — a
// typo in one place would quietly open a second, parallel category.
//
// "Pembatalan Order Kasir" is in CATEGORY_OUT above (so the seed creates it)
// but is deliberately NOT in the frontend's copy of the list, which drives the
// manual cash-entry dropdown. It is written by the cancellation endpoint alone,
// against a specific order id. Offering it for hand-entry would let someone
// book a reversal with no order behind it, in the one category whose whole
// value is that every row points at a sale that was really voided.
exports.CATEGORY_POS_SALE = "Kasir";
exports.CATEGORY_POS_CANCELLATION = "Pembatalan Order Kasir";
