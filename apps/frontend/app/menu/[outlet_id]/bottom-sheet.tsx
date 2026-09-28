"use client";

import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";

/**
 * The page lock, COUNTED across sheets. Two sheets are often mounted at once:
 * sending an order closes the cart while the status sheet opens, and the cart
 * stays mounted through its exit animation. When each sheet saved and restored
 * body.overflow itself, the status sheet saved the cart's "hidden" and put it
 * back on close — leaving the menu unscrollable with no sheet on screen. So the
 * first lock saves the page's own value and only the last release restores it.
 */
let scrollLocks = 0;
let pageOverflow = "";

function lockPageScroll() {
    if (scrollLocks++ === 0) {
        pageOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
    }
    let released = false;
    return () => {
        if (released) return;
        released = true;
        if (--scrollLocks === 0) document.body.style.overflow = pageOverflow;
    };
}

/**
 * The menu's one sheet: a bottom sheet on a phone, a centred dialog from `sm`
 * up. Esc closes it, and the page behind is locked so the menu doesn't scroll
 * underneath on mobile. Render it inside an <AnimatePresence>.
 */
export function BottomSheet({
    label,
    onClose,
    children,
    header,
    footer,
    wide,
}: {
    label: string;
    onClose: () => void;
    children: React.ReactNode;
    /** Replaces the default title row (e.g. a full-bleed image with its own close). */
    header?: React.ReactNode;
    /**
     * Pinned under the scrolling body — where the sheet's one action lives, so
     * it is never a scroll away on a phone.
     */
    footer?: React.ReactNode;
    wide?: boolean;
}) {
    // Callers pass a fresh arrow every render; reading it through a ref keeps
    // the lock below from being released and re-taken on each re-render.
    const onCloseRef = useRef(onClose);
    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onCloseRef.current();
        };
        document.addEventListener("keydown", onKey);
        const release = lockPageScroll();
        return () => {
            document.removeEventListener("keydown", onKey);
            release();
        };
    }, []);

    return (
        <>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
                onClick={onClose}
            />
            <motion.div
                role="dialog"
                aria-modal="true"
                aria-label={label}
                initial={{ opacity: 0, y: 48 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 48 }}
                transition={{ type: "spring", stiffness: 420, damping: 36 }}
                className={`fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col overflow-hidden rounded-t-3xl border border-white/15 bg-[#1a1a1e] text-white shadow-2xl sm:inset-x-4 sm:bottom-auto sm:top-1/2 sm:mx-auto sm:max-h-[86vh] sm:-translate-y-1/2 sm:rounded-3xl ${
                    wide ? "sm:max-w-lg" : "sm:max-w-md"
                }`}
            >
                {header ?? (
                    <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
                        <h3 className="text-base font-black">{label}</h3>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Tutup"
                            className="rounded-full p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                )}
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
                {footer && (
                    <div className="shrink-0 border-t border-white/10 bg-[#1a1a1e] px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
                        {footer}
                    </div>
                )}
            </motion.div>
        </>
    );
}
