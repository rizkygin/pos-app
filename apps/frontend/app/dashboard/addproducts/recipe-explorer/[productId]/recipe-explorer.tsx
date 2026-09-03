'use client';

/**
 * Recipe Explorer — the multi-level recipe (BOM) and HPP diagram for one
 * product. Ported from the Claude Design mockup "FnB app product details" and
 * then wired to this outlet's real data via GET /api/products/:id/recipe-explorer.
 *
 * WHAT THE MOCKUP HAD THAT THE DATABASE DOES NOT — and is therefore gone:
 *
 *   · "Susut" (waste/shrinkage %) — there is no waste column on products or on
 *     recipe_items, and no shrinkage concept anywhere in the schema. It was a
 *     per-ingredient percentage in the mock that silently inflated every cost.
 *     Removed from the table, from the node cost math, and from the detail
 *     panel rather than faked from a constant.
 *   · Three variant axes (Suhu / Ukuran / Jenis kacang). A variant here is a
 *     products row pointed at its base by variant_of, and a base asks exactly
 *     ONE question (products.variant_label). So this renders that one real
 *     axis, and switching option loads that sibling product.
 *   · A generated "SKU". products has `barcode`, which is nullable — the chip
 *     shows the real barcode and is hidden when there isn't one.
 *
 * COSTING follows the sale path, not the mockup's yield/waste arithmetic. The
 * server does the walk (see the endpoint comment); recipe_items.qty is already
 * "per ONE unit", so quantities just multiply down the tree. A stock-tracking
 * ingredient is a BATCH BOUNDARY: it costs its own avg_cost, which is what a
 * sale actually deducts, so its children are shown for reference but their
 * costs deliberately do not roll up. Those nodes are flagged `inBatch` here and
 * rendered without a share bar so they can't be misread as part of the HPP.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, PanelLeftClose, PanelLeftOpen, Sparkles } from 'lucide-react';
import { API_URL } from '@/lib/api-url';

// ---------------------------------------------------------------------------
// Wire format (mirrors the endpoint)
// ---------------------------------------------------------------------------
type ApiNode = {
    key: string;
    product_id: string;
    name: string;
    unit: string;
    qty: number;
    unit_cost: number;
    cost: number;
    stock: number;
    track_stock: boolean;
    composite: boolean;
    batch_boundary: boolean;
    yield_qty: number;
    cyclic: boolean;
    days_left: number | null;
    children: ApiNode[];
};

type ApiAddon = {
    option_id: number;
    group_id: number;
    group_name: string;
    label: string;
    price: number;
    available: boolean;
    hpp: number;
    node: ApiNode;
};

type ApiVariants = {
    label: string;
    options: { id: string; name: string; price: number; current: boolean }[];
};

type ApiResponse = {
    success: boolean;
    product: {
        id: string;
        name: string;
        unit: string;
        image: string;
        price: number;
        list_price: number;
        discounted: boolean;
        barcode: string | null;
        ratings: number | null;
        review_count: number;
        track_stock: boolean;
        stock: number;
        yield_qty: number;
        avg_cost: number;
        is_variant: boolean;
    };
    recipe_cost: number;
    unit_cost: number;
    tree: ApiNode[];
    addons: ApiAddon[];
    variants: ApiVariants | null;
    sold_30d: number;
    orders_30d: number;
    low_stock_days: number;
    cyclic: string[];
};

const RADII = [0, 262, 476, 668];
const NODE_W = [224, 190, 172, 156];

const NF = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const NF1 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
const NF2 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
const rp = (n: number) => 'Rp ' + NF.format(Math.round(n));
// Sub-rupiah unit costs are routine at recipe scale (0,9 per ml of water), so
// the per-unit figures keep two decimals where the totals keep none.
const rp1 = (n: number) => 'Rp ' + (n < 100 ? NF2.format(n) : NF.format(Math.round(n)));
// Quantities on this page span two scales: stock counted in hundreds of grams
// and recipe amounts of 0,018 kg. Any fixed decimal count prints one of them as
// "0", so precision follows magnitude — and a leftover 0,4 kg never reads as
// empty stock.
const NFSig = new Intl.NumberFormat('id-ID', { maximumSignificantDigits: 2 });
const qtyFmt = (n: number) => {
    const a = Math.abs(n);
    if (a === 0) return '0';
    if (a >= 100) return NF.format(n);
    if (a >= 10) return NF1.format(n);
    if (a >= 1) return NF2.format(n);
    return NFSig.format(n);
};

// ---------------------------------------------------------------------------
// Radial layout over the fetched tree
// ---------------------------------------------------------------------------
type Node = {
    key: string;
    depth: number;
    parentKey: string;
    childKeys: string[];
    kidCount: number;
    collapsed: boolean;
    addon: number | null;
    inBatch: boolean;
    share: number;
    x: number;
    y: number;
    src: ApiNode;
};

type Root = { node: ApiNode; addon: number | null };

// A branch is collapsed by default from depth 2 down, and a batch boundary
// always starts closed: what is under it is a different batch's recipe, not
// part of this dish's cost, and opening it is a deliberate act.
function isCollapsedFor(
    collapsedMap: Record<string, boolean>,
    key: string,
    depth: number,
    hasKids: boolean,
    boundary: boolean,
): boolean {
    if (!hasKids) return false;
    const v = collapsedMap[key];
    return v === undefined ? boundary || depth >= 2 : v;
}

function buildGraph(roots: Root[], collapsedMap: Record<string, boolean>, offsets: Record<string, { x: number; y: number }>) {
    const nodes: Node[] = [];
    const total = roots.reduce((s, r) => s + r.node.cost, 0);

    const walk = (an: ApiNode, depth: number, addon: number | null, parentKey: string, inBatch: boolean): Node => {
        const collapsed = isCollapsedFor(collapsedMap, an.key, depth, an.children.length > 0, an.batch_boundary);
        const n: Node = {
            key: an.key,
            depth,
            parentKey,
            childKeys: [],
            kidCount: an.children.length,
            collapsed,
            addon,
            inBatch,
            // Everything below a batch boundary is priced in a different batch,
            // so it has no share of THIS dish's HPP.
            share: inBatch || !total ? 0 : an.cost / total,
            x: 0,
            y: 0,
            src: an,
        };
        nodes.push(n);
        if (!collapsed) {
            for (const c of an.children) {
                n.childKeys.push(c.key);
                walk(c, depth + 1, addon, an.key, inBatch || an.batch_boundary);
            }
        }
        return n;
    };
    for (const r of roots) walk(r.node, 1, r.addon, 'root', false);

    const byKey: Record<string, Node> = {};
    for (const n of nodes) byKey[n.key] = n;

    const leafCount = (n: Node): number =>
        n.collapsed || !n.childKeys.length ? 1 : n.childKeys.reduce((s, k) => s + leafCount(byKey[k]), 0);
    const rootNodes = nodes.filter((n) => n.depth === 1);
    const totalLeaves = rootNodes.reduce((s, n) => s + leafCount(n), 0) || 1;

    let cursor = -Math.PI / 2 - Math.PI / totalLeaves;
    const place = (n: Node, a0: number, a1: number, idx: number) => {
        const a = (a0 + a1) / 2;
        const span = a1 - a0;
        const r = RADII[Math.min(n.depth, 3)] + (idx % 2 ? 46 : 0) + (span < 0.34 && idx % 3 === 2 ? 24 : 0);
        n.x = Math.cos(a) * r;
        n.y = Math.sin(a) * r * 0.82;
        if (!n.collapsed && n.childKeys.length) {
            const kl = n.childKeys.map((k) => leafCount(byKey[k]));
            const sum = kl.reduce((s, v) => s + v, 0);
            let c = a0;
            n.childKeys.forEach((k, i) => {
                const w = (span * kl[i]) / sum;
                place(byKey[k], c, c + w, i);
                c += w;
            });
        }
    };
    rootNodes.forEach((n, i) => {
        const w = (2 * Math.PI * leafCount(n)) / totalLeaves;
        place(n, cursor, cursor + w, i);
        cursor += w;
    });

    for (const n of nodes) {
        const o = offsets[n.key];
        if (o) {
            n.x += o.x;
            n.y += o.y;
        }
    }
    return { nodes, byKey, total };
}

type Graph = ReturnType<typeof buildGraph>;

// The flat table answers "what does one of these actually draw down", so it
// stops where a sale stops: at anything that tracks its own stock. Descending
// past a batch boundary would double-count, since the batch already carries its
// own cost. Same rule as expandRecipe's "ledger" mode in lib/stock.ts.
function flatRows(roots: Root[], total: number, lowStockDays: number) {
    type Row = {
        id: string;
        name: string;
        unit: string;
        qty: number;
        cost: number;
        unitCost: number;
        stock: number;
        trackStock: boolean;
        days: number | null;
        via: string | null;
    };
    const rows = new Map<string, Row>();

    const walk = (an: ApiNode, via: string | null) => {
        const isLeaf = an.track_stock || an.children.length === 0;
        if (!isLeaf) {
            for (const c of an.children) walk(c, an.name);
            return;
        }
        const r = rows.get(an.product_id);
        if (r) {
            r.qty += an.qty;
            r.cost += an.cost;
        } else {
            rows.set(an.product_id, {
                id: an.product_id,
                name: an.name,
                unit: an.unit,
                qty: an.qty,
                cost: an.cost,
                unitCost: an.unit_cost,
                stock: an.stock,
                trackStock: an.track_stock,
                days: an.days_left,
                via,
            });
        }
    };
    for (const r of roots) walk(r.node, null);

    return [...rows.values()]
        .sort((a, b) => b.cost - a.cost)
        .map((r) => ({
            ...r,
            low: r.days !== null && r.days < lowStockDays,
            pct: total ? Math.round((r.cost / total) * 100) : 0,
        }));
}

// The qty on a node is per one unit of its parent, but the diagram wants the
// quantity actually consumed per one of the dish. cost/unit_cost recovers it
// (both already carry the multiplier), falling back to the raw qty when the
// unit cost is zero.
const usedQty = (n: ApiNode) => (n.unit_cost > 0 ? n.cost / n.unit_cost : n.qty);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
type UIState = {
    addons: number[];
    collapsed: Record<string, boolean>;
    selected: string | null;
    zoom: number;
    pan: { x: number; y: number };
    view: 'Diagram' | 'Tabel';
    offsets: Record<string, { x: number; y: number }>;
    dragKey: string | null;
    panelOpen: boolean;
    w: number;
};

export function RecipeExplorer({ productId, productName }: { productId: string; productName: string | null }) {
    // A variant is a different products row, so switching one refetches rather
    // than recomputing. Kept in state instead of the URL so the diagram's zoom,
    // pan and hand-placed nodes survive the switch.
    const [activeId, setActiveId] = useState(productId);
    // Tagged with the id it answers, so "still loading" is a comparison rather
    // than a flag the effect has to set on its way in.
    const [fetched, setFetched] = useState<{ id: string; data: ApiResponse | null; error: string | null } | null>(null);
    const settled = fetched?.id === activeId ? fetched : null;
    const data = settled?.data ?? null;
    const error = settled?.error ?? null;
    const loading = !settled;

    const [ui, setUi] = useState<UIState>({
        addons: [],
        collapsed: {},
        selected: null,
        zoom: 0.62,
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
        const zoom = Math.max(0.28, Math.min(1.4, Math.min((r.width - 48) / bb.w, (r.height - 48) / bb.h)));
        patch({ zoom, pan: { x: -bb.cx * zoom, y: -bb.cy * zoom } });
    }, []);

    const refit = useCallback(() => {
        requestAnimationFrame(() => requestAnimationFrame(() => fit()));
    }, [fit]);

    useEffect(() => {
        let alive = true;
        const id = activeId;
        fetch(`${API_URL}/api/products/${id}/recipe-explorer`, { credentials: 'include' })
            .then(async (res) => {
                const json = (await res.json().catch(() => null)) as ApiResponse | null;
                if (!alive) return;
                setFetched(
                    !res.ok || !json?.success
                        ? { id, data: null, error: res.status === 404 ? 'Produk ini tidak ada di outlet pian.' : 'Gagal memuat resep produk.' }
                        : { id, data: json, error: null },
                );
            })
            .catch(() => alive && setFetched({ id, data: null, error: 'Gagal menghubungi server.' }));
        return () => {
            alive = false;
        };
    }, [activeId]);

    // Switching variant is a different product: its add-on option ids, its
    // collapsed branches and its hand-placed nodes all belong to the old one.
    // Reset here rather than in an effect — it is a consequence of the click.
    const switchProduct = (id: string) => {
        setActiveId(id);
        setUi((s) => ({ ...s, addons: [], selected: null, collapsed: {}, offsets: {} }));
    };

    // Wheel-to-zoom needs a non-passive native listener (React's synthetic
    // wheel handler can't preventDefault reliably), plus a resize watcher for
    // the legend breakpoint and re-fitting the diagram to the canvas.
    useEffect(() => {
        const el = canvasRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            setUi((s) => ({ ...s, zoom: Math.min(1.7, Math.max(0.34, s.zoom * (e.deltaY > 0 ? 0.92 : 1.08))) }));
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

    // Folding the panel changes the canvas width without a window resize, so the
    // diagram has to be re-fitted by hand or it stays off-centre.
    const togglePanel = () => {
        patch((s) => ({ panelOpen: !s.panelOpen }));
        refit();
    };

    const toggleAddon = (id: number) => {
        patch((s) => ({ addons: s.addons.includes(id) ? s.addons.filter((a) => a !== id) : s.addons.concat(id) }));
        refit();
    };

    // Capture is taken on the first real MOVE, never on pointerdown. Capturing
    // early retargets the whole gesture — including the trailing click — to the
    // canvas, which silently swallows clicks on anything sitting on top of it
    // (the "Produk jadi" hub, the collapse badges). Panning still survives the
    // cursor leaving the canvas, because by then the drag has begun.
    const onCanvasDown = (e: React.PointerEvent) => {
        dragState.current = {
            x: e.clientX,
            y: e.clientY,
            pan: { ...ui.pan },
            moved: false,
            id: e.pointerId,
            el: e.currentTarget as HTMLElement,
        };
    };
    const onCanvasMove = (e: React.PointerEvent) => {
        const d = dragState.current;
        if (!d) return;
        // The button came up somewhere we never heard about (a cancelled or
        // off-window release before the drag ever started, so nothing was
        // captured). Drop the gesture instead of panning on a plain hover.
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
        const target = e.target as HTMLElement;
        if (target.closest && target.closest('button')) return;
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
    const lowStockDays = data?.low_stock_days ?? 12;
    const activeAddons = useMemo(
        () => (data?.addons ?? []).filter((a) => ui.addons.includes(a.option_id)),
        [data, ui.addons],
    );
    const roots = useMemo<Root[]>(
        () => [
            ...(data?.tree ?? []).map((n) => ({ node: n, addon: null })),
            ...activeAddons.map((a) => ({ node: a.node, addon: a.option_id })),
        ],
        [data, activeAddons],
    );
    const g = useMemo(() => buildGraph(roots, ui.collapsed, ui.offsets), [roots, ui.collapsed, ui.offsets]);
    const rows = useMemo(() => flatRows(roots, g.total, lowStockDays), [roots, g.total, lowStockDays]);

    const hasRecipe = (data?.tree.length ?? 0) > 0;
    // A product with no recipe still has a cost — what its own stock carries.
    const hpp = hasRecipe ? g.total : (data?.unit_cost ?? 0);
    const price = (data?.product.price ?? 0) + activeAddons.reduce((s, a) => s + a.price, 0);
    const margin = price > 0 ? ((price - hpp) / price) * 100 : 0;
    const unitWord = data?.product.unit ?? 'pcs';
    const variantName = data?.variants?.options.find((o) => o.current)?.name ?? null;
    const displayName = data?.product.name ?? productName ?? 'Produk';

    const sel = ui.selected ? g.byKey[ui.selected] : null;
    const ancestors = useMemo(() => {
        const a: Record<string, boolean> = {};
        let c = sel;
        while (c) {
            a[c.key] = true;
            c = c.parentKey === 'root' ? null : g.byKey[c.parentKey];
        }
        return a;
    }, [sel, g]);

    const bbox = useMemo(() => {
        let x0 = -120,
            x1 = 120,
            y0 = -74,
            y1 = 74;
        for (const n of g.nodes) {
            x0 = Math.min(x0, n.x - 99);
            x1 = Math.max(x1, n.x + 99);
            y0 = Math.min(y0, n.y - 42);
            y1 = Math.max(y1, n.y + 42);
        }
        return { w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
    }, [g]);
    useLayoutEffect(() => {
        bboxRef.current = bbox;
    }, [bbox]);

    const hasMoved = Object.keys(ui.offsets).length > 0;
    const legendVisible = ui.w >= 1240;

    const setAllCollapsed = (collapsed: boolean) => {
        const map: Record<string, boolean> = {};
        const walk = (n: ApiNode) => {
            if (n.children.length) map[n.key] = collapsed;
            for (const c of n.children) walk(c);
        };
        for (const r of roots) walk(r.node);
        patch({ collapsed: map });
        refit();
    };
    const tidyNodes = () => {
        patch({ offsets: {} });
        refit();
    };

    // ---- shells ----
    if (loading && !data) {
        return (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-2xl border bg-background">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Memuat resep {productName ?? 'produk'}…
                </div>
            </div>
        );
    }
    if (error || !data) {
        return (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-2xl border bg-background p-8 text-center">
                <p className="text-sm text-muted-foreground">{error ?? 'Gagal memuat resep produk.'}</p>
                <Link href="/dashboard/addproducts" className="rounded-xl border px-3 py-1.5 text-sm font-semibold hover:bg-muted">
                    Kembali ke etalase
                </Link>
            </div>
        );
    }

    const p = data.product;

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-background">
            {/* ---- top bar: breadcrumb + Diagram/Tabel switch ---- */}
            <div className="flex flex-none flex-wrap items-center gap-3 border-b bg-background px-3 py-2.5 md:px-4">
                <Link
                    href="/dashboard/addproducts"
                    className="flex items-center gap-1 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label="Kembali ke etalase"
                >
                    <ArrowLeft className="h-4 w-4" />
                </Link>
                <div className="flex min-w-0 items-baseline gap-2">
                    <span className="text-xs font-medium text-muted-foreground">Produk</span>
                    <span className="text-xs text-muted-foreground/60">/</span>
                    <span className="truncate text-[17px] font-bold tracking-tight">{displayName}</span>
                    {p.barcode && (
                        <span className="whitespace-nowrap rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-muted-foreground">
                            {p.barcode}
                        </span>
                    )}
                    {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
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
                            {v === 'Diagram' ? 'Diagram resep' : 'Tabel bahan'}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
                {/* ---- left: variant / add-on configurator (collapsible) ---- */}
                {!ui.panelOpen && (
                    <div className="flex flex-none items-center gap-2.5 border-b bg-background px-3 py-2 lg:w-11 lg:flex-col lg:gap-3 lg:border-b-0 lg:border-r lg:px-0 lg:py-3">
                        <button
                            type="button"
                            onClick={togglePanel}
                            aria-label="Tampilkan panel produk"
                            aria-expanded={false}
                            title="Tampilkan panel produk"
                            className="flex-none rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                            <PanelLeftOpen className="h-4 w-4" />
                        </button>
                        <div className="truncate font-mono text-[11px] text-muted-foreground lg:min-h-0 lg:flex-1 lg:rotate-180 lg:[writing-mode:vertical-rl]">
                            HPP {rp(hpp)} · margin {price > 0 ? `${margin.toFixed(1)}%` : '—'}
                        </div>
                    </div>
                )}
                <div
                    className={`flex-none flex-col gap-3.5 overflow-y-auto border-b bg-background p-4 lg:border-b-0 lg:border-r ${
                        ui.panelOpen ? 'flex lg:w-[clamp(232px,23vw,316px)]' : 'hidden'
                    }`}
                >
                    <div className="flex items-center gap-3">
                        <div className="flex h-16 w-16 flex-none items-center justify-center rounded-[14px] bg-gradient-to-br from-amber-100 to-amber-200 font-mono text-lg font-semibold text-amber-800 dark:from-amber-950/60 dark:to-amber-900/40 dark:text-amber-300">
                            {displayName.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <div className="truncate text-[14.5px] font-bold leading-tight">{variantName ?? displayName}</div>
                            {p.ratings !== null && p.review_count > 0 && (
                                <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">★ {p.ratings.toFixed(1)}</span>
                                    <span className="text-[11.5px] text-muted-foreground">{NF.format(p.review_count)} ulasan</span>
                                </div>
                            )}
                            <div className="text-[11.5px] text-muted-foreground">
                                Harga jual <span className="font-mono font-semibold text-foreground">{rp(price)}</span>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={togglePanel}
                            aria-label="Sembunyikan panel produk"
                            aria-expanded
                            title="Sembunyikan panel produk"
                            className="flex-none self-start rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                            <PanelLeftClose className="h-4 w-4" />
                        </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <StatTile label={`HPP / ${unitWord}`} value={rp(hpp)} />
                        <StatTile
                            label="Margin"
                            value={price > 0 ? `${margin.toFixed(1)}%` : '—'}
                            valueClassName={
                                margin > 55
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : margin > 40
                                      ? 'text-amber-600 dark:text-amber-400'
                                      : 'text-rose-600 dark:text-rose-400'
                            }
                        />
                        <StatTile label="Terjual 30h" value={NF.format(data.sold_30d)} />
                        <StatTile label="Laba kotor" value={price > 0 ? rp(price - hpp) : '—'} />
                    </div>

                    {data.cyclic.length > 0 && (
                        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
                            <span className="font-semibold">Resep berputar:</span> {data.cyclic.join(', ')} memakai dirinya sendiri, jadi
                            biayanya dipakai dari harga beli dan tidak diurai. Perbaiki resepnya supaya HPP-nya benar.
                        </div>
                    )}

                    {data.variants && (
                        <>
                            <div className="h-px bg-border" />
                            <div className="flex flex-col gap-3">
                                <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Varian</div>
                                <OptionGroup
                                    label={data.variants.label}
                                    options={data.variants.options.map((o) => ({ id: o.id, label: o.name }))}
                                    value={activeId}
                                    onChange={switchProduct}
                                />
                            </div>
                        </>
                    )}

                    {data.addons.length > 0 && (
                        <>
                            <div className="h-px bg-border" />
                            <div className="flex flex-col gap-2">
                                <div className="flex items-baseline gap-2">
                                    <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Add-on</div>
                                    <div className="ml-auto font-mono text-[11px] text-muted-foreground">
                                        {ui.addons.length ? `${ui.addons.length} add-on aktif` : 'tanpa add-on'}
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {data.addons.map((a) => {
                                        const on = ui.addons.includes(a.option_id);
                                        return (
                                            <button
                                                key={a.option_id}
                                                type="button"
                                                onClick={() => toggleAddon(a.option_id)}
                                                title={`${a.group_name} · jual ${rp(a.price)}`}
                                                className={`flex items-center gap-1.5 rounded-full border border-dashed px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                                                    on
                                                        ? 'border-purple-400 bg-purple-50 text-purple-700 dark:border-purple-500/60 dark:bg-purple-950/30 dark:text-purple-300'
                                                        : 'border-border bg-background text-muted-foreground'
                                                }`}
                                            >
                                                <span>{a.label}</span>
                                                <span className="font-mono text-[10.5px] opacity-75">+{rp(a.hpp)}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="text-[11px] leading-relaxed text-muted-foreground">
                                    Angka pada chip adalah HPP add-on, bukan harga jualnya. Add-on aktif ikut tergambar di diagram
                                    (garis putus-putus) dan menambah HPP.
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {!hasRecipe ? (
                    <EmptyRecipe productName={displayName} unitCost={data.unit_cost} unit={unitWord} />
                ) : ui.view === 'Diagram' ? (
                    <>
                        {/* ---- center: canvas ---- */}
                        <div className="flex min-h-[420px] flex-1 flex-col overflow-hidden lg:min-w-0">
                            <div className="flex flex-none flex-wrap items-center gap-2.5 border-b bg-background px-3.5 py-2.5">
                                {legendVisible && (
                                    <div className="flex flex-wrap items-center gap-3.5 text-[11px] text-foreground/80">
                                        <LegendDot className="border-[1.5px] border-border bg-background" label="Bahan baku" />
                                        <LegendDot className="border-[1.5px] border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40" label="Olahan sendiri" />
                                        <LegendDot className="border-[1.5px] border-rose-500 bg-rose-50 dark:bg-rose-950/40" label="Stok kritis" />
                                    </div>
                                )}
                                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                                    <ToolbarButton onClick={() => setAllCollapsed(false)}>Buka semua</ToolbarButton>
                                    <ToolbarButton onClick={() => setAllCollapsed(true)}>Ringkas</ToolbarButton>
                                    <div className="mx-0.5 h-5 w-px bg-border" />
                                    <button
                                        type="button"
                                        onClick={() => patch((s) => ({ zoom: Math.max(0.34, s.zoom / 1.15) }))}
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
                                    {hasMoved && (
                                        <ToolbarButton onClick={tidyNodes} className="border-rose-200 text-rose-600 dark:border-rose-900 dark:text-rose-400">
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
                                    {[1, 2, 3].map((i) => (
                                        <div
                                            key={i}
                                            className="absolute left-0 top-0 rounded-full border border-dashed border-border/80 opacity-90"
                                            style={{ width: RADII[i] * 2, height: RADII[i] * 2, transform: 'translate(-50%,-50%)' }}
                                        />
                                    ))}

                                    {g.nodes.map((n) => {
                                        const px = n.parentKey === 'root' ? 0 : g.byKey[n.parentKey].x;
                                        const py = n.parentKey === 'root' ? 0 : g.byKey[n.parentKey].y;
                                        const dx = n.x - px,
                                            dy = n.y - py;
                                        const len = Math.sqrt(dx * dx + dy * dy);
                                        const lit = !!ancestors[n.key];
                                        const w = Math.max(1, Math.min(4.5, 1 + n.share * 12));
                                        return (
                                            <div
                                                key={n.key + '-edge'}
                                                className="absolute left-0 top-0 h-0 origin-left animate-[edgeIn_240ms_ease_both]"
                                                style={{
                                                    width: Math.round(len),
                                                    transform: `translate(${Math.round(px)}px,${Math.round(py)}px) rotate(${((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(2)}deg)`,
                                                    borderTop:
                                                        n.addon !== null || n.inBatch
                                                            ? '1.5px dashed #c084fc'
                                                            : `${w.toFixed(1)}px solid ${lit ? '#e11d48' : 'var(--border)'}`,
                                                    opacity: lit ? 1 : 0.75,
                                                    transition: ui.dragKey ? 'none' : 'transform 420ms cubic-bezier(.22,1,.36,1),width 420ms cubic-bezier(.22,1,.36,1)',
                                                }}
                                            />
                                        );
                                    })}

                                    {g.nodes.map((n) => {
                                        const s = n.src;
                                        const days = s.days_left;
                                        const low = days !== null && days < lowStockDays;
                                        const on = ui.selected === n.key;
                                        const lit = !!ancestors[n.key];
                                        const dragging = ui.dragKey === n.key;
                                        const tone: 'addon' | 'low' | 'comp' | 'leaf' =
                                            n.addon !== null && n.depth === 1 ? 'addon' : low ? 'low' : s.composite ? 'comp' : 'leaf';
                                        const bgClass = {
                                            addon: 'bg-purple-50 dark:bg-purple-950/30',
                                            low: 'bg-rose-50 dark:bg-rose-950/30',
                                            comp: 'bg-indigo-50 dark:bg-indigo-950/30',
                                            leaf: 'bg-card',
                                        }[tone];
                                        const borderClass = on
                                            ? 'border-primary'
                                            : {
                                                  addon: 'border-purple-400 dark:border-purple-500/60',
                                                  low: 'border-rose-500',
                                                  comp: 'border-indigo-400 dark:border-indigo-500/60',
                                                  leaf: 'border-border',
                                              }[tone];
                                        const sharePct = Math.max(2, Math.round(n.share * 100));
                                        const shareColor = n.share > 0.25 ? '#e11d48' : n.share > 0.1 ? '#f59e0b' : 'var(--border)';
                                        return (
                                            <div
                                                key={n.key}
                                                onClick={() => pick(n.key)}
                                                onPointerDown={(e) => nodeDown(n.key, e)}
                                                onPointerMove={nodeMove}
                                                onPointerUp={nodeUp}
                                                className={`absolute left-0 top-0 touch-none rounded-xl border-[1.5px] p-2.5 ${bgClass} ${borderClass} ${n.inBatch ? 'opacity-80' : ''}`}
                                                style={{
                                                    width: NODE_W[Math.min(n.depth, 3)],
                                                    cursor: dragging ? 'grabbing' : 'grab',
                                                    transition: dragging
                                                        ? 'box-shadow 180ms'
                                                        : 'transform 420ms cubic-bezier(.22,1,.36,1),box-shadow 180ms,border-color 180ms',
                                                    boxShadow: dragging
                                                        ? '0 18px 40px rgba(0,0,0,0.22)'
                                                        : on
                                                          ? '0 10px 26px rgba(0,0,0,0.16)'
                                                          : lit
                                                            ? '0 6px 16px rgba(225,29,72,0.14)'
                                                            : '0 2px 6px rgba(0,0,0,0.05)',
                                                    transform: `translate(${Math.round(n.x)}px,${Math.round(n.y)}px) translate(-50%,-50%) scale(${dragging ? 1.09 : on ? 1.06 : 1})`,
                                                    zIndex: dragging ? 6 : on ? 4 : 2,
                                                    animation: 'nodeIn 260ms ease both',
                                                }}
                                            >
                                                <div className="flex items-start gap-1.5">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="truncate text-[12.5px] font-semibold leading-tight">{s.name}</div>
                                                        <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                                                            {qtyFmt(usedQty(s))} {s.unit} · {rp1(s.unit_cost)}/{s.unit}
                                                        </div>
                                                    </div>
                                                    <div className="flex-none text-right">
                                                        <div className={`font-mono text-[11.5px] font-semibold ${n.inBatch ? 'text-muted-foreground' : ''}`}>
                                                            {rp(s.cost)}
                                                        </div>
                                                        <div className={`mt-0.5 font-mono text-[10px] ${low ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'}`}>
                                                            {s.track_stock
                                                                ? `${qtyFmt(s.stock)} ${s.unit}${days !== null ? ` · ${NF1.format(days)}h` : ''}`
                                                                : 'olahan · tanpa stok'}
                                                        </div>
                                                    </div>
                                                </div>
                                                {!n.inBatch && (
                                                    <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-muted">
                                                        <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${sharePct}%`, background: shareColor }} />
                                                    </div>
                                                )}
                                                {n.kidCount > 0 && (
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            patch((st) => ({
                                                                collapsed: {
                                                                    ...st.collapsed,
                                                                    [n.key]: !isCollapsedFor(st.collapsed, n.key, n.depth, true, s.batch_boundary),
                                                                },
                                                            }));
                                                        }}
                                                        className={`absolute bottom-[-11px] left-1/2 z-[3] -translate-x-1/2 whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[9.5px] font-semibold ${
                                                            n.collapsed ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground/70'
                                                        }`}
                                                    >
                                                        {n.collapsed ? `+ ${n.kidCount} bahan` : '− tutup'}
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}

                                    <div
                                        onClick={() => pick(null)}
                                        className={`absolute left-0 top-0 z-[5] w-[224px] cursor-pointer rounded-2xl bg-primary p-3.5 text-primary-foreground shadow-[0_12px_34px_rgba(0,0,0,0.22)] transition-shadow ${
                                            ui.selected === null ? 'ring-2 ring-primary/40 ring-offset-2 ring-offset-background' : ''
                                        }`}
                                        style={{ transform: 'translate(-50%,-50%)' }}
                                    >
                                        <div className="text-[10px] font-bold uppercase tracking-wide text-primary-foreground/50">Produk jadi</div>
                                        <div className="mt-1 text-[15.5px] font-bold leading-tight">{displayName}</div>
                                        {variantName && <div className="mt-0.5 text-[11px] text-primary-foreground/60">{variantName}</div>}
                                        <div className="my-2.5 h-px bg-primary-foreground/10" />
                                        <div className="flex items-baseline justify-between">
                                            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-primary-foreground/50">HPP</span>
                                            <span className="font-mono text-[17px] font-semibold">{rp(hpp)}</span>
                                        </div>
                                        <div className="mt-1 flex items-baseline justify-between">
                                            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-primary-foreground/50">Margin</span>
                                            <span className="font-mono text-[12.5px] font-semibold text-emerald-400">
                                                {price > 0 ? `${margin.toFixed(1)}%` : '—'}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="absolute bottom-3.5 left-4 rounded-lg bg-background/80 px-2.5 py-1.5 text-[11px] text-muted-foreground backdrop-blur-sm">
                                    Tarik node untuk memindahkannya · tarik kanvas untuk geser · scroll untuk zoom · klik node untuk detail
                                </div>
                            </div>
                        </div>

                        {/* ---- right: selection detail panel ---- */}
                        <div className="flex-none overflow-y-auto border-t bg-background lg:w-[clamp(252px,25vw,340px)] lg:border-l lg:border-t-0">
                            <SelectionPanel
                                sel={sel}
                                g={g}
                                hpp={hpp}
                                price={price}
                                margin={margin}
                                sold30={data.sold_30d}
                                orders30={data.orders_30d}
                                ratings={p.ratings}
                                reviewCount={p.review_count}
                                lowStockDays={lowStockDays}
                                productName={displayName}
                                subtitle={variantName ? `${variantName} · ${rp(price)} harga jual` : `${rp(price)} harga jual`}
                                pick={pick}
                            />
                        </div>
                    </>
                ) : (
                    /* ---- table view ---- */
                    <div className="min-w-0 flex-1 overflow-auto p-4 md:p-5">
                        <div className="mb-3 flex flex-wrap items-baseline gap-2.5">
                            <div className="text-[14.5px] font-bold">Bahan yang berkurang per {unitWord}</div>
                            <div className="text-xs text-muted-foreground">
                                {variantName ? `${variantName} · ` : ''}
                                {ui.addons.length ? `${ui.addons.length} add-on aktif` : 'tanpa add-on'}
                            </div>
                            <div className="ml-auto font-mono text-xs font-semibold">Total HPP {rp(g.total)}</div>
                        </div>
                        <div className="overflow-hidden rounded-2xl border bg-background">
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-muted/50 text-left text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                                            <th className="px-3.5 py-2.5">Bahan</th>
                                            <th className="px-3.5 py-2.5 text-right">Pakai / {unitWord}</th>
                                            <th className="px-3.5 py-2.5 text-right">Biaya satuan</th>
                                            <th className="px-3.5 py-2.5 text-right">Biaya</th>
                                            <th className="px-3.5 py-2.5 text-right">Stok</th>
                                            <th className="px-3.5 py-2.5 text-right">Perkiraan habis</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((r) => (
                                            <tr key={r.id} className="border-t text-[12.5px]">
                                                <td className="px-3.5 py-2.5">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`h-[7px] w-[7px] flex-none rounded-sm ${r.low ? 'bg-rose-500' : 'bg-border'}`} />
                                                        <span className="truncate font-semibold">{r.name}</span>
                                                        <span className="whitespace-nowrap text-[10.5px] text-muted-foreground">
                                                            {r.via ? `· ${r.via}` : '· langsung'}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-3.5 py-2.5 text-right font-mono">
                                                    {qtyFmt(r.qty)} {r.unit}
                                                </td>
                                                <td className="px-3.5 py-2.5 text-right font-mono text-muted-foreground">
                                                    {rp1(r.unitCost)}/{r.unit}
                                                </td>
                                                <td className="px-3.5 py-2.5 text-right font-mono font-semibold">
                                                    {rp(r.cost)} <span className="font-normal text-muted-foreground">({r.pct}%)</span>
                                                </td>
                                                <td className="px-3.5 py-2.5 text-right font-mono text-muted-foreground">
                                                    {r.trackStock ? `${qtyFmt(r.stock)} ${r.unit}` : '—'}
                                                </td>
                                                <td className={`px-3.5 py-2.5 text-right font-mono font-semibold ${r.low ? 'text-rose-600 dark:text-rose-400' : ''}`}>
                                                    {r.days !== null ? `${NF1.format(r.days)}h` : '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                            Daftar ini berhenti di bahan yang stoknya dihitung sendiri — persis yang berkurang saat satu {unitWord} terjual.
                            Bahan penyusun sebuah olahan yang sudah punya stok batch tidak diurai lagi di sini, karena biayanya sudah
                            terkunci saat batch itu dibuat. &quot;Perkiraan habis&quot; memakai rata-rata pemakaian 30 hari terakhir dari seluruh produk.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------
function EmptyRecipe({ productName, unitCost, unit }: { productName: string; unitCost: number; unit: string }) {
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
            <div className="rounded-full bg-muted p-3 text-muted-foreground">
                <Sparkles className="h-6 w-6" />
            </div>
            <h3 className="font-bold">Belum ada resep</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
                {productName} belum punya bahan penyusun, jadi tidak ada yang bisa digambar. Susun resepnya dari form produk di
                etalase — begitu ada bahannya, diagram HPP-nya muncul sendiri di sini.
            </p>
            <p className="font-mono text-xs text-muted-foreground">
                Biaya satuan saat ini {rp(unitCost)} / {unit}
            </p>
        </div>
    );
}

function StatTile({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
    return (
        <div className="rounded-xl border bg-muted/40 px-2.5 py-2">
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className={`mt-0.5 font-mono text-base font-semibold ${valueClassName ?? ''}`}>{value}</div>
        </div>
    );
}

function OptionGroup({
    label,
    options,
    value,
    onChange,
}: {
    label: string;
    options: { id: string; label: string }[];
    value: string;
    onChange: (v: string) => void;
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="text-[11.5px] font-semibold text-foreground/80">{label}</div>
            <div className="flex flex-wrap gap-1.5">
                {options.map((o) => (
                    <button
                        key={o.id}
                        type="button"
                        onClick={() => onChange(o.id)}
                        className={`flex-1 rounded-[9px] border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                            value === o.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground/80'
                        }`}
                    >
                        {o.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

function LegendDot({ className, label }: { className: string; label: string }) {
    return (
        <span className="flex items-center gap-1.5">
            <span className={`h-[9px] w-[9px] rounded-[3px] ${className}`} />
            {label}
        </span>
    );
}

function ToolbarButton({ children, onClick, className }: { children: React.ReactNode; onClick: () => void; className?: string }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`rounded-lg border bg-background px-2.5 py-1.5 text-[11.5px] font-semibold text-foreground/80 hover:bg-muted ${className ?? ''}`}
        >
            {children}
        </button>
    );
}

function BreakdownRow({ name, cost, pct, qty, onClick }: { name: string; cost: string; pct: string; qty: string; onClick: () => void }) {
    return (
        <button onClick={onClick} className="flex flex-col gap-1 rounded-[10px] border bg-background px-2.5 py-2 text-left transition-colors hover:bg-muted/60">
            <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{name}</span>
                <span className="font-mono text-[11.5px] font-semibold">{cost}</span>
            </div>
            <div className="flex items-center gap-2">
                <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-rose-600 transition-[width] duration-300" style={{ width: pct }} />
                </div>
                <span className="w-24 whitespace-nowrap text-right font-mono text-[10.5px] text-muted-foreground">{qty}</span>
            </div>
        </button>
    );
}

function StatGrid({ stats }: { stats: { label: string; value: string; note: string; colorClass?: string }[] }) {
    return (
        <div className="grid grid-cols-2 gap-2">
            {stats.map((s) => (
                <div key={s.label} className="rounded-xl border bg-muted/40 px-2.5 py-2">
                    <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{s.label}</div>
                    <div className={`mt-0.5 font-mono text-[15px] font-semibold ${s.colorClass ?? ''}`}>{s.value}</div>
                    <div className="mt-0.5 text-[10.5px] text-muted-foreground">{s.note}</div>
                </div>
            ))}
        </div>
    );
}

function SelectionPanel({
    sel,
    g,
    hpp,
    price,
    margin,
    sold30,
    orders30,
    ratings,
    reviewCount,
    lowStockDays,
    productName,
    subtitle,
    pick,
}: {
    sel: Node | null;
    g: Graph;
    hpp: number;
    price: number;
    margin: number;
    sold30: number;
    orders30: number;
    ratings: number | null;
    reviewCount: number;
    lowStockDays: number;
    productName: string;
    subtitle: string;
    pick: (key: string | null) => void;
}) {
    const stat = (label: string, value: string, note: string, colorClass?: string) => ({ label, value, note, colorClass });

    if (sel) {
        const s = sel.src;
        const days = s.days_left;
        const low = days !== null && days < lowStockDays;
        const kicker = s.composite ? 'Bahan olahan' : 'Bahan baku';
        const tag = sel.addon !== null && sel.depth === 1 ? 'ADD-ON' : s.batch_boundary ? 'BATCH' : s.composite ? 'OLAHAN' : 'BELI';
        const tagClass =
            tag === 'ADD-ON'
                ? 'bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300'
                : s.composite
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300'
                  : 'bg-muted text-foreground/80';

        const stats = [
            sel.inBatch
                ? stat('Biaya di batch', rp(s.cost), 'di luar hitungan HPP')
                : stat('Kontribusi HPP', `${Math.round(sel.share * 100)}%`, `${rp(s.cost)} dari ${rp(hpp)}`),
            stat('Biaya satuan', rp1(s.unit_cost), `per ${s.unit}`),
            stat(
                'Stok tersisa',
                s.track_stock ? `${qtyFmt(s.stock)} ${s.unit}` : '—',
                s.batch_boundary
                    ? `yield ${qtyFmt(s.yield_qty)} ${s.unit}/batch`
                    : s.track_stock
                      ? 'dihitung di stok'
                      : 'olahan tanpa stok sendiri',
            ),
            stat(
                'Perkiraan habis',
                days !== null ? `${NF1.format(days)} hari` : '—',
                days !== null ? (low ? 'segera restock' : 'aman') : 'belum ada pemakaian 30h',
                days === null ? undefined : low ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400',
            ),
        ];

        const kidSum = s.children.reduce((acc, c) => acc + c.cost, 0);
        const breakdown = s.children.length
            ? s.children.map((c) => ({
                  name: c.name,
                  cost: rp(c.cost),
                  pct: `${kidSum ? Math.round((c.cost / kidSum) * 100) : 0}%`,
                  qty: `${qtyFmt(usedQty(c))} ${c.unit}`,
                  onClick: () => pick(c.key),
              }))
            : [
                  {
                      name: sel.parentKey === 'root' ? 'Langsung ke produk' : g.byKey[sel.parentKey]?.src.name ?? 'Induk',
                      cost: rp(s.cost),
                      pct: `${Math.round(sel.share * 100)}%`,
                      qty: `${qtyFmt(usedQty(s))} ${s.unit}`,
                      onClick: () => pick(sel.parentKey === 'root' ? null : sel.parentKey),
                  },
              ];

        const hint = s.batch_boundary
            ? 'Bahan ini punya stok batch sendiri, jadi biayanya dipakai apa adanya (rata-rata tertimbang saat batch dibuat). Isi di bawahnya ditampilkan sebagai rujukan resep dan tidak ditambahkan lagi ke HPP.'
            : s.composite
              ? 'Olahan tanpa stok sendiri — biayanya dihitung ulang dari bahan penyusunnya setiap kali harga bahan berubah.'
              : '"Perkiraan habis" dihitung dari rata-rata pemakaian 30 hari terakhir pada semua produk, bukan hanya produk ini.';

        return (
            <div className="flex flex-col gap-3.5 p-4">
                <div className="flex items-center gap-2">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{kicker}</div>
                    <div className={`ml-auto rounded-md px-1.5 py-0.5 font-mono text-[10.5px] font-semibold ${tagClass}`}>{tag}</div>
                </div>
                <div>
                    <div className="text-[19px] font-bold leading-tight tracking-tight">{s.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                        {qtyFmt(usedQty(s))} {s.unit} dipakai · {rp1(s.unit_cost)} per {s.unit}
                    </div>
                </div>
                <StatGrid stats={stats} />
                <div className="flex flex-col gap-1.5">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                        {s.children.length ? 'Tersusun dari' : 'Dipakai di resep ini'}
                    </div>
                    {breakdown.map((b) => (
                        <BreakdownRow key={b.name} {...b} />
                    ))}
                </div>
                <div className="rounded-[10px] border border-dashed bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">{hint}</div>
            </div>
        );
    }

    const stats = [
        stat('HPP', rp(hpp), price > 0 ? `${Math.round((hpp / price) * 100)}% dari harga jual` : 'harga jual belum diisi'),
        stat(
            'Margin',
            price > 0 ? `${margin.toFixed(1)}%` : '—',
            price > 0 ? `${rp(price - hpp)} / unit` : '—',
            margin > 55 ? 'text-emerald-600 dark:text-emerald-400' : margin > 40 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400',
        ),
        stat('Terjual 30h', NF.format(sold30), `${NF.format(orders30)} order`),
        stat('Rating', ratings !== null && reviewCount > 0 ? ratings.toFixed(1) : '—', reviewCount > 0 ? `${NF.format(reviewCount)} ulasan` : 'belum ada ulasan'),
    ];
    const breakdown = g.nodes
        .filter((n) => n.depth === 1)
        .sort((a, b) => b.src.cost - a.src.cost)
        .map((n) => ({
            name: n.src.name + (n.addon !== null ? ' (add-on)' : ''),
            cost: rp(n.src.cost),
            pct: `${Math.round(n.share * 100)}%`,
            qty: `${qtyFmt(usedQty(n.src))} ${n.src.unit}`,
            onClick: () => pick(n.key),
        }));

    return (
        <div className="flex flex-col gap-3.5 p-4">
            <div className="flex items-center gap-2">
                <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Ringkasan produk</div>
                <div className="ml-auto rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-foreground/80">HPP</div>
            </div>
            <div>
                <div className="text-[19px] font-bold leading-tight tracking-tight">{productName}</div>
                <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
            </div>
            <StatGrid stats={stats} />
            <div className="flex flex-col gap-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Komposisi HPP</div>
                {breakdown.map((b) => (
                    <BreakdownRow key={b.name} {...b} />
                ))}
            </div>
            <div className="rounded-[10px] border border-dashed bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                Klik node mana pun di diagram untuk melihat biaya satuan, stok, dan kontribusinya ke HPP.
            </div>
        </div>
    );
}
