"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "motion/react";
import { Star, MapPin, Clock, ArrowRight, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Outlet } from "@/lib/types";

export function OutletCard({ outlet, feature }: { outlet: Outlet; feature: string }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -4 }}
            className="group bg-card border border-border/60 rounded-[1.75rem] overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300"
        >
            <div className="relative h-44 overflow-hidden">
                <Image src={outlet.image.startsWith('http') || outlet.image.startsWith('/') ? outlet.image : `/${outlet.image}`} alt={outlet.name} fill className="object-cover group-hover:scale-110 transition-transform duration-500" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                <div className="absolute top-3 left-3 flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/95 backdrop-blur-sm shadow-sm">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    <span className="text-xs font-black text-black">{outlet.ratings}</span>
                    <span className="text-[10px] text-muted-foreground">
                        ({outlet.reviewCount >= 1000 ? (outlet.reviewCount / 1000).toFixed(1) + "k" : outlet.reviewCount})
                    </span>
                </div>

                {/* //if they have promo on the products */}
                {true && (
                    <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-rose-500/90 backdrop-blur-sm">
                        <span className="text-[10px] font-black text-white">Promo</span>
                    </div>
                )}
                <div className="absolute bottom-3 left-3">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-black ${outlet.isOpen ? "bg-green-400/90 text-green-900" : "bg-gray-400/90 text-gray-900"}`}>
                        {outlet.isOpen ? "Buka" : "Tutup"}
                    </span>
                </div>
            </div>

            <div className="p-4 space-y-2">
                <h3 className="font-black text-base leading-tight group-hover:text-rose-600 transition-colors">{outlet.name}</h3>

                <div className="flex flex-wrap gap-1.5">
                    {outlet.tags.map((tag) => (
                        <span key={tag} className="px-2 py-0.5 rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                            {tag}
                        </span>
                    ))}
                </div>

                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        <span>{outlet.address}</span>
                    </div>
                    <div className="h-1 w-1 rounded-full bg-muted-foreground/30" />
                    <div className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        <span>{outlet.phone}</span>
                    </div>
                </div>

                <Link href={`/dashboard/order/${feature}/${outlet.id}`}>
                    <Button
                        className="w-full mt-1 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-bold text-sm shadow-sm shadow-rose-200"
                        disabled={!outlet.isOpen}
                    >
                        {outlet.isOpen ? "Lihat Menu" : "Sedang Tutup"}
                        {outlet.isOpen && <ArrowRight className="ml-2 h-3.5 w-3.5" />}
                    </Button>
                </Link>
            </div>
        </motion.div>
    );
}
