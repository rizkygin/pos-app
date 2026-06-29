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

// For controlled money <input>s: group a raw value with id-ID thousand
// separators for display (e.g. "20000" -> "20.000"). IDR has no cents, so
// non-digits are dropped.
export function formatNumberInput(value: string): string {
    const digits = value.replace(/\D/g, "");
    if (!digits) return "";
    return new Intl.NumberFormat("id-ID").format(Number(digits));
}

// Strip separators back to a raw digit string for storing/parsing.
export function parseNumberInput(value: string): string {
    return value.replace(/\D/g, "");
}

export function discountedPrice(price: number, discountPercent?: number) {
    if (!discountPercent) return price;
    return price - Math.floor(price * (discountPercent / 100));
}
