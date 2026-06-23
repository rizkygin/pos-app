"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Ticket, Copy, Check } from "lucide-react";

type Promo = {
    id: string;
    code: string;
    title: string;
    description: string;
    discountPercent: number;
    minOrder: number;
    maxDiscount?: number;
    validUntil: string;
    gradient: string;
};

function fmt(price: number) {
    return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(price);
}

export function PromoCodeCard({ promo }: { promo: Promo }) {
    const [copied, setCopied] = useState(false);

    function copy() {
        navigator.clipboard.writeText(promo.code).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    return (
        <motion.div
            whileHover={{ scale: 1.02 }}
            className={`relative flex-shrink-0 w-72 md:w-80 rounded-3xl bg-gradient-to-br ${promo.gradient} p-5 overflow-hidden`}
        >
            <div className="absolute -top-8 -right-8 h-32 w-32 rounded-full bg-white/10" />
            <div className="absolute -bottom-4 right-8 h-16 w-16 rounded-full bg-white/10" />

            <div className="relative z-10 space-y-3">
                <div className="flex items-center gap-2">
                    <Ticket className="h-4 w-4 text-white/80" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-white/70">Kode Promo</span>
                    <div className="ml-auto bg-white/20 rounded-2xl px-2.5 py-1 text-center">
                        <p className="text-white font-black text-lg leading-none">{promo.discountPercent}%</p>
                        <p className="text-white/70 text-[9px] font-bold">OFF</p>
                    </div>
                </div>

                <div>
                    <h3 className="font-black text-white text-base">{promo.title}</h3>
                    <p className="text-white/75 text-xs mt-0.5">{promo.description}</p>
                </div>

                <div className="flex items-center gap-2">
                    <div className="flex-1 px-3 py-2 rounded-xl bg-white/20 border border-white/30">
                        <span className="text-sm font-black text-white tracking-widest">{promo.code}</span>
                    </div>
                    <button
                        onClick={copy}
                        className="h-9 w-9 rounded-xl bg-white/20 border border-white/30 flex items-center justify-center hover:bg-white/30 transition-colors"
                    >
                        {copied ? <Check className="h-4 w-4 text-white" /> : <Copy className="h-4 w-4 text-white" />}
                    </button>
                </div>

                <div className="flex items-center justify-between text-white/60 text-[11px]">
                    <span>Min. {fmt(promo.minOrder)}</span>
                    {promo.maxDiscount && <span>Maks. {fmt(promo.maxDiscount)}</span>}
                    <span>s/d {promo.validUntil}</span>
                </div>
            </div>
        </motion.div>
    );
}
