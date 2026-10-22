import React from 'react';

export function TestformLogo({ className = 'h-7 w-auto' }: { className?: string }) {
  return (
    <div className="flex items-center gap-2.5 select-none" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.625rem', userSelect: 'none' }}>
      <svg
        className={className}
        style={{ height: '1.75rem', width: 'auto', flexShrink: 0 }}
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="tf-grad-1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="50%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
          <linearGradient id="tf-grad-glow" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.1" />
          </linearGradient>
        </defs>
        {/* Hexagonal Isometric Base */}
        <path
          d="M18 2.5L31.5 10.29V25.71L18 33.5L4.5 25.71V10.29L18 2.5Z"
          fill="url(#tf-grad-glow)"
          stroke="url(#tf-grad-1)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {/* Inner Isometric Node Edges */}
        <path
          d="M18 2.5V18M31.5 10.29L18 18M4.5 10.29L18 18"
          stroke="url(#tf-grad-1)"
          strokeWidth="1.5"
          strokeOpacity="0.5"
        />
        {/* Verification Checkmark */}
        <path
          d="M12 18L16.5 22.5L24.5 13"
          stroke="#38bdf8"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span style={{ fontWeight: 700, fontSize: '1.15rem', letterSpacing: '-0.025em', color: 'currentColor' }}>
        Testform
      </span>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '0.1rem 0.4rem',
          fontSize: '0.65rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          borderRadius: '0.375rem',
          border: '1px solid rgba(56, 189, 248, 0.35)',
          backgroundColor: 'rgba(56, 189, 248, 0.1)',
          color: '#0284c7'
        }}
        className="dark:text-cyan-400"
      >
        v1.0
      </span>
    </div>
  );
}
