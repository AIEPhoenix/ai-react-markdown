import React from 'react';

/** A wrapping flex row of equal-width comparison panels. */
export function Columns({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>{children}</div>;
}

/** A single labeled comparison panel. */
export function Column({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ flex: '1 1 320px', minWidth: 280 }}>
      <div
        style={{
          marginBottom: 10,
          fontFamily: 'ui-monospace, monospace',
          fontSize: 12,
          letterSpacing: 0.3,
          textTransform: 'uppercase',
          opacity: 0.6,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
