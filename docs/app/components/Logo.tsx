import React from 'react';

export function TestformLogo({ className = 'h-7 w-auto' }: { className?: string }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.65rem',
        userSelect: 'none',
        textDecoration: 'none',
      }}
    >
      <svg
        className={className}
        style={{ height: '1.75rem', width: '1.75rem', flexShrink: 0 }}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="tf-stem" x1="12.5" y1="13" x2="19.5" y2="26" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#0284c7" />
          </linearGradient>
          <linearGradient id="tf-top" x1="12.5" y1="2" x2="19.5" y2="15" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#0284c7" />
            <stop offset="100%" stopColor="#4f46e5" />
          </linearGradient>
        </defs>
        {/* Top-Left Wing */}
        <path d="M 3.5 11 L 10.5 7 L 10.5 16 L 3.5 20 Z" fill="#6366f1" />
        {/* Top-Center Tile */}
        <path d="M 12.5 6 L 19.5 2 L 19.5 11 L 12.5 15 Z" fill="url(#tf-top)" />
        {/* Top-Right Wing */}
        <path d="M 21.5 11 L 28.5 7 L 28.5 16 L 21.5 20 Z" fill="#38bdf8" />
        {/* Stem (Lower Center Tile) */}
        <path d="M 12.5 17 L 19.5 13 L 19.5 22 L 12.5 26 Z" fill="url(#tf-stem)" />
      </svg>
      <span style={{ fontWeight: 800, fontSize: '1.15rem', letterSpacing: '-0.03em' }}>
        test<span style={{ color: '#0284c7' }}>form</span>
      </span>
    </div>
  );
}
