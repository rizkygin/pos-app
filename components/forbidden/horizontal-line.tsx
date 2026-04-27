import React from 'react';
import { motion } from 'framer-motion';

export default function HorizonLine() {
    return (
        <motion.div
            className="absolute left-0 right-0 top-1/2 -translate-y-1/2 z-[5] pointer-events-none"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 1.5, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
        >
            <div className="w-full h-px bg-foreground/[0.06]" />
        </motion.div>
    );
}