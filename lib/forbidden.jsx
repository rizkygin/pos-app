'use client'
import React from 'react';
import { motion } from 'framer-motion';
import IcosahedronScene from '@/components/forbidden/IcosahedronScene';
import DotGrid from '@/components/forbidden/dot-grid';
import Wayfinder from '@/components/forbidden/Wayfinder';

export default function Forbidden() {
    return (
        <main className="w-full h-screen bg-[#121212] overflow-hidden relative flex flex-col items-center justify-center font-inter select-none">
            {/* Dot grid overlay */}
            <DotGrid />

            {/* 3D Scene fills the full background */}
            <div className="absolute inset-0 z-10">
                <IcosahedronScene />
            </div>

            {/* Centered content: "403 Forbidden" above + below the model */}
            <motion.div
                className="z-20 flex flex-col items-center pointer-events-none text-center"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 1, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
                {/* Big "403 Forbidden" text */}
                <h1
                    className="text-[14vw] md:text-[12vw] font-black text-white leading-none"
                    style={{ letterSpacing: '-0.04em' }}
                >
                    403 Forbidden
                </h1>

                <motion.div
                    className="mt-6 flex flex-col items-center gap-3"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.8, delay: 0.9 }}
                >
                    <p
                        className="text-[11px] md:text-xs uppercase font-medium text-white/50"
                        style={{ letterSpacing: '0.5em' }}
                    >
                        Access_Denied
                    </p>
                    <motion.div
                        className="h-px w-16 md:w-24 bg-[#0033FF] mx-auto"
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ duration: 0.8, delay: 1.1 }}
                    />
                </motion.div>
            </motion.div>

            {/* Corner coordinates */}
            <div className="absolute top-6 left-8 z-30 text-[9px] font-mono text-white/20 hidden md:block">
                STATUS: 403
            </div>
            <div className="absolute top-6 right-8 z-30 text-[9px] font-mono text-white/20 hidden md:block">
                THRESHOLD_ACTIVE
            </div>

            {/* Wayfinder navigation */}
            <Wayfinder />
        </main>
    );
}