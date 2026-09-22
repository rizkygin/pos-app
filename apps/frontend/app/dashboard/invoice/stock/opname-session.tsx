"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Clock, Loader2, RefreshCw, Search, SkipForward, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { API_URL } from "@/lib/api-url";
import { fmtIDR } from "@/lib/utils/format";
import type { StockRow } from "./columns";

export type OpnameLine = {
  productId: string;
  productName: string;
  /** products.barcode — whatever code the outlet put on the product, if any. */
  code: string | null;
  unit: string;
  counted: number | null;
  /** "Tidak bisa dihitung": an answer that adjusts nothing. */
  skipped: boolean;
  reason: string | null;
  countedAt: string;
  countedBy: string | null;
  unitCost: number | null;
  // System stock at countedAt, and counted minus it — computed by the server
  // from the ledger, so a sale made after the count never shows up here.
  systemQty: number | null;
  delta: number | null;
  impact: number | null;
  tone: "ok" | "minor" | "major" | null;
  // The product was deleted or stopped tracking stock after it was counted;
  // finishing skips it.
  dropped: boolean;
};

export type OpnameSession = {
  id: number;
  /** "OP-0009" — the session as a person would say it out loud. */
  code: string;
  note: string;
  status: "open" | "finished" | "cancelled";
  startedAt: string;
  startedBy: string | null;
  finishedAt: string | null;
  finishedBy: string | null;
  productCount: number;
  lines: OpnameLine[];
};

type Rejected = {
  productId: string;
  productName: string;
  reason: "invalid" | "invalid_time" | "counted_later";
  lastCountedAt?: string;
};

type Filter = "all" | "todo" | "done" | "diff";

/** One product as the sheet sees it: the saved answer plus anything typed over it. */
type RowState = {
  row: StockRow;
  line: OpnameLine | undefined;
  draft: string | undefined;
  hasDraft: boolean;
  counted: number | null;
  system: number | null;
  delta: number | null;
  tone: Tone;
  impact: number | null;
  dirty: boolean;
  unitCost: number;
};
type Tone = "pending" | "skipped" | "ok" | "minor" | "major";

// Mirrors lib/opname.ts in the backend, which is what actually gates the
// finish. Here it only decides what a row looks like while it is being typed.
const MAX_BACKDATE_DAYS = 7;
const TOLERANCE_RP = 100_000;
const TOLERANCE_PCT = 0.05;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Why a count differs. Keys are stored; labels are shown. */
const REASONS: Record<string, string> = {
  busuk: "Barang busuk / rusak",
  terpakai: "Terpakai tanpa dicatat",
  salah_satuan: "Salah satuan saat input",
  faktur_ganda: "Tercatat ganda di faktur",
  hilang: "Hilang / belum diketahui",
};

/**
 * One visual language for status, used by the dot, the chip and the review
 * groups. Every row always wears one of these — there is no bare "—" that
 * leaves the reader guessing whether a thing was counted.
 */
const TONE: Record<Tone, { label: string; icon: string; chip: string; dot: string; row: string }> = {
  pending: {
    label: "Belum dihitung",
    icon: "○",
    chip: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/30",
    row: "",
  },
  skipped: {
    label: "Dilewati",
    icon: "→",
    chip: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/50",
    row: "",
  },
  ok: {
    label: "Pas",
    icon: "✓",
    chip: "bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-300",
    dot: "bg-green-600",
    row: "",
  },
  minor: {
    label: "Selisih kecil",
    icon: "±",
    chip: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
    dot: "bg-amber-500",
    row: "bg-amber-50/40 dark:bg-amber-950/10",
  },
  major: {
    label: "Perlu alasan",
    icon: "!",
    chip: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
    dot: "bg-red-600",
    row: "bg-red-50/40 dark:bg-red-950/10",
  },
};

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const fmtClock = (iso: string) =>
  new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

// "YYYY-MM-DDTHH:mm" in the viewer's own zone — what <input type=datetime-local> speaks.
const toLocalInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const qty = (n: number) => +n.toFixed(3);
const nfQty = (n: number) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 }).format(n);

/** Same test as the backend's classify(). */
const toneOf = (delta: number, system: number, unitCost: number): Tone => {
  if (delta === 0) return "ok";
  const impact = Math.abs(delta * unitCost);
  const share = system > 0 ? Math.abs(delta) / system : 0;
  return impact >= TOLERANCE_RP || share > TOLERANCE_PCT ? "major" : "minor";
};

/** A difference said in words, which is how the count sheet talks. */
const deltaWords = (delta: number, unit: string) =>
  delta === 0
    ? "Pas dengan sistem"
    : delta > 0
      ? `Lebih ${nfQty(delta)} ${unit}`
      : `Kurang ${nfQty(-delta)} ${unit}`;

const rejectedText = (r: Rejected) =>
  r.reason === "counted_later" && r.lastCountedAt
    ? `Sudah diopname ${fmtWhen(r.lastCountedAt)} — waktu hitung harus sesudahnya.`
    : r.reason === "invalid_time"
      ? `Waktu hitung tidak valid atau lebih dari ${MAX_BACKDATE_DAYS} hari lalu.`
      : "Jumlah tidak valid.";

async function call(path: string, init?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || "Gagal menyimpan, coba lagi");
  return json;
}

/**
 * An opname session: counts saved to the server in as many sittings (and on as
 * many devices) as the count takes. Each count is judged against the system
 * stock AT THE TIME IT WAS COUNTED, so selling during the count is fine.
 *
 * Two screens. "count" is the sheet everyone works on; "review" is the last
 * look before stock moves, where a big difference has to say why. Stock only
 * changes when the review is approved.
 */
export function OpnameSessionView({
  rows,
  session: initial,
  onSessionChange,
  onRefreshStock,
  onExit,
  onFinished,
}: {
  rows: StockRow[];
  session: OpnameSession;
  onSessionChange: (s: OpnameSession | null) => void;
  onRefreshStock: () => Promise<void>;
  onExit: () => void;
  onFinished: (result: { adjusted: number; counted: number; skipped: number }) => Promise<void>;
}) {
  const [session, setSession] = useState(initial);
  const [view, setView] = useState<"count" | "review">("count");
  // Typed but not yet saved. Keyed by product id; a count draft is what the
  // owner typed into "Hitung fisik", a cost draft into the HPP field. Skips
  // and reasons are single clicks and save immediately instead.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [costDrafts, setCostDrafts] = useState<Record<string, string>>({});
  const [note, setNote] = useState(initial.note);
  const [noteOpen, setNoteOpen] = useState(false);
  const [rejected, setRejected] = useState<Record<string, Rejected>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<null | "save" | "finish" | "cancel" | "reload" | "row">(null);
  const [confirm, setConfirm] = useState<null | "finish" | "cancel">(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // Which product's HPP is being filled in, and what has been typed so far.
  // Nothing is committed until "Pakai angka ini" — an HPP is not something to
  // stumble into by tabbing through a row.
  const [hpp, setHpp] = useState<{ productId: string; value: string } | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [showOk, setShowOk] = useState(false);

  // "Waktu hitung": now, or a moment in the past for a count done on paper.
  // Deliberately NOT remembered across visits — a forgotten backdate would
  // quietly misdate every count typed after it.
  const [backdate, setBackdate] = useState(false);
  const [countedAt, setCountedAt] = useState(() => {
    const now = new Date();
    // Midnight today in the viewer's zone: the end of yesterday, the usual
    // answer to "we forgot to enter yesterday's count".
    return toLocalInput(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  });
  const countedAtIso = useMemo(() => {
    if (!backdate) return null;
    const d = new Date(countedAt);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }, [backdate, countedAt]);
  const [bounds, setBounds] = useState<{ min: string; max: string } | null>(null);
  // System stock at the chosen past moment, kept with the moment it answers so
  // a stale answer is never shown for a newer choice.
  const [fetched, setFetched] = useState<{
    at: string;
    data: Record<string, number> | null;
    error: string;
  } | null>(null);

  useEffect(() => {
    if (!countedAtIso) return;
    let alive = true;
    fetch(`${API_URL}/api/stock/system-at?at=${encodeURIComponent(countedAtIso)}`, { credentials: "include" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        setFetched({
          at: countedAtIso,
          data: j.success ? j.data : null,
          error: j.success ? "" : j.error || "Waktu hitung tidak valid",
        });
      })
      .catch(() => alive && setFetched({ at: countedAtIso, data: null, error: "Gagal memuat stok sistem" }));
    return () => {
      alive = false;
    };
  }, [countedAtIso]);
  const answer = fetched && fetched.at === countedAtIso ? fetched : null;
  const systemAt = answer?.data ?? null;
  const systemAtLoading = !!countedAtIso && !answer;
  const timeError = answer?.error ?? "";

  const update = (s: OpnameSession) => {
    setSession(s);
    onSessionChange(s);
    setSavedAt(new Date().toISOString());
  };

  const lineOf = useMemo(() => new Map(session.lines.map((l) => [l.productId, l])), [session.lines]);
  const rowIds = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
  // Answered, but no longer on the Stok page — finishing skips these.
  const dropped = session.lines.filter((l) => l.dropped || !rowIds.has(l.productId));

  /** What a NEW count of this product would be compared with. */
  const referenceFor = (r: StockRow): number | null => (backdate ? (systemAt?.[r.id] ?? null) : r.stock);

  /** Everything the table and the review need about one product. */
  const stateOf = (r: StockRow): RowState => {
    const line = lineOf.get(r.id);
    const draft = drafts[r.id];
    const hasDraft = draft !== undefined && draft.trim() !== "";
    const costDraft = costDrafts[r.id];
    const unitCost =
      costDraft !== undefined && Number(costDraft) > 0
        ? Number(costDraft)
        : (line?.unitCost ?? 0) > 0 && r.needs_cost
          ? Number(line?.unitCost)
          : r.buying_price;
    const ref = referenceFor(r);
    // A skipped row has no system_qty of its own (nothing was compared), but
    // the shelf figure is still what the counter wants to see when they come
    // back to it.
    const system = hasDraft || !line || line.skipped ? ref : line.systemQty;
    const counted = hasDraft ? Number(draft) : (line?.counted ?? null);
    const delta =
      line?.skipped && !hasDraft
        ? null
        : hasDraft
          ? ref == null
            ? null
            : qty(Number(draft) - ref)
          : (line?.delta ?? null);
    const tone: Tone =
      delta == null
        ? line?.skipped && !hasDraft
          ? "skipped"
          : "pending"
        : hasDraft
          ? toneOf(delta, system ?? 0, unitCost)
          : (line?.tone ?? toneOf(delta, system ?? 0, unitCost));
    const impact = delta == null ? null : Math.round(delta * unitCost);
    const dirty = hasDraft || (costDraft !== undefined && line != null && Number(costDraft || 0) !== (line.unitCost ?? 0));
    return { row: r, line, draft, hasDraft, counted, system, delta, tone, impact, dirty, unitCost };
  };

  const states = rows.map(stateOf);
  const byTone = (t: Tone) => states.filter((s) => s.tone === t);
  const pendingCount = byTone("pending").length;
  const okCount = byTone("ok").length;
  const minorList = byTone("minor");
  const majorList = byTone("major");
  const skippedCount = byTone("skipped").length;
  const answeredCount = rows.length - pendingCount;
  const totalImpact = states.reduce((sum, s) => sum + (s.impact ?? 0), 0);
  const unexplained = majorList.filter((s) => !s.line?.reason || s.dirty);

  // Everything waiting to be sent. A count draft is saved at the chosen time;
  // an HPP typed onto an already-saved count keeps that count's own time, so
  // fixing a price never moves when something was counted.
  const pending = (() => {
    const out: {
      product_id: string;
      counted: number;
      unit_cost?: number | null;
      counted_at?: string;
      reason?: string | null;
    }[] = [];
    for (const s of states) {
      if (!s.dirty) continue;
      const cost = costDrafts[s.row.id];
      const unitCost = cost !== undefined ? (cost.trim() === "" ? null : Number(cost)) : (s.line?.unitCost ?? null);
      if (s.hasDraft) {
        out.push({ product_id: s.row.id, counted: Number(s.draft), unit_cost: unitCost, reason: s.line?.reason ?? null });
      } else if (s.line && s.line.counted != null) {
        out.push({
          product_id: s.row.id,
          counted: s.line.counted,
          unit_cost: unitCost,
          counted_at: s.line.countedAt,
          reason: s.line.reason,
        });
      }
    }
    return out;
  })();

  const save = async () => {
    if (pending.length === 0 || busy) return;
    if (backdate && !countedAtIso) {
      setError("Isi waktu hitung dulu");
      return;
    }
    setBusy("save");
    setError("");
    try {
      const json = await call(`/api/stock/opname-sessions/${session.id}/lines`, {
        method: "PUT",
        body: JSON.stringify({ counted_at: countedAtIso, items: pending }),
      });
      const rej: Record<string, Rejected> = Object.fromEntries(
        ((json.rejected ?? []) as Rejected[]).map((r) => [r.productId, r]),
      );
      setRejected(rej);
      // Keep what the server refused so the owner can fix it; drop the rest.
      const sent = new Set(pending.map((p) => p.product_id));
      const keep = (m: Record<string, string>) =>
        Object.fromEntries(Object.entries(m).filter(([id]) => !sent.has(id) || rej[id]));
      setDrafts(keep);
      setCostDrafts(keep);
      update(json.session);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan hitungan");
    } finally {
      setBusy(null);
    }
  };

  /** One row, saved on its own: a skip, a reason, or a one-click "Pas". */
  const saveRow = async (
    productId: string,
    item: { counted?: number; skipped?: boolean; reason?: string | null; counted_at?: string; unit_cost?: number | null },
  ) => {
    setBusy("row");
    setError("");
    try {
      const json = await call(`/api/stock/opname-sessions/${session.id}/lines`, {
        method: "PUT",
        body: JSON.stringify({ counted_at: countedAtIso, items: [{ product_id: productId, ...item }] }),
      });
      const rej = (json.rejected ?? []) as Rejected[];
      setRejected((m) => ({ ...m, ...Object.fromEntries(rej.map((r) => [r.productId, r])) }));
      setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== productId)));
      update(json.session);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setBusy(null);
    }
  };

  const removeLine = async (productId: string) => {
    setBusy("row");
    setError("");
    try {
      const json = await call(`/api/stock/opname-sessions/${session.id}/lines/${encodeURIComponent(productId)}`, {
        method: "DELETE",
      });
      update(json.session);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menghapus hitungan");
    } finally {
      setBusy(null);
    }
  };

  const saveNote = async () => {
    if (note.trim() === session.note) return;
    try {
      const json = await call(`/api/stock/opname-sessions/${session.id}`, {
        method: "PATCH",
        body: JSON.stringify({ note }),
      });
      update(json.session);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan catatan");
    }
  };

  // Another device may be counting too.
  const reload = async () => {
    setBusy("reload");
    setError("");
    try {
      const [json] = await Promise.all([call(`/api/stock/opname-sessions/current`), onRefreshStock()]);
      if (!json.session) {
        onSessionChange(null);
        onExit();
        return;
      }
      update(json.session);
      setNote(json.session.note);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat ulang");
    } finally {
      setBusy(null);
    }
  };

  const finish = async () => {
    setBusy("finish");
    setError("");
    try {
      const json = await call(`/api/stock/opname-sessions/${session.id}/finish`, { method: "POST", body: "{}" });
      setConfirm(null);
      await onFinished({ adjusted: json.adjusted ?? 0, counted: json.counted ?? 0, skipped: json.skipped ?? 0 });
    } catch (e) {
      setConfirm(null);
      setError(e instanceof Error ? e.message : "Gagal menyelesaikan opname");
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    setBusy("cancel");
    setError("");
    try {
      await call(`/api/stock/opname-sessions/${session.id}/cancel`, { method: "POST", body: "{}" });
      setConfirm(null);
      onSessionChange(null);
      onExit();
    } catch (e) {
      setConfirm(null);
      setError(e instanceof Error ? e.message : "Gagal membatalkan opname");
    } finally {
      setBusy(null);
    }
  };

  const leave = () => {
    if (pending.length > 0 && !window.confirm("Ada hitungan yang belum disimpan. Tetap keluar?")) return;
    onExit();
  };

  const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    }
  };

  const chooseBackdate = (on: boolean) => {
    setBackdate(on);
    if (on) {
      const now = new Date();
      setBounds({
        min: toLocalInput(new Date(now.getTime() - MAX_BACKDATE_DAYS * DAY_MS)),
        max: toLocalInput(now),
      });
    }
  };

  const openHpp = (s: RowState) =>
    setHpp({ productId: s.row.id, value: costDrafts[s.row.id] ?? (s.line?.unitCost ? String(s.line.unitCost) : "") });

  const dropDraft = (id: string) => {
    const without = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== id));
    setDrafts(without);
    setCostDrafts(without);
  };

  // ── the sheet ─────────────────────────────────────────────────────────────
  // Plain derivations over `states`, which is itself recomputed each render:
  // the compiler memoizes these, and a hand-rolled useMemo over a value it
  // already tracks is one it has to give up on.
  const q = search.toLowerCase().trim();
  const searched = q
    ? states.filter(
        (s) => s.row.product_name.toLowerCase().includes(q) || (s.row.code ?? "").toLowerCase().includes(q),
      )
    : states;
  const tabs: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "Semua", count: searched.length },
    { id: "todo", label: "Belum dihitung", count: searched.filter((s) => s.tone === "pending").length },
    {
      id: "done",
      label: "Sudah dihitung",
      count: searched.filter((s) => s.tone !== "pending").length,
    },
    {
      id: "diff",
      label: "Ada selisih",
      count: searched.filter((s) => s.tone === "minor" || s.tone === "major").length,
    },
  ];
  const shown = searched.filter((s) =>
    filter === "todo"
      ? s.tone === "pending"
      : filter === "done"
        ? s.tone !== "pending"
        : filter === "diff"
          ? s.tone === "minor" || s.tone === "major"
          : true,
  );
  const needCostCount = rows.filter((r) => r.needs_cost).length;
  const progressPct = rows.length > 0 ? Math.round((answeredCount / rows.length) * 100) : 0;
  // Who is still missing, said by name while the list is short enough to read.
  const pendingRows = byTone("pending");
  const pendingNames =
    pendingRows.length <= 3
      ? pendingRows.map((s) => s.row.product_name).join(", ")
      : `${pendingRows
          .slice(0, 3)
          .map((s) => s.row.product_name)
          .join(", ")} +${pendingRows.length - 3} lagi`;

  const impactChip = (v: number) =>
    v === 0 ? "text-muted-foreground" : v > 0 ? "text-green-600 dark:text-green-400" : "text-destructive";
  const impactLabel = (v: number | null) =>
    v == null ? "—" : v === 0 ? "Tidak berubah" : `${v > 0 ? "+" : "−"}${fmtIDR(Math.abs(v))}`;

  const reasonSelect = (s: RowState, required: boolean) => (
    <select
      value={s.line?.reason ?? ""}
      disabled={busy !== null}
      onChange={(e) =>
        saveRow(s.row.id, {
          counted: s.line?.counted ?? undefined,
          counted_at: s.line?.countedAt,
          unit_cost: s.line?.unitCost ?? undefined,
          reason: e.target.value || null,
        })
      }
      aria-label={`Alasan selisih ${s.row.product_name}`}
      className={`h-9 w-full rounded-lg border bg-background px-2 text-[13px] ${
        required && !s.line?.reason ? "border-destructive/60" : "border-border"
      }`}
    >
      <option value="">{required ? "Pilih alasan… wajib" : "Pilih alasan… opsional"}</option>
      {Object.entries(REASONS).map(([k, label]) => (
        <option key={k} value={k}>
          {label}
        </option>
      ))}
    </select>
  );

  // ======================================================================= 1d
  if (view === "review") {
    const blocked = unexplained.length > 0 || pendingCount > 0;
    const stat = (label: string, value: string, sub: string, cls = "") => (
      <div className="flex flex-col gap-1 border-b p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className={`text-xl font-semibold tabular-nums ${cls}`}>{value}</span>
        <span className="text-xs text-muted-foreground">{sub}</span>
      </div>
    );
    return (
      <div className="space-y-4 p-4 pb-0 md:p-6 md:pb-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Button variant="ghost" size="icon-sm" onClick={() => setView("count")} aria-label="Kembali menghitung">
              <ArrowLeft className="size-4" />
            </Button>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Tinjau sebelum stok berubah</h1>
              <p className="text-xs text-muted-foreground">
                Sesi {session.code} · {rows.length} barang · dimulai {fmtWhen(session.startedAt)}
                {session.startedBy ? ` oleh ${session.startedBy}` : ""}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setView("count")}>
            <ArrowLeft className="size-3.5" /> Kembali menghitung
          </Button>
        </div>

        <div className="grid rounded-xl border bg-card sm:grid-cols-4">
          {stat("Cocok dengan sistem", `${okCount} barang`, "Lewat tanpa perlu ditinjau", "text-green-600 dark:text-green-400")}
          {stat("Selisih kecil", `${minorList.length} barang`, "Di bawah batas toleransi", "text-amber-600 dark:text-amber-400")}
          {stat("Perlu alasan", `${majorList.length} barang`, "Menahan persetujuan", "text-destructive")}
          {stat("Dampak nilai stok", impactLabel(totalImpact), "Penyesuaian stok, bukan kas", impactChip(totalImpact))}
        </div>

        <div className="overflow-hidden rounded-xl border">
          {/* needs a reason */}
          <div className="flex flex-wrap items-center gap-2 border-b bg-red-50 px-4 py-2.5 dark:bg-red-950/30">
            <span className="size-2 rounded-full bg-red-600" />
            <span className="text-[13px] font-semibold text-red-900 dark:text-red-200">
              Perlu alasan — {majorList.length} barang
            </span>
            <span className="text-xs text-red-800/80 dark:text-red-300/80">
              Selisihnya di atas {fmtIDR(TOLERANCE_RP)} atau lebih dari 5% stok. Tulis alasannya, atau hitung ulang
              raknya.
            </span>
          </div>
          {majorList.length === 0 && (
            <p className="border-b px-4 py-3 text-xs text-muted-foreground">Tidak ada selisih besar. </p>
          )}
          {majorList.map((s) => (
            <div key={s.row.id} className="grid gap-3 border-b px-4 py-3 md:grid-cols-[minmax(0,1fr)_260px_200px_240px] md:items-center">
              <div className="min-w-0">
                <p className="font-medium">{s.row.product_name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {s.row.code ? `${s.row.code} · ` : ""}HPP {fmtIDR(s.unitCost)}/{s.row.unit}
                </p>
              </div>
              <div className="flex items-center gap-3 text-sm tabular-nums">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Sistem</p>
                  <p className="text-muted-foreground">
                    {s.system == null ? "—" : `${nfQty(s.system)} ${s.row.unit}`}
                  </p>
                </div>
                <ArrowRight className="size-4 text-muted-foreground/50" />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Dihitung</p>
                  <p className="font-semibold">{s.counted == null ? "—" : `${nfQty(s.counted)} ${s.row.unit}`}</p>
                </div>
              </div>
              <div className="space-y-1">
                <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${TONE.major.chip}`}>
                  {TONE.major.icon} {s.delta == null ? "—" : deltaWords(s.delta, s.row.unit)}
                </span>
                <p className="pl-1 text-xs font-semibold tabular-nums text-destructive">{impactLabel(s.impact)}</p>
              </div>
              <div className="space-y-1.5">
                {reasonSelect(s, true)}
                <button
                  type="button"
                  onClick={() => {
                    setSearch(s.row.product_name);
                    setView("count");
                  }}
                  className="text-xs font-semibold text-teal-700 hover:underline dark:text-teal-400"
                >
                  Hitung ulang barang ini
                </button>
              </div>
            </div>
          ))}

          {/* small differences */}
          <div className="flex flex-wrap items-center gap-2 border-b bg-amber-50 px-4 py-2.5 dark:bg-amber-950/30">
            <span className="size-2 rounded-full bg-amber-500" />
            <span className="text-[13px] font-semibold text-amber-900 dark:text-amber-200">
              Selisih kecil — {minorList.length} barang
            </span>
            <span className="text-xs text-amber-800/80 dark:text-amber-300/80">
              Masih dalam toleransi. Alasan opsional; tetap dicatat di riwayat.
            </span>
          </div>
          {minorList.map((s) => (
            <div key={s.row.id} className="grid gap-3 border-b px-4 py-2.5 md:grid-cols-[minmax(0,1fr)_260px_200px_240px] md:items-center">
              <p className="min-w-0 truncate font-medium">{s.row.product_name}</p>
              <p className="flex items-center gap-2 text-sm tabular-nums text-muted-foreground">
                {s.system == null ? "—" : nfQty(s.system)}
                <ArrowRight className="size-3.5 text-muted-foreground/50" />
                <span className="font-semibold text-foreground">
                  {s.counted == null ? "—" : `${nfQty(s.counted)} ${s.row.unit}`}
                </span>
              </p>
              <div className="flex items-center gap-2">
                <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${TONE.minor.chip}`}>
                  {TONE.minor.icon} {s.delta == null ? "—" : deltaWords(s.delta, s.row.unit)}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">{impactLabel(s.impact)}</span>
              </div>
              {reasonSelect(s, false)}
            </div>
          ))}

          {/* matched, and skipped */}
          <div className="flex flex-wrap items-center gap-2 border-b bg-green-50 px-4 py-2.5 dark:bg-green-950/30">
            <span className="size-2 rounded-full bg-green-600" />
            <span className="text-[13px] font-semibold text-green-900 dark:text-green-200">
              Cocok dengan sistem — {okCount} barang
            </span>
            <span className="text-xs text-green-800/80 dark:text-green-300/80">
              Tidak ada yang berubah untuk barang ini.
            </span>
            {okCount > 0 && (
              <button
                type="button"
                onClick={() => setShowOk((v) => !v)}
                className="ml-auto text-xs font-semibold text-teal-700 hover:underline dark:text-teal-400"
              >
                {showOk ? "Sembunyikan" : "Lihat daftarnya"}
              </button>
            )}
          </div>
          {showOk && (
            <p className="border-b px-4 py-3 text-xs text-muted-foreground">
              {byTone("ok")
                .map((s) => s.row.product_name)
                .join(", ")}
            </p>
          )}
          {skippedCount > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
              <span className="size-2 rounded-full bg-muted-foreground/50" />
              <span className="text-[13px] font-semibold">Dilewati — {skippedCount} barang</span>
              <span className="text-xs text-muted-foreground">
                Ditandai tidak bisa dihitung. Stoknya dibiarkan apa adanya.
              </span>
            </div>
          )}
        </div>

        {dropped.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {dropped.length} hitungan tidak ikut disesuaikan karena barangnya sudah dihapus atau tidak dikelola
            stoknya lagi: {dropped.map((l) => l.productName).join(", ")}.
          </p>
        )}

        <div className="sticky bottom-0 z-20 -mx-4 border-t bg-background md:-mx-6">
          <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-2.5 md:px-6">
            <div className="min-w-0 basis-full text-xs sm:basis-0 sm:flex-1">
              {error ? (
                <p className="font-medium text-destructive">{error}</p>
              ) : blocked ? (
                <p className="text-amber-700 dark:text-amber-400">
                  {pendingCount > 0
                    ? `${pendingCount} barang belum dihitung: ${pendingNames}.`
                    : `${unexplained.length} selisih besar masih menunggu alasan.`}
                </p>
              ) : (
                <>
                  <p className="font-medium">Setelah disetujui, stok sistem ditulis ulang sesuai hasil hitung.</p>
                  <p className="text-muted-foreground">
                    Tercatat sebagai penyesuaian di Alur Stok dan Riwayat Opname — bisa ditelusuri, tidak bisa
                    dihapus.
                  </p>
                </>
              )}
            </div>
            <Button variant="ghost" onClick={() => setConfirm("cancel")} disabled={busy !== null}>
              Batalkan<span className="hidden sm:inline"> sesi</span>
            </Button>
            <Button
              onClick={() => setConfirm("finish")}
              disabled={busy !== null || blocked}
              className="bg-teal-600 text-white hover:bg-teal-700"
            >
              {busy === "finish" && <Loader2 className="size-4 animate-spin" />}
              Setujui &amp; terapkan ke stok
            </Button>
          </div>
        </div>

        {dialogs()}
      </div>
    );
  }

  // ======================================================================= 1b
  return (
    <div className="space-y-4 p-4 pb-0 md:p-6 md:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Button variant="ghost" size="icon-sm" onClick={leave} aria-label="Kembali">
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Stok Opname · {rows.length} barang</h1>
            <p className="text-xs text-muted-foreground">
              Sesi {session.code} · dimulai {fmtWhen(session.startedAt)}
              {session.startedBy ? ` oleh ${session.startedBy}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {savedAt && (
            <span className="hidden items-center gap-1.5 rounded-lg bg-teal-50 px-2.5 py-1.5 text-xs font-semibold text-teal-700 sm:inline-flex dark:bg-teal-950/40 dark:text-teal-300">
              <span className="size-1.5 rounded-full bg-teal-600" /> Draft tersimpan {fmtClock(savedAt)}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => setNoteOpen((v) => !v)} aria-expanded={noteOpen}>
            Catatan sesi
          </Button>
          <Button variant="ghost" size="sm" onClick={reload} disabled={busy !== null}>
            {busy === "reload" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            <span className="hidden sm:inline">Muat ulang</span>
          </Button>
        </div>
      </div>

      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Jual beli tetap jalan. Tiap barang dibandingkan dengan{" "}
        <span className="font-medium text-foreground">stok sistem pada saat barang itu dihitung</span>, jadi opname
        boleh dikerjakan beberapa hari dan dari beberapa HP. Hitung satu barang sampai tuntas sekaligus.
      </p>

      {noteOpen && (
        <div className="grid gap-3 rounded-xl border bg-muted/20 p-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Catatan opname</span>
            <Input
              placeholder="mis. Opname akhir bulan — barang busuk"
              value={note}
              maxLength={255}
              onChange={(e) => setNote(e.target.value)}
              onBlur={saveNote}
            />
          </label>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Waktu hitung</span>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-0.5 rounded-lg bg-muted p-0.75">
                {[
                  { on: false, label: "Sekarang" },
                  { on: true, label: "Waktu lain" },
                ].map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    onClick={() => chooseBackdate(o.on)}
                    aria-pressed={backdate === o.on}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                      backdate === o.on ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {backdate && (
                <Input
                  type="datetime-local"
                  value={countedAt}
                  min={bounds?.min}
                  max={bounds?.max}
                  onChange={(e) => setCountedAt(e.target.value)}
                  className="h-8 w-auto"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {backdate && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
          <Clock className="mt-0.5 size-4 shrink-0" />
          <span>
            {timeError ||
              (countedAtIso
                ? `Hitungan yang disimpan sekarang dicatat pada ${fmtWhen(countedAtIso)} dan dibandingkan dengan stok sistem saat itu. Pakai ini untuk hitungan di kertas yang belum sempat diinput — paling jauh ${MAX_BACKDATE_DAYS} hari lalu.`
                : "Isi waktu hitungnya.")}
          </span>
        </p>
      )}

      {needCostCount > 0 && (
        <p className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
          <span className="font-semibold">{needCostCount} produk belum punya HPP dari sistem.</span> Stoknya tidak
          pernah masuk lewat faktur pembelian, jadi sistem belum tahu harga belinya — yang hilang cuma angka{" "}
          <span className="font-medium">Dampak nilai</span>-nya.{" "}
          <span className="font-semibold">Kolom itu tidak wajib diisi.</span> Biarkan kosong kalau belum yakin:
          tidak ada yang berubah, dan opname tetap bisa diselesaikan. Barang yang{" "}
          <span className="font-medium">dibuat sendiri</span> tidak diisi di sini — HPP-nya dihitung dari bahan
          waktu kamu mencatat Produksi.
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Cari nama atau kode…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-lg bg-muted p-0.75 sm:ml-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setFilter(t.id)}
              aria-pressed={filter === t.id}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                filter === t.id ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              <span className="ml-1.5 tabular-nums opacity-60">{t.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Produk</th>
              <th className="px-3 py-2 text-right font-medium">Stok sistem</th>
              <th className="px-3 py-2 text-right font-medium">Hitung fisik</th>
              <th className="px-3 py-2 font-medium">Selisih</th>
              <th className="px-3 py-2 text-right font-medium">Dampak nilai</th>
              <th className="w-8 px-1 py-2" />
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => {
              const r = s.row;
              const tone = TONE[s.tone];
              const rej = rejected[r.id];
              return (
                <tr key={r.id} className={`border-b last:border-0 ${s.dirty ? "bg-amber-50/60 dark:bg-amber-950/20" : tone.row}`}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      <span className={`size-2 shrink-0 rounded-full ${tone.dot}`} />
                      <div className="min-w-0">
                        <p className="font-medium">{r.product_name}</p>
                        {rej ? (
                          <p className="text-xs text-destructive">{rejectedText(rej)}</p>
                        ) : s.dirty ? (
                          <p className="text-xs text-amber-700 dark:text-amber-400">Belum disimpan</p>
                        ) : s.line ? (
                          <p className="text-[11px] text-muted-foreground">
                            {r.code ? `${r.code} · ` : ""}
                            {s.line.skipped ? "Dilewati" : `Dihitung ${fmtWhen(s.line.countedAt)}`}
                            {s.line.countedBy ? ` · ${s.line.countedBy}` : ""}
                          </p>
                        ) : r.code ? (
                          <p className="font-mono text-[11px] text-muted-foreground">{r.code}</p>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-muted-foreground">
                    {s.system == null ? (
                      systemAtLoading ? (
                        <Loader2 className="ml-auto size-3.5 animate-spin" />
                      ) : (
                        "—"
                      )
                    ) : (
                      `${nfQty(s.system)} ${r.unit}`
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1.5">
                      {/* One click for the commonest answer: the shelf agrees. */}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy !== null || s.system == null}
                        onClick={() => setDrafts((d) => ({ ...d, [r.id]: String(s.system ?? "") }))}
                        className={s.tone === "ok" ? "border-green-300 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300" : ""}
                      >
                        Pas
                      </Button>
                      <div className="flex items-center overflow-hidden rounded-lg border bg-background">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          placeholder={s.line?.skipped ? "dilewati" : "—"}
                          value={s.draft ?? (s.line?.counted != null ? String(s.line.counted) : "")}
                          onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                          onKeyDown={onEnter}
                          aria-label={`Hitung fisik ${r.product_name}`}
                          className="h-8 w-20 bg-transparent px-2 text-right text-sm font-semibold tabular-nums outline-none"
                        />
                        <span className="flex h-8 items-center border-l bg-muted/50 px-2 text-[11px] font-semibold text-muted-foreground">
                          {r.unit}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${tone.chip}`}>
                      {tone.icon}{" "}
                      {s.delta == null || s.tone === "pending" || s.tone === "skipped"
                        ? tone.label
                        : deltaWords(s.delta, r.unit)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {/* Three states, deliberately different:
                          · the ledger priced it   -> just the rupiah
                          · only a hand-typed buying price -> rupiah marked as
                            an estimate, since nothing verified it
                          · no price anywhere      -> no rupiah can exist yet
                        Never a bare input: an HPP is a one-way door once the
                        opname is approved, and it only saves on a counted row. */}
                    {!r.needs_cost ? (
                      <span className={`text-sm font-medium tabular-nums ${impactChip(s.impact ?? 0)}`}>
                        {impactLabel(s.impact)}
                      </span>
                    ) : r.has_recipe ? (
                      // Made in-house, so its cost is not a thing anybody
                      // knows — it is the sum of what the batch consumed.
                      // Typing one here would answer a question the ledger
                      // computes exactly, and would then be stuck.
                      <div className="flex flex-col items-end">
                        <span className="text-xs text-muted-foreground">
                          {s.unitCost > 0 ? `HPP ${fmtIDR(s.unitCost)}/${r.unit} (perkiraan)` : "Belum ada HPP"}
                        </span>
                        <span className="text-[11px] text-muted-foreground/70">dihitung dari bahan saat Produksi</span>
                      </div>
                    ) : s.counted == null ? (
                      <div className="flex flex-col items-end">
                        <span className="text-xs text-muted-foreground">
                          {s.unitCost > 0 ? `HPP ${fmtIDR(s.unitCost)}/${r.unit} (perkiraan)` : "Belum ada HPP"}
                        </span>
                        <span className="text-[11px] text-muted-foreground/70">hitung dulu barangnya</span>
                      </div>
                    ) : s.unitCost > 0 ? (
                      <div className="flex flex-col items-end">
                        <span className={`text-sm font-medium tabular-nums ${impactChip(s.impact ?? 0)}`}>
                          {impactLabel(s.impact)}
                        </span>
                        <button
                          type="button"
                          onClick={() => openHpp(s)}
                          className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                        >
                          HPP {fmtIDR(s.unitCost)}/{r.unit}
                          {costDrafts[r.id] === undefined && s.line?.unitCost == null ? " (perkiraan)" : ""} · ubah
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-end">
                        <span className="text-xs text-muted-foreground">Belum ada HPP</span>
                        <button
                          type="button"
                          onClick={() => openHpp(s)}
                          className="text-[11px] font-semibold text-teal-700 hover:underline dark:text-teal-400"
                        >
                          Isi HPP (opsional)
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-1 py-2">
                    {s.dirty ? (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => dropDraft(r.id)}
                        aria-label={`Batalkan ketikan ${r.product_name}`}
                        title="Batalkan ketikan"
                      >
                        <X className="size-3.5" />
                      </Button>
                    ) : s.line ? (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => removeLine(r.id)}
                        disabled={busy !== null}
                        aria-label={`Hapus jawaban ${r.product_name}`}
                        title="Hapus jawaban — barang ini kembali belum dihitung"
                      >
                        <X className="size-3.5" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => saveRow(r.id, { skipped: true })}
                        disabled={busy !== null}
                        aria-label={`Lewati ${r.product_name}`}
                        title="Lewati — tidak bisa dihitung"
                      >
                        <SkipForward className="size-3.5" />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  {rows.length === 0 ? "Tidak ada produk yang dikelola stoknya." : "Tidak ada produk di sini."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {dropped.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {dropped.length} jawaban tidak ikut disesuaikan karena barangnya sudah dihapus atau tidak dikelola stoknya
          lagi: {dropped.map((l) => l.productName).join(", ")}.
        </p>
      )}

      {/* action bar */}
      <div className="sticky bottom-0 z-20 -mx-4 border-t bg-background md:-mx-6">
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 md:px-6">
          <div className="min-w-[180px] flex-1 space-y-1">
            <p className="text-[13px] font-semibold">
              {answeredCount} dari {rows.length} barang dihitung
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-teal-600 transition-[width]" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
          <div className="hidden flex-col lg:flex">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Selisih ditemukan
            </span>
            <span className="text-sm font-semibold">
              {minorList.length + majorList.length} barang ·{" "}
              <span className={impactChip(totalImpact)}>{impactLabel(totalImpact)}</span>
            </span>
          </div>
          <div className="basis-full text-xs sm:basis-auto">
            {error ? (
              <p className="font-medium text-destructive">{error}</p>
            ) : pending.length > 0 ? (
              <p className="text-amber-700 dark:text-amber-400">
                {pending.length} hitungan belum disimpan — tekan Enter atau Simpan.
              </p>
            ) : pendingCount > 0 ? (
              // Naming them, and going there, is the whole point: "1 barang
              // belum dihitung" in a 39-row list is a hunt, and a leftover
              // search or tab can be what is hiding the row in the first place.
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setFilter("todo");
                }}
                className="text-left text-amber-700 hover:underline dark:text-amber-400"
              >
                {pendingCount} barang belum dihitung: {pendingNames} — klik untuk lihat.
              </button>
            ) : (
              <p className="text-green-700 dark:text-green-400">Semua barang sudah dijawab.</p>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" onClick={() => setConfirm("cancel")} disabled={busy !== null}>
              Batalkan
            </Button>
            <Button variant="outline" onClick={save} disabled={busy !== null || pending.length === 0}>
              {busy === "save" && <Loader2 className="size-4 animate-spin" />}
              Simpan{pending.length > 0 ? ` (${pending.length})` : " draft"}
            </Button>
            <Button
              onClick={() => setView("review")}
              disabled={busy !== null || pending.length > 0 || pendingCount > 0}
              title={pendingCount > 0 ? "Semua barang harus dihitung atau dilewati dulu" : undefined}
              className="bg-teal-600 text-white hover:bg-teal-700"
            >
              Tinjau selisih <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {dialogs()}
    </div>
  );

  function hppDialog() {
    const st = hpp ? states.find((x) => x.row.id === hpp.productId) : null;
    if (!hpp || !st) return null;
    const r = st.row;
    const typed = Number(hpp.value);
    const valid = Number.isFinite(typed) && typed > 0;
    const onShelf = st.system ?? r.stock;
    const existing = costDrafts[r.id] !== undefined || st.line?.unitCost != null;
    const commit = () => {
      setCostDrafts((c) => ({ ...c, [r.id]: valid ? String(typed) : "" }));
      setHpp(null);
    };
    return (
      <AlertDialog open onOpenChange={(o) => !o && setHpp(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Isi HPP — {r.product_name}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Barang ini belum pernah masuk lewat faktur pembelian, jadi sistem tidak tahu harga belinya. Isi
                  hanya kalau kamu yakin harga aslinya — kalau tidak, kosongkan saja.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">
                Harga beli per <span className="font-semibold">1 {r.unit}</span>
              </span>
              <div className="flex items-center overflow-hidden rounded-lg border bg-background">
                <span className="flex h-10 items-center bg-muted/50 px-3 text-sm font-semibold text-muted-foreground">
                  Rp
                </span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  autoFocus
                  value={hpp.value}
                  onChange={(e) => setHpp({ productId: r.id, value: e.target.value })}
                  aria-label={`Harga beli per ${r.unit}`}
                  className="h-10 flex-1 bg-transparent px-3 text-right text-base font-semibold tabular-nums outline-none"
                />
                <span className="flex h-10 items-center border-l bg-muted/50 px-3 text-sm font-semibold text-muted-foreground">
                  / {r.unit}
                </span>
              </div>
            </label>

            {/* The unit trap, made visible: a price typed per sack against a
                per-kg unit shows up here as an absurd shelf value. */}
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-[13px]">
              {valid ? (
                <>
                  <p>
                    Stok {nfQty(onShelf)} {r.unit} × {fmtIDR(typed)} ={" "}
                    <span className="font-semibold">{fmtIDR(onShelf * typed)}</span> nilai stok.
                  </p>
                  <p className="mt-0.5 text-muted-foreground">
                    Pastikan ini harga untuk <span className="font-medium">satu {r.unit}</span>, bukan harga per
                    karung/dus/galon.
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">
                  Isi harga untuk satu {r.unit} — bukan harga per karung/dus/galon.
                </p>
              )}
            </div>

            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
              Masih bisa diubah selama opname ini belum disetujui. Setelah disetujui, angka ini jadi HPP resmi
              barang ini dan dipakai untuk menghitung <span className="font-medium">laba kotor</span> — opname tidak
              bisa mengubahnya lagi, hanya faktur pembelian yang akan mencampur harga baru.
            </p>
          </div>

          <AlertDialogFooter>
            {existing && (
              <Button
                variant="ghost"
                onClick={() => {
                  setCostDrafts((c) => ({ ...c, [r.id]: "" }));
                  setHpp(null);
                }}
              >
                Kosongkan
              </Button>
            )}
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                commit();
              }}
              disabled={!valid}
              className="bg-teal-600 text-white hover:bg-teal-700"
            >
              Pakai angka ini
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  function dialogs() {
    return (
      <>
        {hppDialog()}
        <AlertDialog open={confirm === "finish"} onOpenChange={(o) => !o && busy === null && setConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Terapkan hasil opname ke stok?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2">
                  <p>
                    {okCount} barang cocok, {minorList.length + majorList.length} berselisih
                    {skippedCount > 0 ? `, ${skippedCount} dilewati` : ""}. Dampak nilai stok{" "}
                    <span className="font-semibold">{impactLabel(totalImpact)}</span>.
                  </p>
                  <p>
                    Stok disesuaikan pada waktu masing-masing barang dihitung, tercatat di Alur Stok dan Riwayat
                    Opname.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy !== null}>Kembali</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  finish();
                }}
                disabled={busy !== null}
                className="bg-teal-600 text-white hover:bg-teal-700"
              >
                {busy === "finish" && <Loader2 className="size-4 animate-spin" />}
                <Check className="size-4" /> Setujui
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={confirm === "cancel"} onOpenChange={(o) => !o && busy === null && setConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Batalkan opname ini?</AlertDialogTitle>
              <AlertDialogDescription>
                {answeredCount > 0
                  ? `${answeredCount} jawaban di sesi ini tidak dipakai dan stok tidak berubah.`
                  : "Belum ada hitungan. Stok tidak berubah."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy !== null}>Kembali</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={(e) => {
                  e.preventDefault();
                  cancel();
                }}
                disabled={busy !== null}
              >
                {busy === "cancel" && <Loader2 className="size-4 animate-spin" />}
                Batalkan Opname
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }
}
