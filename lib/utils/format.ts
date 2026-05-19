export function fmtIDR(price: number) {
    return new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0,
    }).format(price);
}

export function discountedPrice(price: number, discountPercent?: number) {
    if (!discountPercent) return price;
    return price - Math.floor(price * (discountPercent / 100));
}
