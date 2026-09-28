"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { fmtIDR } from "@/lib/utils/format";
import { LiveImage } from "./live-image";
import type { MenuItem, MenuSection } from "./menu-types";

const SLIDE_MS = 3800;

const slide = {
    enter: (dir: number) => ({ x: dir > 0 ? "100%" : "-100%", opacity: 0.4 }),
    center: { x: "0%", opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? "-100%" : "100%", opacity: 0.4 }),
};

/**
 * The left column of a menu section: every item of the group, one at a time,
 * sliding on by itself. It is the group's "cover" — a moving picture of what
 * the section holds — and a shortcut: tapping it opens the item on screen.
 *
 * Swipe or tap the arrows to move it by hand; it pauses while a finger or a
 * mouse is on it, and while it is off screen.
 */
export function GroupShowcase({
    section,
    onOpen,
}: {
    section: MenuSection;
    onOpen: (item: MenuItem) => void;
}) {
    const items = section.items;
    const [[index, dir], setPage] = useState<[number, number]>([0, 1]);
    const [held, setHeld] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    // A swipe ends in a pointerup the browser also reports as a click; this
    // is what tells the two apart.
    const draggedRef = useRef(false);
    const inView = useInView(ref, { margin: "-10% 0px" });
    const reduce = useReducedMotion();
    const count = items.length;
    const current = items[index % count];
    const running = count > 1 && inView && !held;

    const go = (delta: number) =>
        setPage(([i]) => [(i + delta + count) % count, delta >= 0 ? 1 : -1]);

    useEffect(() => {
        if (!running) return;
        const t = setTimeout(() => go(1), SLIDE_MS);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [running, index]);

    if (!current) return null;

    return (
        <div
            ref={ref}
            className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-2xl shadow-black/40 sm:aspect-3/4"
            onPointerEnter={() => setHeld(true)}
            onPointerLeave={() => setHeld(false)}
        >
            <AnimatePresence initial={false} custom={dir} mode="popLayout">
                <motion.button
                    key={current.base.id}
                    type="button"
                    custom={dir}
                    variants={slide}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={
                        reduce
                            ? { duration: 0 }
                            : { x: { type: "spring", stiffness: 260, damping: 32 }, opacity: { duration: 0.25 } }
                    }
                    drag={count > 1 ? "x" : false}
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0.35}
                    onDragStart={() => {
                        draggedRef.current = true;
                        setHeld(true);
                    }}
                    onDragEnd={(_, info) => {
                        setHeld(false);
                        setTimeout(() => (draggedRef.current = false), 0);
                        if (info.offset.x < -40 || info.velocity.x < -300) go(1);
                        else if (info.offset.x > 40 || info.velocity.x > 300) go(-1);
                    }}
                    onClick={() => {
                        if (!draggedRef.current) onOpen(current);
                    }}
                    aria-label={`Lihat ${current.base.product_name}`}
                    className="absolute inset-0 block text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                >
                    <LiveImage
                        image={current.base.image}
                        alt={current.base.product_name}
                        seed={`showcase-${current.base.id}`}
                        sizes="(max-width: 640px) 100vw, 260px"
                        duration={SLIDE_MS / 1000 + 2}
                    />
                    <div className="absolute inset-0 bg-linear-to-t from-black/85 via-black/10 to-black/40" />
                    <div className="absolute inset-x-0 bottom-0 p-3 md:p-4">
                        <p className="line-clamp-2 text-sm font-black leading-tight text-white drop-shadow md:text-base">
                            {current.base.product_name}
                        </p>
                        <p className="mt-0.5 text-xs font-bold text-amber-300 md:text-sm">
                            {current.options.length > 1 ? "mulai " : ""}
                            {fmtIDR(current.fromPrice)}
                        </p>
                    </div>
                </motion.button>
            </AnimatePresence>

            {/* Group name, top-left, above the slides */}
            <div className="pointer-events-none absolute inset-x-0 top-0 p-3">
                <span className="line-clamp-1 text-[11px] font-black uppercase tracking-[0.14em] text-white/90 drop-shadow md:text-xs">
                    {section.label}
                </span>
            </div>

            {count > 1 && (
                <>
                    <span className="pointer-events-none absolute right-2.5 top-2.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-black tabular-nums text-white backdrop-blur-sm">
                        {index + 1}/{count}
                    </span>
                    {/* Arrows: a mouse has no swipe. Hidden on touch-size screens. */}
                    <button
                        type="button"
                        onClick={() => go(-1)}
                        aria-label="Sebelumnya"
                        className="absolute left-1.5 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/45 p-1.5 text-white/80 backdrop-blur-sm transition hover:bg-black/70 hover:text-white md:block"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        onClick={() => go(1)}
                        aria-label="Berikutnya"
                        className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/45 p-1.5 text-white/80 backdrop-blur-sm transition hover:bg-black/70 hover:text-white md:block"
                    >
                        <ChevronRight className="h-4 w-4" />
                    </button>
                    {/* How long until the next slide. */}
                    <div className="pointer-events-none absolute inset-x-3 bottom-1.5 h-0.5 overflow-hidden rounded-full bg-white/15">
                        <motion.div
                            key={`${index}-${running}`}
                            className="h-full origin-left bg-amber-400"
                            initial={{ scaleX: 0 }}
                            animate={{ scaleX: running ? 1 : 0 }}
                            transition={{ duration: running ? SLIDE_MS / 1000 : 0, ease: "linear" }}
                        />
                    </div>
                </>
            )}
        </div>
    );
}
