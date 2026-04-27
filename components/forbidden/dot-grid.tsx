import React from 'react';

export default function DotGrid() {
    return (
        <div
            className="absolute inset-0 z-0 pointer-events-none opacity-[0.04]"
            style={{
                backgroundImage: 'radial-gradient(circle, hsl(var(--foreground)) 0.5px, transparent 0.5px)',
                backgroundSize: '24px 24px',
            }}
        />
    );
}