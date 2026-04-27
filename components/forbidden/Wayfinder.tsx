import React from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';

export default function Wayfinder() {
    return (
        <motion.nav
            className="absolute bottom-8 left-0 right-0 px-8 md:px-12 flex justify-between items-end z-30"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 1.2 }}
        >
            <div className="text-[10px] leading-relaxed font-mono text-white/30 hidden sm:block">
                ERROR_REF: 403<br />
                SEC_LEVEL: ALPHA
            </div>
            <Link
                href="/"
                className="group flex items-center gap-4 text-xs font-bold uppercase tracking-[0.25em] text-white hover:text-[#0033FF] transition-colors duration-500"
            >
                <span className="w-8 h-px bg-white group-hover:w-16 group-hover:bg-[#0033FF] transition-all duration-500" />
                Return to Safety
            </Link>
        </motion.nav>
    );
}