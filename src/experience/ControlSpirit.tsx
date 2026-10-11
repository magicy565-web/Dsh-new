import { useEffect, useId, useState } from 'react';
export type SpiritState = 'loading' | 'offline' | 'attention' | 'working' | 'idle' | 'setup';
type Motion = 'system' | 'on' | 'off';
const motionKey = 'workspace.control.motion';
export function ControlSpirit({ state, onOpen }: { state: SpiritState; onOpen: () => void }) {
  const id = useId().replace(/:/g, '');
  const [hidden, setHidden] = useState(document.hidden);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [motion, setMotion] = useState<Motion>(() => {
    try { const saved = localStorage.getItem(motionKey); return saved === 'on' || saved === 'off' ? saved : 'system'; }
    catch { return 'system'; }
  });
  const animated = motion === 'on' || (motion === 'system' && !reduced);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => setReduced(media.matches);
    document.addEventListener('visibilitychange', update);
    media.addEventListener('change', updateMotion);
    return () => { document.removeEventListener('visibilitychange', update); media.removeEventListener('change', updateMotion); };
  }, []);
  function toggleMotion() {
    const next = animated ? 'off' : 'on';
    setMotion(next);
    try { localStorage.setItem(motionKey, next); } catch { /* Still works without storage. */ }
  }
  return <div className="control-spirit-stage" data-motion={animated ? 'on' : 'off'} data-resting={hidden}>
    <button type="button" className={`control-spirit is-${state}`} onClick={onOpen} aria-label="打开主控任务" aria-haspopup="dialog">
    <span className="control-spirit-halo" aria-hidden="true" />
    <span className="control-spirit-float" aria-hidden="true">
      <svg className="spirit-body" viewBox="0 0 320 320" focusable="false">
        <defs>
          <radialGradient id={`${id}-body`} cx=".3" cy=".23" r=".85"><stop stopColor="#fff"/><stop offset=".32" stopColor="#e3f3ff"/><stop offset=".68" stopColor="#9fcaf4"/><stop offset="1" stopColor="#568acf"/></radialGradient>
          <linearGradient id={`${id}-rim`} x2=".7" y2="1"><stop stopColor="#fff"/><stop offset="1" stopColor="#85b8ef"/></linearGradient>
        </defs>
        <path d="M100 114C103 83 151 86 168 53C178 36 177 27 178 23C209 46 201 76 190 89C232 96 263 136 263 185C263 239 229 271 166 272C104 273 64 245 65 193C65 156 78 131 100 114Z" fill={`url(#${id}-body)`} stroke={`url(#${id}-rim)`} strokeWidth="2"/>
        <path d="M95 152C102 127 119 121 135 116" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="8" strokeLinecap="round"/>
        <ellipse cx="121" cy="219" rx="14" ry="7" fill="#f6cddc" opacity=".35"/>
        <ellipse cx="222" cy="219" rx="14" ry="7" fill="#f6cddc" opacity=".35"/>
      </svg>
      <span className="spirit-hand spirit-hand-left"><svg viewBox="0 0 60 80" focusable="false"><path d="M46 12C31 7 8 27 9 46C10 66 25 59 39 45C50 33 55 19 46 12Z" fill="#b5d9f8" stroke="#d8edff" strokeWidth="2"/></svg></span>
      <span className="spirit-hand spirit-hand-right"><svg viewBox="0 0 60 80" focusable="false"><path d="M15 15C26 8 49 16 52 35C55 55 39 59 25 43C17 34 5 22 15 15Z" fill="#9fc7ed" stroke="#cce7ff" strokeWidth="2"/></svg></span>
      <span className="spirit-face"><span className="spirit-eye spirit-eye-left"><i /></span><span className="spirit-eye spirit-eye-right"><i /></span><span className="spirit-smile" /></span>
    </span>
    <span className="control-spirit-shadow" aria-hidden="true" />
    </button>
    <button type="button" className="spirit-motion" onClick={toggleMotion} aria-label={animated ? '暂停精灵动画' : '开启精灵动画'} title={animated ? '暂停动画' : '开启动画'}>
      <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">{animated ? <path d="M8 6v12M16 6v12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/> : <path d="m9 6 9 6-9 6Z" fill="currentColor"/>}</svg>
    </button>
  </div>;
}
