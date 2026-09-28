"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { motion, useInView, useReducedMotion } from "motion/react";
import { resolveProductImage, isBackendImage } from "@/lib/image-src";

/**
 * Four slow drifts, picked per image by a hash of its seed so neighbouring
 * cards never breathe in step — a grid of photos all zooming together reads as
 * a glitch, not as life.
 */
const DRIFTS = [
    { scale: [1.02, 1.14], x: ["0%", "-3%"], y: ["0%", "-2%"] },
    { scale: [1.12, 1.02], x: ["-2%", "2%"], y: ["-1%", "1%"] },
    { scale: [1.03, 1.13], x: ["2%", "-1%"], y: ["1%", "-2%"] },
    { scale: [1.1, 1.01], x: ["0%", "3%"], y: ["-2%", "0%"] },
];

const hash = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
};

/**
 * A product photo that is never quite still: a slow Ken Burns pan-and-zoom,
 * running only while it is on screen (a long menu must not animate forty
 * offscreen images) and not at all for a visitor who asked for reduced motion.
 */
export function LiveImage({
    image,
    alt,
    seed,
    sizes,
    className,
    duration = 9,
    priority,
}: {
    image: string;
    alt: string;
    /** Stable per image — decides its drift and its phase. */
    seed: string;
    sizes: string;
    className?: string;
    /** Seconds for one pass; it then plays back, forever. */
    duration?: number;
    priority?: boolean;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const inView = useInView(ref, { margin: "80px" });
    const reduce = useReducedMotion();
    const [failed, setFailed] = useState(false);
    const h = hash(seed);
    const drift = DRIFTS[h % DRIFTS.length];

    return (
        <div ref={ref} className={`absolute inset-0 overflow-hidden ${className ?? ""}`}>
            <motion.div
                className="absolute inset-0"
                initial={false}
                animate={
                    inView && !reduce
                        ? { scale: drift.scale, x: drift.x, y: drift.y }
                        : { scale: 1.02, x: "0%", y: "0%" }
                }
                transition={
                    inView && !reduce
                        ? {
                              duration: duration + (h % 5),
                              ease: "easeInOut",
                              repeat: Infinity,
                              repeatType: "mirror",
                              delay: (h % 7) * 0.3,
                          }
                        : { duration: 0.6 }
                }
                style={{ willChange: "transform" }}
            >
                <Image
                    src={failed ? "/avatar.png" : resolveProductImage(image)}
                    unoptimized={isBackendImage(image)}
                    alt={alt}
                    fill
                    priority={priority}
                    className="object-cover"
                    onError={() => setFailed(true)}
                    sizes={sizes}
                />
            </motion.div>
        </div>
    );
}
