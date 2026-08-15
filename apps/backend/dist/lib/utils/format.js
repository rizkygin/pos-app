"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fmtIDR = fmtIDR;
exports.formatCurrency = formatCurrency;
exports.discountedPrice = discountedPrice;
function fmtIDR(price) {
    return new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0,
    }).format(price);
}
function formatCurrency(value) {
    if (!isFinite(value))
        return "—";
    return new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        minimumFractionDigits: 0,
    }).format(value);
}
function discountedPrice(price, discountPercent) {
    if (!discountPercent)
        return price;
    return price - Math.floor(price * (discountPercent / 100));
}
