export function fmtIDR(price: number) {
    return new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0,
    }).format(price);
}

export function formatCurrency(value: number): string {
    if (!isFinite(value)) return "—";
    return new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        minimumFractionDigits: 0,
    }).format(value);
}

export function discountedPrice(price: number, discountPercent?: number) {
    if (!discountPercent) return price;
    return price - Math.floor(price * (discountPercent / 100));
}
