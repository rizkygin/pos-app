"use client";

import { useEffect } from "react";
import { isChunkLoadError } from "@/components/error-view";

// Ultimate fallback: a global-error replaces the ROOT layout, so it must render
// its own <html>/<body> and can't rely on app CSS — inline styles only.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const chunk = isChunkLoadError(error);

  useEffect(() => {
    if (!chunk) return;
    try {
      const KEY = "__chunk_reload_once";
      if (!sessionStorage.getItem(KEY)) {
        sessionStorage.setItem(KEY, String(Date.now()));
        window.location.reload();
      }
    } catch {
      /* private mode: manual button below */
    }
  }, [chunk]);

  return (
    <html lang="id">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#0a0a0a",
          color: "#fafafa",
        }}
      >
        <div style={{ textAlign: "center", padding: 24, maxWidth: 360 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>
            {chunk ? "Memperbarui aplikasi…" : "Ada yang tidak beres"}
          </h2>
          <p style={{ fontSize: 14, color: "#a1a1aa", margin: "0 0 20px" }}>
            {chunk
              ? "Versi aplikasi baru saja diperbarui. Memuat ulang…"
              : "Terjadi kesalahan. Coba muat ulang halaman."}
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button
              onClick={() => reset()}
              style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #3f3f46", background: "transparent", color: "#fafafa", fontSize: 14, cursor: "pointer" }}
            >
              Coba lagi
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#0d9488", color: "#fff", fontSize: 14, cursor: "pointer" }}
            >
              Muat ulang
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
