import type { CSSProperties } from 'react';
export type IconName = 'chat' | 'search' | 'activity' | 'ideas' | 'goals' | 'library' | 'settings' | 'menu' | 'plus' | 'close' | 'arrow' | 'chevron' | 'heart' | 'people' | 'money' | 'work' | 'palette' | 'laptop' | 'check' | 'clock' | 'shield' | 'fingerprint' | 'edit' | 'more' | 'copy' | 'bookmark' | 'trash' | 'pause' | 'play' | 'stop' | 'external' | 'refresh' | 'back' | 'file' | 'sparkle' | 'info' | 'download' | 'panel' | 'bolt' | 'gift' | 'microphone' | 'chats' | 'list';
const paths: Record<IconName, React.ReactNode> = {
  gift: <><path d="M4 11h16v10H4zM3 7h18v4H3zM12 7v14"/><path d="M12 7H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z"/></>,
  microphone: <><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 11v1a6 6 0 0 0 12 0v-1M12 18v3M9 21h6"/></>,
  chats: <><path d="M21 10a8 8 0 0 1-8 8 9 9 0 0 1-3-.6L5 19l1.5-4.3A8 8 0 1 1 21 10Z"/><path d="M3 9a8 8 0 0 0 4 12l-5 1 1-5"/></>,
  list: <><path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r=".7" fill="currentColor"/><circle cx="4" cy="12" r=".7" fill="currentColor"/><circle cx="4" cy="18" r=".7" fill="currentColor"/></>,
  chat: <><path d="M20 11.5a8 8 0 0 1-8.5 8 9 9 0 0 1-3.1-.6L3 21l1.7-5a8 8 0 1 1 15.3-4.5Z" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.7"/><path d="m15.5 15.5 5 5"/></>,
  activity: <><rect x="6" y="3" width="14" height="18" rx="2"/><path d="M6 7H4a1 1 0 0 0-1 1v11a2 2 0 0 0 2 2M10 8h6M10 12h4"/></>,
  ideas: <><path d="M8 16c0-3-3-3.6-3-7a7 7 0 0 1 14 0c0 3.4-3 4-3 7M8 16h8M9 19h6M10 22h4"/></>,
  goals: <><rect x="4" y="3" width="16" height="18" rx="4"/><path d="m8 12 3 3 5-7"/></>,
  library: <><circle cx="6" cy="5.5" r="3"/><rect x="3" y="14" width="6" height="6" rx="1.5"/><path d="m17 2 4 7h-8z"/><path d="m17 13 4 4-4 4-4-4z"/></>,
  settings: <><path d="M3 5h18M3 12h18M3 19h18"/><circle cx="8" cy="5" r="2" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="10" cy="19" r="2" fill="currentColor" stroke="none"/></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16"/>, plus: <path d="M12 4v16M4 12h16"/>, close: <path d="m6 6 12 12M18 6 6 18"/>, arrow: <path d="M12 20V4m-6 6 6-6 6 6"/>, chevron: <path d="m9 5 7 7-7 7"/>,
  heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>,
  people: <><circle cx="9" cy="7" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2ZM16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2h-3"/></>,
  money: <><path d="M12 2v20M17 6c-1-3-10-3-10 2 0 5 10 3 10 8 0 5-9 5-11 1"/></>,
  work: <><rect x="3" y="7" width="18" height="14" rx="3"/><path d="M8 7V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3M3 12a24 24 0 0 0 18 0"/></>,
  palette: <><path d="M21 11a9 9 0 1 0-9 10h1a2 2 0 0 0 1-3.7c-1.7-1 .4-3.3 2-3.3h2a3 3 0 0 0 3-3Z"/><circle cx="7" cy="10" r=".7"/><circle cx="10" cy="6" r=".7"/><circle cx="15" cy="6.5" r=".7"/><circle cx="18" cy="10" r=".7"/></>,
  laptop: <><path d="M5 16V4h14v12M2 20l3-4h14l3 4Z"/></>,
  check: <><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>, clock: <><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/></>, fingerprint: <><path d="M4 12a8 8 0 0 1 16 0M7 12a5 5 0 0 1 10 0c0 4 1 6 3 8M10 12a2 2 0 0 1 4 0c0 5 1 8 3 10M4 16v3M7 16c0 3-1 4-1 4M10 16c0 4-1 6-1 6M13 20l1 2"/></>,
  edit: <><path d="m15 4 5 5M4 20l2-7L16 3a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3L11 18Z"/></>, more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>, copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></>, bookmark: <path d="M6 3h12v18l-6-4-6 4Z"/>, trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></>,
  pause: <><path d="M8 5v14M16 5v14"/></>, play: <path d="m7 4 14 8-14 8Z"/>, stop: <rect x="6" y="6" width="12" height="12" rx="2"/>, external: <><path d="M14 3h7v7M21 3 11 13M10 3H3v18h18v-7"/></>, refresh: <><path d="M20 8a8 8 0 1 0 .1 8M20 3v5h-5"/></>, back: <path d="M20 12H4m6-6-6 6 6 6"/>,
  file: <><path d="M14 3H5v18h14V8ZM14 3v5h5M8 13h8M8 17h6"/></>, sparkle: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/></>, info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.1"/></>, download: <><path d="M12 3v12m-5-5 5 5 5-5M4 14v7h16v-7"/></>, panel: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/></>, bolt: <path d="m13 2-9 12h7l-1 8 10-13h-8z"/>
};
export function Icon({ name, size = 22, className, style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true">{paths[name]}</svg>;
}
export function Orb({ small = false }: { small?: boolean }) { return <span className={`orb ${small ? 'orb-small' : ''}`} aria-hidden="true"><span className="orb-ring ring-one"/><span className="orb-ring ring-two"/><span className="orb-core"/><span className="orb-glint"/></span>; }
