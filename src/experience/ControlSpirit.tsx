import { useEffect, useState } from 'react';
export type SpiritState = 'loading' | 'offline' | 'attention' | 'working' | 'idle' | 'setup';
const spiritImage = new URL('./assets/control-spirit.png', import.meta.url).href;
export function ControlSpirit({ state, onOpen }: { state: SpiritState; onOpen: () => void }) {
  const [hidden, setHidden] = useState(document.hidden);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return <button type="button" className={`control-spirit is-${state}`} data-resting={hidden} onClick={onOpen} aria-label="打开主控任务" aria-haspopup="dialog">
    <span className="control-spirit-halo" aria-hidden="true" />
    <span className="control-spirit-float">{imageFailed ? <span className="control-spirit-fallback" aria-hidden="true">••</span> : <img src={spiritImage} alt="" width="1280" height="1280" draggable="false" onError={() => setImageFailed(true)} />}</span>
    <span className="control-spirit-shadow" aria-hidden="true" />
  </button>;
}
