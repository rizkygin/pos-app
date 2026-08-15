"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toWebHeaders = toWebHeaders;
function toWebHeaders(nodeHeaders) {
    const headers = new Headers();
    for (const [key, value] of Object.entries(nodeHeaders)) {
        if (value == null)
            continue;
        headers.append(key, Array.isArray(value) ? value.join(", ") : value);
    }
    return headers;
}
