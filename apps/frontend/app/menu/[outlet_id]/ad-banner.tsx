"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Megaphone } from "lucide-react";
import { resolveBannerImage, isBackendImage } from "@/lib/image-src";
import type { MenuAd } from "./menu-types";

const AD_MS = 5000;

/**
 * The outlet's own ads from Pasang Iklan, on air right now (see outletActiveAds
 * in the backend), as a banner across the top of the menu. Tapping one opens
 * the product it advertises when that product is on this menu.
 */
export function AdBanner({ ads, onOpen }: { ads: MenuAd[]; onOpen: (productId: string) => void }) {
    const [index, setIndex] = useState(0);
    const reduce = useReducedMotion();
    const count = ads.length;

    useEffect(() => {
        if (count < 2) return;
        const t = setTimeout(() => setIndex((i) => (i + 1) % count), AD_MS);
        return () => clearTimeout(t);
    }, [index, count]);

    if (count === 0) return null;
    const ad = ads[index % count];

    return (
        <div className="relative aspect-2/1 w-full overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-xl shadow-black/40 sm:aspect-3/1">
            <AnimatePresence initial={false} mode="popLayout">
                <motion.button
                    key={ad.id}
                    type="button"
                    onClick={() => onOpen(ad.productId)}
                    initial={reduce ? false : { opacity: 0, scale: 1.04 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={reduce ? undefined : { opacity: 0 }}
                    transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    className="absolute inset-0 block text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                    aria-label={ad.title}
                >
                    <motion.div
                        className="absolute inset-0"
                        animate={reduce ? undefined : { scale: [1, 1.08] }}
                        transition={{ duration: AD_MS / 1000 + 1, ease: "linear" }}
                    >
                        <Image
                            src={resolveBannerImage(ad.bannerImage)}
                            unoptimized={isBackendImage(ad.bannerImage)}
                            alt={ad.title}
                            fill
                            className="object-cover"
                            sizes="(max-width: 896px) 100vw, 896px"
                        />
                    </motion.div>
                    <div className="absolute inset-0 bg-linear-to-r from-black/75 via-black/25 to-transparent" />
                    <div className="absolute inset-y-0 left-0 flex max-w-[80%] flex-col justify-end gap-1 p-4 pb-6 sm:max-w-[70%] md:p-6">
                        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-amber-400/90 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-black">
                            <Megaphone className="h-3 w-3" />
                            Promo
                        </span>
                        <p className="line-clamp-2 text-base font-black leading-tight text-white drop-shadow md:text-2xl">
                            {ad.title}
                        </p>
                        {ad.description && (
                            <p className="line-clamp-1 text-xs text-white/70 sm:line-clamp-2 md:text-sm">{ad.description}</p>
                        )}
                    </div>
                </motion.button>
            </AnimatePresence>

            {count > 1 && (
                <div className="absolute bottom-2.5 right-3 flex gap-1.5">
                    {ads.map((a, i) => (
                        <button
                            key={a.id}
                            type="button"
                            onClick={() => setIndex(i)}
                            aria-label={`Iklan ${i + 1}`}
                            className={`h-1.5 rounded-full transition-all ${
                                i === index ? "w-5 bg-amber-400" : "w-1.5 bg-white/40 hover:bg-white/70"
                            }`}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
