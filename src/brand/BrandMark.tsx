import type { CSSProperties } from 'react';
/** One continuous path + a destination. Geometry is shared with public identity assets. */
export function BrandMark({ size = 40, bare = false }: { size?: number; bare?: boolean }) {
  const style: CSSProperties = { width: size, height: size, flexShrink: 0 };
  return <svg className={`ys-mark${bare ? ' ys-mark-bare' : ''}`} viewBox="0 0 48 48" fill="none" style={style} aria-hidden="true" focusable="false">
    {!bare && <rect width="48" height="48" rx="14" fill="var(--ys-ink, #1e252b)"/>}
    <path d="m9 34 11-13 8 7 9-10" stroke={bare ? 'currentColor' : '#fff'} strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="39" cy="13" r="4.2" fill="var(--ys-blue, #285cff)"/>
  </svg>;
}
