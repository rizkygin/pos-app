"use client";

import { motion } from "motion/react";
import { Ticket } from "lucide-react";
import { fmtIDR } from "@/lib/utils/format";

export type OutletPromo = {
    id: string;
    title: string;
    description: string;
    code: string;
    discountPercent: number;
    minOrder: number;
    expiresAt: string;
    color: string;
    bgGradient: string;
};

export function OutletPromoCard({
    promo,
    onApply,
    isApplied,
}: {
    promo: OutletPromo;
    onApply: (promo: OutletPromo) => void;
    isApplied: boolean;
}) {
    return (
        <motion.div
            whileHover={{ scale: 1.02 }}
            className={`relative flex-shrink-0 w-64 md:w-72 rounded-3xl bg-gradient-to-br ${promo.bgGradient} p-5 overflow-hidden cursor-pointer`}
            onClick={() => onApply(promo)}
        >
            <div className="absolute -top-6 -right-6 h-24 w-24 rounded-full bg-white/10" />
            <div className="absolute -bottom-4 -right-2 h-16 w-16 rounded-full bg-white/10" />

            <div className="relative z-10 space-y-2">
                <div className="flex items-center gap-2">
                    <Ticket className="h-4 w-4 text-white/80" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-white/80">Promo</span>
                </div>
                <h3 className="font-black text-white text-base leading-tight">{promo.title}</h3>
                <p className="text-white/80 text-xs">{promo.description}</p>
                <div className="flex items-center justify-between pt-1">
                    <div className="px-3 py-1 rounded-full bg-white/20 border border-white/30 backdrop-blur-sm">
                        <span className="text-xs font-black text-white tracking-widest">{promo.code}</span>
                    </div>
                    <span className="text-white/70 text-[10px] font-bold">Min. {fmtIDR(promo.minOrder)}</span>
                </div>
                {isApplied && (
                    <div className="flex items-center gap-1 text-white text-xs font-bold">
                        <span className="h-2 w-2 rounded-full bg-green-400 inline-block" />
                        Diterapkan
                    </div>
                )}
            </div>

            <div className="absolute top-4 right-4 bg-white/20 rounded-2xl px-3 py-2 text-center">
                <p className="text-white font-black text-xl leading-none">{promo.discountPercent}%</p>
                <p className="text-white/80 text-[9px] font-bold">OFF</p>
            </div>
        </motion.div>
    );
}
