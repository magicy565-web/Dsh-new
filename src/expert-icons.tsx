import type { ReactNode } from 'react';

/**
 * Original, purpose-built vector iconography for the eight production expert
 * positions. Icons are not text placeholders, user photographs, fake avatars,
 * third-party logos, or external assets. SVG remains crisp at every scale.
 */
const glyphs: Record<string, ReactNode> = {
  'growth-lead': <>
    <rect x="26" y="24" width="12" height="12" rx="4" fill="currentColor" fillOpacity=".14" stroke="currentColor" strokeWidth="2.2"/>
    <path d="M32 24V14m0 22v10M26 30H16m22 0h10M26.8 25.5l-7.1-7.1m17.5 17.1 7.1 7.1M37.2 25.5l7.1-7.1m-17.5 17.1-7.1 7.1" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"/>
    <circle cx="32" cy="10.5" r="3.5" fill="currentColor"/>
    <circle cx="32" cy="49.5" r="3.5" fill="currentColor"/>
    <circle cx="12.5" cy="30" r="3.5" fill="currentColor"/>
    <circle cx="51.5" cy="30" r="3.5" fill="currentColor"/>
    <circle cx="17.6" cy="16.3" r="2.8" stroke="currentColor" strokeWidth="2"/>
    <circle cx="46.4" cy="16.3" r="2.8" stroke="currentColor" strokeWidth="2"/>
    <circle cx="17.6" cy="43.7" r="2.8" stroke="currentColor" strokeWidth="2"/>
    <circle cx="46.4" cy="43.7" r="2.8" stroke="currentColor" strokeWidth="2"/>
  </>,
  'buyer-hunter': <>
    <circle cx="31" cy="29" r="18" stroke="currentColor" strokeWidth="2.1"/>
    <path d="M13.5 29h22M31 11c-6 5.8-9 11.9-9 18s3 12.2 9 18M31 11c5.9 6.1 8.7 12 8.7 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    <path d="M16 19.5h24M17 38.5h13" stroke="currentColor" strokeWidth="1.6" opacity=".8"/>
    <path d="M47 34.5c-7 0-12 5-12 11 0 8 12 15 12 15s12-7 12-15c0-6-5-11-12-11Z" fill="currentColor" fillOpacity=".12" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"/>
    <circle cx="47" cy="45.5" r="4" fill="currentColor"/>
  </>,
  'market-analyst': <>
    <path d="M10 51V17a4 4 0 0 1 4-4h30a4 4 0 0 1 4 4v15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
    <path d="M17 41v-8m9 8V25m9 16V20" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity=".65"/>
    <path d="M13 49h23" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    <circle cx="43.5" cy="43.5" r="9.5" fill="currentColor" fillOpacity=".10" stroke="currentColor" strokeWidth="2.2"/>
    <path d="m50.5 50.5 7 7" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round"/>
  </>,
  'channel-planner': <>
    <rect x="8" y="25" width="13" height="13" rx="4" fill="currentColor" fillOpacity=".15" stroke="currentColor" strokeWidth="2"/>
    <rect x="43" y="8" width="13" height="13" rx="4" fill="currentColor" fillOpacity=".15" stroke="currentColor" strokeWidth="2"/>
    <rect x="43" y="43" width="13" height="13" rx="4" fill="currentColor" fillOpacity=".15" stroke="currentColor" strokeWidth="2"/>
    <path d="M21 31.5h11.5c7.5 0 6-17 10.5-17M32.5 31.5c7.5 0 6 18 10.5 18" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="m39 10 4 4.5-4 4.5m0 26 4 4.5-4 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="14.5" cy="31.5" r="2" fill="currentColor"/>
  </>,
  'sales-specialist': <>
    <path d="M11 14h39a5 5 0 0 1 5 5v21a5 5 0 0 1-5 5H29L17 54v-9h-6a5 5 0 0 1-5-5V19a5 5 0 0 1 5-5Z" fill="currentColor" fillOpacity=".10" stroke="currentColor" strokeWidth="2.1" strokeLinejoin="round"/>
    <path d="M16 28h16m-16 7h10" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/>
    <path d="m38 29 5 5 9-12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
  </>,
  'brand-designer': <>
    <path d="m32 8 24 24-24 24L8 32 32 8Z" stroke="currentColor" strokeWidth="2.1"/>
    <path d="m32 18 14 14-14 14-14-14 14-14Z" fill="currentColor" fillOpacity=".12" stroke="currentColor" strokeWidth="2"/>
    <circle cx="32" cy="32" r="5.2" fill="currentColor"/>
    <path d="M11 14V7m-3.5 3.5h7M55 49v9m-4.5-4.5h9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
  </>,
  'commerce-tester': <>
    <path d="M9 25h46l-4.5-12h-37L9 25Zm0 0v28h46V25M20 53V36h15v17" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round"/>
    <path d="M9 25c0 9 11 9 11 0 0 9 11 9 11 0 0 9 12 9 12 0 0 9 12 9 12 0" stroke="currentColor" strokeWidth="2.1"/>
    <path d="m40 42 4.5 4.5L52 38" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/>
  </>,
  'rfq-analyst': <>
    <rect x="11" y="11" width="40" height="43" rx="6" stroke="currentColor" strokeWidth="2.2"/>
    <path d="M20 21h21M20 29h14M20 37h9" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"/>
    <circle cx="45" cy="45" r="12" fill="currentColor" fillOpacity=".14" stroke="currentColor" strokeWidth="2.1"/>
    <path d="M45 38v8l6 3m-10-18-6 3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
  </>,
};

const palette: Record<string, string> = {
  'growth-lead': 'expert-purple',
  'buyer-hunter': 'expert-blue',
  'market-analyst': 'expert-amber',
  'channel-planner': 'expert-cyan',
  'sales-specialist': 'expert-rose',
  'brand-designer': 'expert-pink',
  'commerce-tester': 'expert-green',
  'rfq-analyst': 'expert-slate',
};

export function ExpertMark({
  role, size = 'medium', className = '',
}: {
  role: string;
  size?: 'small' | 'medium' | 'large' | 'hero';
  className?: string;
}) {
  return <span className={['expert-mark', palette[role] || 'expert-slate', 'expert-mark-' + size, className].filter(Boolean).join(' ')} aria-hidden="true">
    <svg viewBox="0 0 64 64" fill="none" strokeLinejoin="round" role="presentation" focusable="false">
      {glyphs[role] || glyphs['growth-lead']}
    </svg>
  </span>;
}

export function ExpertTeamMark({ members, size = 'normal' }: { members: string[]; size?: 'normal' | 'compact' }) {
  return <span className={'expert-team-mark expert-team-mark-'+size} aria-hidden="true">
    {members.slice(0, 4).map((role,i)=><ExpertMark key={role+'-'+i} role={role} size="small"/>)}
  </span>;
}
