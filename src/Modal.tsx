import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './icons';

export function Modal({ title, children, onClose, className = '' }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const el = ref.current;
    const selector = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]';
    (el?.querySelector<HTMLElement>('[autofocus]') || el?.querySelector<HTMLElement>('input, textarea, select') || el)?.focus();
    function keydown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRef.current(); }
      if (e.key === 'Tab' && el) {
        const items = Array.from(el.querySelectorAll<HTMLElement>(selector)).filter(item => !item.closest('[hidden]'));
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === el)) { e.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className={`modal ${className}`} ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}><button type="button" className="icon-button modal-close" aria-label="关闭弹窗" onClick={onClose}><Icon name="close" size={20} /></button>{children}</div></div>;
}
