'use client';

/**
 * Jelajah Barang Jadi — Jelajah Resep turned around. Jelajah Resep starts at a
 * dish and opens what it is made of; this starts at a bahan and follows what it
 * BECOMES, stage by stage, like an evolution chart: Biji kopi → Espresso →
 * Americano, Latte. A product reached along two lines (espresso straight into a
 * latte, and through a Kopi Susu base) is ONE node with two lines into it — the
 * server returns a graph, not a tree, and the columns are its stages.
 *
 * Every number on a node is per ONE unit of that node: how much of the bahan
 * ends up in it, what that costs at the bahan's price today, and what share of
 * the node's HPP it is. A stock-tracked product on the way is a batch: its HPP
 * is the average fixed when it was made, so the bahan's price reaches it — and
 * everything made from it — only at the next Produksi. Those nodes show what
 * they contain but no live share, the same way Jelajah Resep draws what sits
 * below a batch boundary without counting it.
 *
 * The root is usually a bahan, but a sellable product another one is made from
 * (the item inside a Paket Hemat) opens here too. Never an add-on: it cannot
 * be an ingredient, so it has no line to draw.
 *
 * It is also where a product with no recipe gets its cost set (Paksa Hitung
 * HPP). One WITH a recipe is costed by that recipe, through Paksa Hitung HPP in
 * Jelajah Resep — one door per number.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Calculator, Loader2, PanelLeftClose, PanelLeftOpen, Sprout, Workflow } from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { Button } from '@/components/ui/button';
import {
    BreakdownRow,
    LegendDot,
    NF,
    NF1,
    StatGrid,
    StatTile,
    ToolbarButton,
    qtyFmt,
    rp,
    rp1,
} from '../../recipe-explorer/[productId]/recipe-explorer';
import { UnitCostDialog } from './unit-cost-dialog';

// ---------------------------------------------------------------------------
// Wire format (mirrors the endpoint)
// ---------------------------------------------------------------------------
export type ApiNode = {
    product_id: string;
    name: string;
    unit: string;
    category: string;
    track_stock: boolean;
    is_for_sale: boolean;
    available: boolean;
    price: number;
    unit_cost: number;
    stage: number;
    // Of the bahan, per ONE unit of this node: all of it, and the part whose
    // cost the node's HPP reads live (not locked inside a batch).
    root_qty: number;
    live_qty: number;
    sold_30d: number;
};

export type ApiEdge = { from: string; to: string; qty: number };

type ApiResponse = {
    success: boolean;
    product: {
        id: string;
        name: string;
        unit: string;
        category: string;
        barcode: string | null;
        track_stock: boolean;
        stock: number;
        unit_cost: number;
        booked_cost: number;
        has_recipe: boolean;
        daily_usage: number;
        days_left: number | null;
    };
    nodes: ApiNode[];
    edges: ApiEdge[];
    can_force_hpp: boolean;
    low_stock_days: number;
    cyclic: string[];
};

const COL_W = 300;
const ROW_H = 108;
const NODE_W = 212;
const HUB_W = 224;
const ROOT = '__root__';

type Kind = 'produk' | 'olahan' | 'batch' | 'addon';

// What a node IS, for its colour and tag. A bahan with a recipe is an
// intermediate (olahan), a batch when it keeps its own stock; anything else
// that is not an add-on is something the outlet sells.
const kindOf = (n: ApiNode): Kind => {
    const c = (n.category ?? '').trim().toLowerCase();
    if (c === 'tambahan') return 'addon';
    if (n.track_stock) return 'batch';
    if (c === 'bahan') return 'olahan';
    return 'produk';
};

const KIND_TAG: Record<Kind, string> = { produk: 'PRODUK', olahan: 'OLAHAN', batch: 'BATCH', addon: 'ADD-ON' };
const KIND_LABEL: Record<Kind, string> = {
    produk: 'Produk jadi',
    olahan: 'Olahan tanpa stok',
    batch: 'Olahan berstok (batch)',
    addon: 'Add-on',
};
const KIND_TAG_CLASS: Record<Kind, string> = {
    produk: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
    olahan: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300',
    batch: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200',
    addon: 'bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300',
};
const KIND_BG: Record<Kind, string> = {
    produk: 'bg-card',
    olahan: 'bg-indigo-50 dark:bg-indigo-950/30',
    batch: 'bg-indigo-50 border-dashed dark:bg-indigo-950/30',
    addon: 'bg-purple-50 dark:bg-purple-950/30',
};
const KIND_BORDER: Record<Kind, string> = {
    produk: 'border-emerald-300 dark:border-emerald-700/60',
    olahan: 'border-indigo-300 dark:border-indigo-500/50',
    batch: 'border-indigo-400 dark:border-indigo-500/60',
    addon: 'border-purple-300 dark:border-purple-500/50',
};

// Below this the bahan is "all of it live": float noise from multiplying
// recipe quantities must not flag a node as partly locked in a batch.
const EPS = 1e-9;

// ---------------------------------------------------------------------------
// Layout: one column per stage, ordered so lines cross as little as a single
// pass can manage — each node sits by the average height of what feeds it, and
// a column centres on its feeders, so a single line runs straight across.
// ---------------------------------------------------------------------------
type Placed = { x: number; y: number };

function layout(nodes: ApiNode[], incoming: Map<string, ApiEdge[]>) {
    const pos = new Map<string, Placed>([[ROOT, { x: 0, y: 0 }]]);
    const byStage = new Map<number, ApiNode[]>();
    for (const n of nodes) {
        // A recipe row with qty 0 can leave a node with no feeder at all; it
        // still belongs after the bahan, never on top of it.
        const s = Math.max(1, n.stage);
        const col = byStage.get(s);
        if (col) col.push(n);
        else byStage.set(s, [n]);
    }
    for (const s of [...byStage.keys()].sort((a, b) => a - b)) {
        const col = byStage.get(s)!.map((n) => {
            const ys = (incoming.get(n.product_id) ?? [])
                .map((e) => pos.get(e.from)?.y)
                .filter((y): y is number => y !== undefined);
            return { n, bary: ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0 };
        });
        col.sort((a, b) => a.bary - b.bary || a.n.name.localeCompare(b.n.name));
        const centre = col.reduce((a, c) => a + c.bary, 0) / col.length;
        const top = centre - ((col.length - 1) * ROW_H) / 2;
        col.forEach((c, i) => pos.set(c.n.product_id, { x: s * COL_W, y: top + i * ROW_H }));
    }
    return pos;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
type UIState = {
    selected: string | null;
    zoom: number;
    pan: { x: number; y: number };
    view: 'Diagram' | 'Tabel';
    offsets: Record<string, { x: number; y: number }>;
    dragKey: string | null;
    panelOpen: boolean;
    w: number;
};

export function FinishedGoodsExplorer({ productId, productName }: { productId: string; productName: string | null }) {
    const [fetched, setFetched] = useState<{ data: ApiResponse | null; error: string | null } | null>(null);
    const data = fetched?.data ?? null;
    const error = fetched?.error ?? null;
    const [reloadKey, setReloadKey] = useState(0);
    const [costOpen, setCostOpen] = useState(false);
    const [applied, setApplied] = useState<{ changed: number } | null>(null);
    // The same 5-second breather Paksa Hitung HPP takes after an apply.
    const [cooldownUntil, setCooldownUntil] = useState(0);
    const [now, setNow] = useState(0);
    useEffect(() => {
        if (!cooldownUntil) return;
        const tick = () => {
            const t = Date.now();
            setNow(t);
            if (t >= cooldownUntil) setCooldownUntil(0);
        };
        tick();
        const h = setInterval(tick, 250);
        return () => clearInterval(h);
    }, [cooldownUntil]);
    const cooldownSecs = cooldownUntil ? Math.max(1, Math.ceil((cooldownUntil - now) / 1000)) : 0;

    const [ui, setUi] = useState<UIState>({
        selected: null,
        zoom: 0.7,
        pan: { x: 0, y: 0 },
        view: 'Diagram',
        offsets: {},
        dragKey: null,
        panelOpen: true,
        w: 1440,
    });
    const patch = (p: Partial<UIState> | ((s: UIState) => Partial<UIState>)) =>
        setUi((s) => ({ ...s, ...(typeof p === 'function' ? p(s) : p) }));

    const canvasRef = useRef<HTMLDivElement>(null);
    const bboxRef = useRef<{ w: number; h: number; cx: number; cy: number } | null>(null);
    const dragState = useRef<{ x: number; y: number; pan: { x: number; y: number }; moved: boolean; id: number; el: HTMLElement } | null>(null);
    const nodeDragState = useRef<{ key: string; x: number; y: number; start: { x: number; y: number }; moved: boolean } | null>(null);
    const justDraggedRef = useRef(false);

    const fit = useCallback(() => {
        const el = canvasRef.current;
        const bb = bboxRef.current;
        if (!el || !bb) return;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const zoom = Math.max(0.28, Math.min(1.2, Math.min((r.width - 48) / bb.w, (r.height - 48) / bb.h)));
        patch({ zoom, pan: { x: -bb.cx * zoom, y: -bb.cy * zoom } });
    }, []);
    const refit = useCallback(() => {
        requestAnimationFrame(() => requestAnimationFrame(() => fit()));
    }, [fit]);

    useEffect(() => {
        let alive = true;
        fetch(`${API_URL}/api/products/${productId}/finished-goods`, { credentials: 'include' })
            .then(async (res) => {
                const json = (await res.json().catch(() => null)) as ApiResponse | null;
                if (!alive) return;
                setFetched(
                    !res.ok || !json?.success
                        ? {
                              data: null,
                              error:
                                  res.status === 404
                                      ? 'Produk ini tidak ada di outlet pian.'
                                      : res.status === 403
                                        ? ((json as { error?: string } | null)?.error ?? 'Fitur ini belum termasuk paket pian.')
                                        : 'Gagal memuat barang jadi.',
                          }
                        : { data: json, error: null },
                );
            })
            .catch(() => alive && setFetched({ data: null, error: 'Gagal menghubungi server.' }));
        return () => {
            alive = false;
        };
    }, [productId, reloadKey]);

    useEffect(() => {
        const el = canvasRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            setUi((s) => ({ ...s, zoom: Math.min(1.7, Math.max(0.28, s.zoom * (e.deltaY > 0 ? 0.92 : 1.08))) }));
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        const onResize = () => {
            patch({ w: window.innerWidth });
            fit();
        };
        window.addEventListener('resize', onResize);
        patch({ w: window.innerWidth });
        requestAnimationFrame(() => fit());
        return () => {
            el.removeEventListener('wheel', onWheel);
            window.removeEventListener('resize', onResize);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data, ui.view]);

    const togglePanel = () => {
        patch((s) => ({ panelOpen: !s.panelOpen }));
        refit();
    };

    // Pointer handling is Jelajah Resep's, unchanged: capture on the first real
    // move (never on pointerdown, which would swallow clicks on the cards), and
    // a drag that moved never also counts as a click.
    const onCanvasDown = (e: React.PointerEvent) => {
        dragState.current = { x: e.clientX, y: e.clientY, pan: { ...ui.pan }, moved: false, id: e.pointerId, el: e.currentTarget as HTMLElement };
    };
    const onCanvasMove = (e: React.PointerEvent) => {
        const d = dragState.current;
        if (!d) return;
        if (e.buttons === 0 && !d.moved) {
            dragState.current = null;
            return;
        }
        const dx = e.clientX - d.x,
            dy = e.clientY - d.y;
        if (!d.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
            d.moved = true;
            d.el.setPointerCapture?.(d.id);
        }
        if (d.moved) patch({ pan: { x: d.pan.x + dx, y: d.pan.y + dy } });
    };
    const onCanvasUp = () => {
        const d = dragState.current;
        dragState.current = null;
        justDraggedRef.current = !!(d && d.moved);
    };
    const pick = (key: string | null) => {
        if (justDraggedRef.current) return;
        patch({ selected: key });
    };
    const nodeDown = (key: string, e: React.PointerEvent) => {
        e.stopPropagation();
        justDraggedRef.current = false;
        nodeDragState.current = { key, x: e.clientX, y: e.clientY, start: ui.offsets[key] || { x: 0, y: 0 }, moved: false };
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        patch({ dragKey: key });
    };
    const nodeMove = (e: React.PointerEvent) => {
        const d = nodeDragState.current;
        if (!d) return;
        const dx = (e.clientX - d.x) / ui.zoom,
            dy = (e.clientY - d.y) / ui.zoom;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
        if (d.moved) patch((s) => ({ offsets: { ...s.offsets, [d.key]: { x: d.start.x + dx, y: d.start.y + dy } } }));
    };
    const nodeUp = () => {
        const d = nodeDragState.current;
        nodeDragState.current = null;
        justDraggedRef.current = !!(d && d.moved);
        patch({ dragKey: null });
    };

    // ---- derived view model ----
    const nodes = useMemo(() => data?.nodes ?? [], [data]);
    const edges = useMemo(() => data?.edges ?? [], [data]);
    const rootId = data?.product.id ?? productId;
    // The bahan is keyed ROOT on the canvas so the hub never collides with a
    // node id; edges from it are rewritten once here.
    const keyOf = useCallback((id: string) => (id === rootId ? ROOT : id), [rootId]);
    const { incoming, outgoing } = useMemo(() => {
        const inc = new Map<string, ApiEdge[]>();
        const out = new Map<string, ApiEdge[]>();
        for (const e of edges) {
            const k = { from: keyOf(e.from), to: keyOf(e.to), qty: e.qty };
            inc.set(k.to, [...(inc.get(k.to) ?? []), k]);
            out.set(k.from, [...(out.get(k.from) ?? []), k]);
        }
        return { incoming: inc, outgoing: out };
    }, [edges, keyOf]);
    const byId = useMemo(() => new Map(nodes.map((n) => [n.product_id, n])), [nodes]);
    const base = useMemo(() => layout(nodes, incoming), [nodes, incoming]);
    const pos = useMemo(() => {
        const m = new Map<string, Placed>();
        for (const [k, p] of base) {
            const o = ui.offsets[k];
            m.set(k, o ? { x: p.x + o.x, y: p.y + o.y } : p);
        }
        return m;
    }, [base, ui.offsets]);

    // Clicking a node lights its whole line: everything it came from, back to
    // the bahan, and everything it goes on to become.
    const lineage = useMemo(() => {
        const sel = ui.selected;
        if (!sel) return null;
        const walk = (start: string, next: Map<string, ApiEdge[]>, side: 'from' | 'to') => {
            const seen = new Set([start]);
            const stack = [start];
            while (stack.length) {
                for (const e of next.get(stack.pop()!) ?? []) {
                    const k = e[side];
                    if (!seen.has(k)) {
                        seen.add(k);
                        stack.push(k);
                    }
                }
            }
            return seen;
        };
        const up = walk(sel, incoming, 'from');
        const down = walk(sel, outgoing, 'to');
        return {
            nodes: new Set([...up, ...down]),
            edge: (e: ApiEdge) => (up.has(e.from) && up.has(e.to)) || (down.has(e.from) && down.has(e.to)),
        };
    }, [ui.selected, incoming, outgoing]);

    const bbox = useMemo(() => {
        let x0 = -HUB_W / 2 - 20,
            x1 = HUB_W / 2 + 20,
            y0 = -80,
            y1 = 80;
        for (const [k, p] of pos) {
            const hw = (k === ROOT ? HUB_W : NODE_W) / 2 + 12;
            x0 = Math.min(x0, p.x - hw);
            x1 = Math.max(x1, p.x + hw);
            y0 = Math.min(y0, p.y - 50);
            y1 = Math.max(y1, p.y + 50);
        }
        return { w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
    }, [pos]);
    useLayoutEffect(() => {
        bboxRef.current = bbox;
    }, [bbox]);

    // ---- shells ----
    if (!fetched) {
        return (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-2xl border bg-background">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Memuat barang jadi {productName ?? 'bahan'}…
                </div>
            </div>
        );
    }
    if (error || !data) {
        return (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-2xl border bg-background p-8 text-center">
                <p className="text-sm text-muted-foreground">{error ?? 'Gagal memuat barang jadi.'}</p>
                <Link href="/dashboard/addproducts" className="rounded-xl border px-3 py-1.5 text-sm font-semibold hover:bg-muted">
                    Kembali ke etalase
                </Link>
            </div>
        );
    }

    const p = data.product;
    // A bahan, or a sellable product another one is made from (Paket Hemat).
    const isBahan = (p.category ?? '').trim().toLowerCase() === 'bahan';
    const rootLabel = isBahan ? 'Bahan' : 'Produk';
    const unitCost = p.unit_cost;
    const unitWord = p.unit || 'unit';
    const lowStockDays = data.low_stock_days;
    const low = p.days_left !== null && p.days_left < lowStockDays;
    const hasNodes = nodes.length > 0;
    const finals = nodes.filter((n) => !(outgoing.get(n.product_id)?.length));
    const bookedGap = Math.abs(p.booked_cost - unitCost) >= 0.0001;
    const sel = ui.selected && ui.selected !== ROOT ? byId.get(ui.selected) ?? null : null;
    const nameOf = (k: string) => (k === ROOT ? p.name : byId.get(k)?.name ?? '—');

    const shareOf = (n: ApiNode) => (n.unit_cost > 0 ? Math.min(1, (n.live_qty * unitCost) / n.unit_cost) : 0);
    const viaBatch = (n: ApiNode) => n.live_qty < n.root_qty - EPS;

    const tableRows = [...nodes].sort((a, b) => a.stage - b.stage || a.name.localeCompare(b.name));

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-background">
            {/* ---- top bar ---- */}
            <div className="flex flex-none flex-wrap items-center gap-3 border-b bg-background px-3 py-2.5 md:px-4">
                <Link
                    href="/dashboard/addproducts"
                    className="flex items-center gap-1 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label="Kembali ke etalase"
                >
                    <ArrowLeft className="h-4 w-4" />
                </Link>
                <div className="flex min-w-0 items-baseline gap-2">
                    <span className="text-xs font-medium text-muted-foreground">{rootLabel}</span>
                    <span className="text-xs text-muted-foreground/60">/</span>
                    <span className="truncate text-[17px] font-bold tracking-tight">{p.name}</span>
                    {p.barcode && (
                        <span className="whitespace-nowrap rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-muted-foreground">
                            {p.barcode}
                        </span>
                    )}
                </div>
                <div className="ml-auto flex gap-0.5 rounded-[10px] bg-muted p-[3px]">
                    {(['Diagram', 'Tabel'] as const).map((v) => (
                        <button
                            key={v}
                            type="button"
                            onClick={() => patch({ view: v })}
                            className={`rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold transition-all ${
                                ui.view === v ? 'bg-background shadow-sm' : 'text-muted-foreground'
                            }`}
                        >
                            {v === 'Diagram' ? 'Garis barang jadi' : 'Tabel produk'}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
                {/* ---- left: the bahan and its cost (collapsible) ---- */}
                {!ui.panelOpen && (
                    <div className="flex flex-none items-center gap-2.5 border-b bg-background px-3 py-2 lg:w-11 lg:flex-col lg:gap-3 lg:border-b-0 lg:border-r lg:px-0 lg:py-3">
                        <button
                            type="button"
                            onClick={togglePanel}
                            aria-label="Tampilkan panel bahan"
                            aria-expanded={false}
                            title="Tampilkan panel bahan"
                            className="flex-none rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                            <PanelLeftOpen className="h-4 w-4" />
                        </button>
                        <div className="truncate font-mono text-[11px] text-muted-foreground lg:min-h-0 lg:flex-1 lg:rotate-180 lg:[writing-mode:vertical-rl]">
                            HPP {rp1(unitCost)}/{unitWord} · {nodes.length} produk
                        </div>
                    </div>
                )}
                <div
                    className={`flex-none flex-col gap-3.5 overflow-y-auto border-b bg-background p-4 lg:border-b-0 lg:border-r ${
                        ui.panelOpen ? 'flex lg:w-[clamp(232px,23vw,316px)]' : 'hidden'
                    }`}
                >
                    <div className="flex items-center gap-3">
                        <div className="flex h-16 w-16 flex-none items-center justify-center rounded-[14px] bg-gradient-to-br from-zinc-100 to-zinc-200 font-mono text-lg font-semibold text-zinc-700 dark:from-zinc-800 dark:to-zinc-700 dark:text-zinc-200">
                            {p.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <div className="truncate text-[14.5px] font-bold leading-tight">{p.name}</div>
                            <div className="text-[11.5px] text-muted-foreground">
                                {isBahan ? (p.has_recipe ? 'Bahan olahan' : 'Bahan baku') : 'Produk'} · per {unitWord}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={togglePanel}
                            aria-label="Sembunyikan panel bahan"
                            aria-expanded
                            title="Sembunyikan panel bahan"
                            className="flex-none self-start rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                            <PanelLeftClose className="h-4 w-4" />
                        </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <StatTile label={`HPP / ${unitWord}`} value={rp1(unitCost)} />
                        <StatTile label="Stok" value={p.track_stock ? `${qtyFmt(p.stock)} ${unitWord}` : '—'} />
                        <StatTile
                            label="Perkiraan habis"
                            value={p.days_left !== null ? `${NF1.format(p.days_left)} hari` : '—'}
                            valueClassName={p.days_left === null ? undefined : low ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}
                        />
                        <StatTile label="Jadi produk" value={NF.format(nodes.length)} />
                    </div>

                    <div
                        className={`rounded-xl border px-2.5 py-2 ${
                            bookedGap ? 'border-amber-300 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-950/30' : 'bg-muted/40'
                        }`}
                    >
                        <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Tercatat saat terpakai
                            </span>
                            <span className="font-mono text-base font-semibold">{rp1(p.booked_cost)}</span>
                        </div>
                        {bookedGap && (
                            <p className="mt-1 text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
                                {p.booked_cost <= 0
                                    ? `Stok ${p.name} belum punya biaya — resep yang memakainya mencatat Rp 0 saat terjual. HPP ${rp1(unitCost)} di halaman ini baru dari harga beli yang diketik.`
                                    : `Belum sama dengan HPP ${rp1(unitCost)} di halaman ini. Laporan laba memakai angka ini.`}
                            </p>
                        )}
                        {applied && (
                            <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                                {applied.changed ? 'Tersimpan.' : 'Tidak ada yang berubah.'}
                            </p>
                        )}
                        {data.can_force_hpp &&
                            (p.has_recipe ? (
                                <Button size="sm" variant="outline" className="mt-2 w-full" asChild>
                                    <Link href={`/dashboard/addproducts/recipe-explorer/${p.id}?name=${encodeURIComponent(p.name)}`}>
                                        <Workflow />
                                        Atur HPP di Jelajah Resep
                                    </Link>
                                </Button>
                            ) : (
                                <Button
                                    size="sm"
                                    variant={bookedGap ? 'default' : 'outline'}
                                    className="mt-2 w-full"
                                    disabled={cooldownSecs > 0}
                                    onClick={() => setCostOpen(true)}
                                >
                                    <Calculator />
                                    {cooldownSecs > 0 ? `Tunggu ${cooldownSecs} dtk` : 'Paksa Hitung HPP'}
                                </Button>
                            ))}
                    </div>

                    {data.cyclic.length > 0 && (
                        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
                            <span className="font-semibold">Resep berputar:</span> {data.cyclic.join(', ')} memakai dirinya sendiri, jadi
                            angkanya tidak bisa dipercaya. Perbaiki resepnya dulu.
                        </div>
                    )}

                    <div className="rounded-[10px] border border-dashed bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                        Semua angka di sini per satu unit produknya: berapa {p.name} yang ada di dalamnya, berapa biayanya dengan HPP{' '}
                        {p.name} hari ini, dan berapa bagian HPP produk itu.
                    </div>
                </div>

                {!hasNodes ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
                        <div className="rounded-full bg-muted p-3 text-muted-foreground">
                            <Sprout className="h-6 w-6" />
                        </div>
                        <h3 className="font-bold">Belum jadi apa-apa</h3>
                        <p className="max-w-sm text-sm text-muted-foreground">
                            {p.name} belum dipakai di resep mana pun. Masukkan ke resep sebuah produk dari form produk di etalase —
                            garis barang jadinya muncul sendiri di sini.
                        </p>
                    </div>
                ) : ui.view === 'Diagram' ? (
                    <>
                        {/* ---- center: canvas ---- */}
                        <div className="flex min-h-[420px] flex-1 flex-col overflow-hidden lg:min-w-0">
                            <div className="flex flex-none flex-wrap items-center gap-2.5 border-b bg-background px-3.5 py-2.5">
                                {ui.w >= 1240 && (
                                    <div className="flex flex-wrap items-center gap-3.5 text-[11px] text-foreground/80">
                                        <LegendDot className="border-[1.5px] border-emerald-400 bg-background" label="Produk jadi" />
                                        <LegendDot className="border-[1.5px] border-indigo-400 bg-indigo-50 dark:bg-indigo-950/40" label="Olahan" />
                                        <LegendDot className="border-[1.5px] border-dashed border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40" label="Batch" />
                                        <LegendDot className="border-[1.5px] border-purple-400 bg-purple-50 dark:bg-purple-950/40" label="Add-on" />
                                    </div>
                                )}
                                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() => patch((s) => ({ zoom: Math.max(0.28, s.zoom / 1.15) }))}
                                        className="h-7 w-7 rounded-lg border bg-background text-sm font-semibold text-foreground/80 hover:bg-muted"
                                    >
                                        −
                                    </button>
                                    <span className="w-[42px] text-center font-mono text-[11.5px] font-medium text-foreground/80">
                                        {Math.round(ui.zoom * 100)}%
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => patch((s) => ({ zoom: Math.min(1.7, s.zoom * 1.15) }))}
                                        className="h-7 w-7 rounded-lg border bg-background text-sm font-semibold text-foreground/80 hover:bg-muted"
                                    >
                                        +
                                    </button>
                                    {Object.keys(ui.offsets).length > 0 && (
                                        <ToolbarButton
                                            onClick={() => {
                                                patch({ offsets: {} });
                                                refit();
                                            }}
                                            className="border-rose-200 text-rose-600 dark:border-rose-900 dark:text-rose-400"
                                        >
                                            Rapikan node
                                        </ToolbarButton>
                                    )}
                                    <button
                                        type="button"
                                        onClick={fit}
                                        className="rounded-lg border border-primary bg-primary px-2.5 py-1.5 text-[11.5px] font-semibold text-primary-foreground"
                                    >
                                        Pas layar
                                    </button>
                                </div>
                            </div>

                            <div
                                ref={canvasRef}
                                onPointerDown={onCanvasDown}
                                onPointerMove={onCanvasMove}
                                onPointerUp={onCanvasUp}
                                onPointerCancel={onCanvasUp}
                                onClick={() => pick(null)}
                                className="relative flex-1 touch-none overflow-hidden"
                                style={{
                                    cursor: 'grab',
                                    backgroundColor: 'var(--muted)',
                                    backgroundImage: 'radial-gradient(var(--border) 1px, transparent 1px)',
                                    backgroundSize: '22px 22px',
                                }}
                            >
                                <div
                                    className="absolute left-1/2 top-1/2 h-0 w-0"
                                    style={{ transform: `translate(${ui.pan.x}px,${ui.pan.y}px) scale(${ui.zoom})` }}
                                >
                                    {/* ---- lines ---- */}
                                    <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
                                        {edges.map((raw) => {
                                            const e = { from: keyOf(raw.from), to: keyOf(raw.to), qty: raw.qty };
                                            const a = pos.get(e.from);
                                            const b = pos.get(e.to);
                                            if (!a || !b) return null;
                                            const x1 = a.x + (e.from === ROOT ? HUB_W : NODE_W) / 2;
                                            const x2 = b.x - NODE_W / 2;
                                            const dx = Math.max(40, (x2 - x1) / 2);
                                            const lit = lineage?.edge(e) ?? false;
                                            const dim = !!lineage && !lit;
                                            const target = byId.get(e.to);
                                            // A line out of a batch carries the batch's own cost,
                                            // not the bahan's — drawn dashed, like Jelajah Resep.
                                            const fromBatch = e.from !== ROOT && byId.get(e.from)?.track_stock;
                                            return (
                                                <g key={`${e.from}>${e.to}`} opacity={dim ? 0.25 : 1}>
                                                    <path
                                                        d={`M${x1},${a.y} C${x1 + dx},${a.y} ${x2 - dx},${b.y} ${x2},${b.y}`}
                                                        fill="none"
                                                        stroke={lit ? '#e11d48' : fromBatch ? '#a5b4fc' : 'var(--border)'}
                                                        strokeWidth={lit ? 2.5 : 1.75}
                                                        strokeDasharray={fromBatch ? '6 5' : undefined}
                                                    />
                                                    {lit && target && (
                                                        <text
                                                            x={(x1 + x2) / 2}
                                                            y={(a.y + b.y) / 2 - 6}
                                                            textAnchor="middle"
                                                            className="fill-rose-600 font-mono text-[11px] font-semibold dark:fill-rose-400"
                                                        >
                                                            {qtyFmt(e.qty)} {e.from === ROOT ? unitWord : byId.get(e.from)?.unit} / {target.unit}
                                                        </text>
                                                    )}
                                                </g>
                                            );
                                        })}
                                    </svg>

                                    {/* ---- nodes ---- */}
                                    {nodes.map((n) => {
                                        const at = pos.get(n.product_id);
                                        if (!at) return null;
                                        const kind = kindOf(n);
                                        const on = ui.selected === n.product_id;
                                        const dim = !!lineage && !lineage.nodes.has(n.product_id);
                                        const dragging = ui.dragKey === n.product_id;
                                        const share = shareOf(n);
                                        const batchy = viaBatch(n);
                                        return (
                                            <div
                                                key={n.product_id}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    pick(n.product_id);
                                                }}
                                                onPointerDown={(e) => nodeDown(n.product_id, e)}
                                                onPointerMove={nodeMove}
                                                onPointerUp={nodeUp}
                                                className={`absolute left-0 top-0 touch-none rounded-xl border-[1.5px] p-2.5 ${KIND_BG[kind]} ${
                                                    on ? 'border-primary' : KIND_BORDER[kind]
                                                }`}
                                                style={{
                                                    width: NODE_W,
                                                    cursor: dragging ? 'grabbing' : 'grab',
                                                    opacity: dim ? 0.35 : 1,
                                                    transition: dragging
                                                        ? 'box-shadow 180ms'
                                                        : 'transform 420ms cubic-bezier(.22,1,.36,1),box-shadow 180ms,opacity 180ms',
                                                    boxShadow: dragging
                                                        ? '0 18px 40px rgba(0,0,0,0.22)'
                                                        : on
                                                          ? '0 10px 26px rgba(0,0,0,0.16)'
                                                          : '0 2px 6px rgba(0,0,0,0.05)',
                                                    transform: `translate(${Math.round(at.x)}px,${Math.round(at.y)}px) translate(-50%,-50%) scale(${dragging ? 1.08 : on ? 1.05 : 1})`,
                                                    zIndex: dragging ? 6 : on ? 4 : 2,
                                                    animation: 'nodeIn 260ms ease both',
                                                }}
                                            >
                                                <div className="flex items-start gap-1.5">
                                                    <div className="min-w-0 flex-1 truncate text-[12.5px] font-semibold leading-tight">{n.name}</div>
                                                    <span className={`flex-none rounded px-1 py-px font-mono text-[9.5px] font-semibold ${KIND_TAG_CLASS[kind]}`}>
                                                        {KIND_TAG[kind]}
                                                    </span>
                                                </div>
                                                <div className="mt-1 flex items-baseline justify-between gap-2 font-mono text-[10.5px]">
                                                    <span className="truncate text-muted-foreground">
                                                        {qtyFmt(n.root_qty)} {unitWord} / {n.unit}
                                                    </span>
                                                    <span className="font-semibold">{rp(n.root_qty * unitCost)}</span>
                                                </div>
                                                {batchy ? (
                                                    <div className="mt-1.5 text-[10px] text-indigo-700 dark:text-indigo-300">
                                                        {n.track_stock ? 'HPP dari batch' : 'sebagian lewat batch'}
                                                    </div>
                                                ) : (
                                                    <div className="mt-1.5 flex items-center gap-2">
                                                        <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-muted">
                                                            <div
                                                                className="h-full rounded-full transition-[width] duration-300"
                                                                style={{
                                                                    width: `${Math.max(2, Math.round(share * 100))}%`,
                                                                    background: share > 0.25 ? '#e11d48' : share > 0.1 ? '#f59e0b' : 'var(--border)',
                                                                }}
                                                            />
                                                        </div>
                                                        <span className="font-mono text-[10px] text-muted-foreground">{Math.round(share * 100)}% HPP</span>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}

                                    {/* ---- the bahan: where every line starts ---- */}
                                    <div
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            pick(null);
                                        }}
                                        className={`absolute left-0 top-0 z-[5] cursor-pointer rounded-2xl bg-primary p-3.5 text-primary-foreground shadow-[0_12px_34px_rgba(0,0,0,0.22)] ${
                                            ui.selected === null ? 'ring-2 ring-primary/40 ring-offset-2 ring-offset-background' : ''
                                        }`}
                                        style={{ width: HUB_W, transform: 'translate(-50%,-50%)' }}
                                    >
                                        <div className="text-[10px] font-bold uppercase tracking-wide text-primary-foreground/50">{rootLabel}</div>
                                        <div className="mt-1 text-[15.5px] font-bold leading-tight">{p.name}</div>
                                        <div className="my-2.5 h-px bg-primary-foreground/10" />
                                        <div className="flex items-baseline justify-between">
                                            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-primary-foreground/50">HPP</span>
                                            <span className="font-mono text-[15px] font-semibold">
                                                {rp1(unitCost)}/{unitWord}
                                            </span>
                                        </div>
                                        <div className="mt-1 flex items-baseline justify-between">
                                            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-primary-foreground/50">Stok</span>
                                            <span className={`font-mono text-[12.5px] font-semibold ${low ? 'text-rose-300' : ''}`}>
                                                {p.track_stock ? `${qtyFmt(p.stock)} ${unitWord}` : '—'}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="absolute bottom-3.5 left-4 rounded-lg bg-background/80 px-2.5 py-1.5 text-[11px] text-muted-foreground backdrop-blur-sm">
                                    Klik produk untuk menyalakan garisnya · tarik node untuk memindahkannya · tarik kanvas untuk geser · scroll untuk zoom
                                </div>
                            </div>
                        </div>

                        {/* ---- right: selection detail ---- */}
                        <div className="flex-none overflow-y-auto border-t bg-background lg:w-[clamp(252px,25vw,340px)] lg:border-l lg:border-t-0">
                            {sel ? (
                                <NodePanel
                                    n={sel}
                                    bahan={p.name}
                                    bahanUnit={unitWord}
                                    unitCost={unitCost}
                                    share={shareOf(sel)}
                                    viaBatch={viaBatch(sel)}
                                    from={(incoming.get(sel.product_id) ?? []).map((e) => ({ key: e.from, name: nameOf(e.from), qty: e.qty, unit: e.from === ROOT ? unitWord : byId.get(e.from)?.unit ?? '' }))}
                                    into={(outgoing.get(sel.product_id) ?? []).map((e) => ({ key: e.to, name: nameOf(e.to), qty: e.qty, unit: byId.get(e.to)?.unit ?? '' }))}
                                    pick={pick}
                                />
                            ) : (
                                <SummaryPanel
                                    rootLabel={rootLabel}
                                    bahan={p.name}
                                    unitWord={unitWord}
                                    unitCost={unitCost}
                                    stages={Math.max(0, ...nodes.map((n) => n.stage))}
                                    count={nodes.length}
                                    finals={finals}
                                    shareOf={shareOf}
                                    pick={pick}
                                />
                            )}
                        </div>
                    </>
                ) : (
                    /* ---- table view ---- */
                    <div className="min-w-0 flex-1 overflow-auto p-4 md:p-5">
                        <div className="mb-3 flex flex-wrap items-baseline gap-2.5">
                            <div className="text-[14.5px] font-bold">Produk yang memakai {p.name}</div>
                            <div className="text-xs text-muted-foreground">
                                {nodes.length} produk · HPP {p.name} {rp1(unitCost)}/{unitWord}
                            </div>
                        </div>
                        <div className="overflow-hidden rounded-2xl border bg-background">
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-muted/50 text-left text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                                            <th className="px-3.5 py-2.5">Produk</th>
                                            <th className="px-3.5 py-2.5 text-right">Tahap</th>
                                            <th className="px-3.5 py-2.5 text-right">Isi {p.name}</th>
                                            <th className="px-3.5 py-2.5 text-right">Biaya {p.name}</th>
                                            <th className="px-3.5 py-2.5 text-right">HPP produk</th>
                                            <th className="px-3.5 py-2.5 text-right">Porsi HPP</th>
                                            <th className="px-3.5 py-2.5 text-right">Terjual 30h</th>
                                            <th className="px-3.5 py-2.5 text-right">Pakai 30h</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {tableRows.map((n) => {
                                            const kind = kindOf(n);
                                            const batchy = viaBatch(n);
                                            return (
                                                <tr key={n.product_id} className="border-t text-[12.5px]">
                                                    <td className="px-3.5 py-2.5">
                                                        <div className="flex items-center gap-2">
                                                            <span className="truncate font-semibold">{n.name}</span>
                                                            <span className={`rounded px-1 py-px font-mono text-[9.5px] font-semibold ${KIND_TAG_CLASS[kind]}`}>
                                                                {KIND_TAG[kind]}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="px-3.5 py-2.5 text-right font-mono text-muted-foreground">{Math.max(1, n.stage)}</td>
                                                    <td className="px-3.5 py-2.5 text-right font-mono">
                                                        {qtyFmt(n.root_qty)} {unitWord}/{n.unit}
                                                    </td>
                                                    <td className="px-3.5 py-2.5 text-right font-mono font-semibold">{rp(n.root_qty * unitCost)}</td>
                                                    <td className="px-3.5 py-2.5 text-right font-mono text-muted-foreground">{rp(n.unit_cost)}</td>
                                                    <td className="px-3.5 py-2.5 text-right font-mono">
                                                        {batchy ? (
                                                            <span className="text-[11px] text-indigo-700 dark:text-indigo-300">lewat batch</span>
                                                        ) : (
                                                            `${Math.round(shareOf(n) * 100)}%`
                                                        )}
                                                    </td>
                                                    <td className="px-3.5 py-2.5 text-right font-mono text-muted-foreground">
                                                        {n.sold_30d ? NF.format(n.sold_30d) : '—'}
                                                    </td>
                                                    <td className="px-3.5 py-2.5 text-right font-mono">
                                                        {n.sold_30d ? `${qtyFmt(n.sold_30d * n.root_qty)} ${unitWord}` : '—'}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                            “Isi” dihitung lewat semua jalur resep. “Porsi HPP” hanya untuk produk yang HPP-nya membaca harga{' '}
                            {p.name} hari ini — produk yang lewat olahan berstok (batch) memakai biaya batch yang terkunci saat diproduksi.
                            “Pakai 30h” adalah perkiraan dari penjualan produk itu sendiri, bukan dari produk lanjutannya.
                        </p>
                    </div>
                )}
            </div>

            {costOpen && data.can_force_hpp && !p.has_recipe && (
                <UnitCostDialog
                    productId={p.id}
                    unitCost={unitCost}
                    bookedCost={p.booked_cost}
                    nodes={nodes}
                    onClose={() => setCostOpen(false)}
                    onApplied={(r) => {
                        setApplied({ changed: r.changed });
                        setCooldownUntil(Date.now() + 5000);
                        setReloadKey((k) => k + 1);
                    }}
                />
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------
function SummaryPanel({
    rootLabel,
    bahan,
    unitWord,
    unitCost,
    stages,
    count,
    finals,
    shareOf,
    pick,
}: {
    rootLabel: string;
    bahan: string;
    unitWord: string;
    unitCost: number;
    stages: number;
    count: number;
    finals: ApiNode[];
    shareOf: (n: ApiNode) => number;
    pick: (key: string | null) => void;
}) {
    const sold = finals.reduce((s, n) => s + n.sold_30d * n.root_qty, 0);
    const stats = [
        { label: `HPP ${rootLabel.toLowerCase()}`, value: rp1(unitCost), note: `per ${unitWord}` },
        { label: 'Produk', value: NF.format(count), note: `${NF.format(finals.length)} di ujung garis` },
        { label: 'Tahap', value: NF.format(stages), note: stages > 1 ? 'lewat olahan' : 'langsung jadi produk' },
        { label: 'Pakai 30h', value: sold ? `${qtyFmt(sold)} ${unitWord}` : '—', note: 'perkiraan dari penjualan' },
    ];
    const rows = [...finals]
        .sort((a, b) => b.root_qty * unitCost - a.root_qty * unitCost)
        .map((n) => ({
            name: n.name,
            cost: rp(n.root_qty * unitCost),
            pct: `${Math.round(shareOf(n) * 100)}%`,
            qty: `${qtyFmt(n.root_qty)} ${unitWord}/${n.unit}`,
            onClick: () => pick(n.product_id),
        }));
    return (
        <div className="flex flex-col gap-3.5 p-4">
            <div className="flex items-center gap-2">
                <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Ringkasan {rootLabel.toLowerCase()}</div>
                <div className="ml-auto rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-foreground/80">{rootLabel.toUpperCase()}</div>
            </div>
            <div>
                <div className="text-[19px] font-bold leading-tight tracking-tight">{bahan}</div>
                <div className="mt-1 text-xs text-muted-foreground">Menjadi {NF.format(count)} produk</div>
            </div>
            <StatGrid stats={stats} />
            <div className="flex flex-col gap-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Ujung garis</div>
                {rows.map((b) => (
                    <BreakdownRow key={b.name + b.qty} {...b} />
                ))}
            </div>
            <div className="rounded-[10px] border border-dashed bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                Angka di tiap baris adalah biaya {bahan} di dalam satu unit produknya; garis merahnya porsi dari HPP produk itu. Klik
                produk mana pun untuk menyalakan garisnya.
            </div>
        </div>
    );
}

function NodePanel({
    n,
    bahan,
    bahanUnit,
    unitCost,
    share,
    viaBatch,
    from,
    into,
    pick,
}: {
    n: ApiNode;
    bahan: string;
    bahanUnit: string;
    unitCost: number;
    share: number;
    viaBatch: boolean;
    from: { key: string; name: string; qty: number; unit: string }[];
    into: { key: string; name: string; qty: number; unit: string }[];
    pick: (key: string | null) => void;
}) {
    const kind = kindOf(n);
    const content = n.root_qty * unitCost;
    const margin = n.price > 0 ? ((n.price - n.unit_cost) / n.price) * 100 : null;
    const stats = [
        { label: `Isi ${bahan}`, value: `${qtyFmt(n.root_qty)} ${bahanUnit}`, note: `per ${n.unit}` },
        viaBatch
            ? { label: `Biaya ${bahan}`, value: rp(content), note: n.track_stock ? 'masuk lewat batch' : 'sebagian lewat batch' }
            : { label: 'Porsi HPP', value: `${Math.round(share * 100)}%`, note: `${rp(content)} dari ${rp(n.unit_cost)}` },
        { label: 'HPP produk', value: rp(n.unit_cost), note: n.track_stock ? 'rata-rata batch' : 'dihitung dari resep' },
        margin !== null && kind !== 'olahan'
            ? {
                  label: 'Margin',
                  value: `${margin.toFixed(1)}%`,
                  note: `jual ${rp(n.price)}`,
                  colorClass:
                      margin > 55 ? 'text-emerald-600 dark:text-emerald-400' : margin > 40 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400',
              }
            : { label: 'Terjual 30h', value: n.sold_30d ? NF.format(n.sold_30d) : '—', note: n.sold_30d ? n.unit : 'tidak dijual langsung' },
    ];
    const hint =
        kind === 'batch'
            ? `${n.name} punya stok batch sendiri. HPP-nya rata-rata yang terkunci saat diproduksi, jadi harga ${bahan} baru masuk ke sini — dan ke semua produk setelahnya — pada Produksi berikutnya.`
            : viaBatch
              ? `Sebagian ${bahan} di produk ini masuk lewat olahan berstok (batch), yang biayanya terkunci saat diproduksi. Porsinya tidak dihitung sebagai bagian HPP yang ikut berubah hari ini.`
              : `HPP ${n.name} dihitung ulang dari resepnya, jadi setiap perubahan harga ${bahan} langsung terasa di sini.`;
    return (
        <div className="flex flex-col gap-3.5 p-4">
            <div className="flex items-center gap-2">
                <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{KIND_LABEL[kind]}</div>
                <div className={`ml-auto rounded-md px-1.5 py-0.5 font-mono text-[10.5px] font-semibold ${KIND_TAG_CLASS[kind]}`}>{KIND_TAG[kind]}</div>
            </div>
            <div>
                <div className="text-[19px] font-bold leading-tight tracking-tight">{n.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                    Tahap {Math.max(1, n.stage)} · {qtyFmt(n.root_qty)} {bahanUnit} {bahan} per {n.unit}
                </div>
            </div>
            <StatGrid stats={stats} />
            <div className="flex flex-col gap-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Dibuat dari</div>
                {from.map((f) => (
                    <LinkRow key={f.key} name={f.name} detail={`${qtyFmt(f.qty)} ${f.unit} / ${n.unit}`} onClick={() => pick(f.key === ROOT ? null : f.key)} />
                ))}
            </div>
            <div className="flex flex-col gap-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Menjadi</div>
                {into.length ? (
                    into.map((t) => (
                        <LinkRow key={t.key} name={t.name} detail={`${qtyFmt(t.qty)} ${n.unit} / ${t.unit}`} onClick={() => pick(t.key)} />
                    ))
                ) : (
                    <div className="text-[11.5px] text-muted-foreground">Ujung garis — tidak dipakai di resep lain.</div>
                )}
            </div>
            <Button size="sm" variant="outline" asChild>
                <Link href={`/dashboard/addproducts/recipe-explorer/${n.product_id}?name=${encodeURIComponent(n.name)}`}>
                    <Workflow />
                    Jelajah resep {n.name}
                </Link>
            </Button>
            <div className="rounded-[10px] border border-dashed bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">{hint}</div>
        </div>
    );
}

function LinkRow({ name, detail, onClick }: { name: string; detail: string; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="flex items-baseline gap-2 rounded-[10px] border bg-background px-2.5 py-2 text-left transition-colors hover:bg-muted/60"
        >
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{name}</span>
            <span className="whitespace-nowrap font-mono text-[10.5px] text-muted-foreground">{detail}</span>
        </button>
    );
}
