"use client";

import { useEffect } from "react";

// Matches the various "a JS chunk failed to load" messages across engines.
// Safari/iOS uses "Importing a module script failed" rather than ChunkLoadError,
// which is exactly the after-deploy / flaky-network case we want to auto-recover.
const CHUNK_ERROR =
  /ChunkLoadError|Loading chunk [\d]+ failed|Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i;

export function isChunkLoadError(error?: { name?: string; message?: string }) {
  if (!error) return false;
  return error.name === "ChunkLoadError" || CHUNK_ERROR.test(error.message ?? "");
}

// Shared body for the route error boundaries. On a chunk-load error it does a
// one-shot hard reload (guarded by sessionStorage so it can't loop) to pull the
// fresh build; otherwise it shows a recover UI instead of a blank screen.
export function ErrorView({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const chunk = isChunkLoadError(error);

  useEffect(() => {
    if (!chunk) return;
    const KEY = "__chunk_reload_once";
    try {
      if (!sessionStorage.getItem(KEY)) {
        sessionStorage.setItem(KEY, String(Date.now()));
        window.location.reload();
        return;
      }
    } catch {
      // sessionStorage unavailable (private mode) — fall back to a manual button.
    }
  }, [chunk]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">
          {chunk ? "Memperbarui aplikasi…" : "Ada yang tidak beres"}
        </h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          {chunk
            ? "Versi aplikasi baru saja diperbarui. Memuat ulang…"
            : "Terjadi kesalahan saat menampilkan halaman ini. Coba muat ulang."}
        </p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => reset()}
          className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          Coba lagi
        </button>
        <button
          onClick={() => window.location.reload()}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
        >
          Muat ulang
        </button>
      </div>
    </div>
  );
}
