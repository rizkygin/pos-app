export function toWebHeaders(nodeHeaders: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (value == null) continue;
    headers.append(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}
