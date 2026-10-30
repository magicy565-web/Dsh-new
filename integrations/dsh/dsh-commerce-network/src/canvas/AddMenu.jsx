import React, { useEffect, useRef } from 'react';
import { Factory, Store, Bot, ClipboardList, Package, Megaphone, FileText, Inbox, Sparkles, Plus } from 'lucide-react';

const ICONS = { product: Package, factory: Factory, distributor: Store, agent: Bot, channel: Megaphone, mandate: FileText, order: ClipboardList, 'import-rfq': Inbox, review: Sparkles };
const itemsOf = (root) => [...(root?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])];

/**
 * Menu of things the canvas can start. `sections` is `[{ title, items: [{ id, label, description, disabled, reason, run }] }]`.
 * Opened from the toolbar (anchored above it) or at a point on the canvas.
 */
export function AddMenu({ title = '添加到网络', sections, placement, point, bounds, onClose }) {
  const root = useRef(null);
  useEffect(() => {
    itemsOf(root.current)[0]?.focus();
    const outside = (event) => { if (!root.current?.contains(event.target)) onClose(); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [onClose]);
  const keyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = itemsOf(root.current);
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  };
  const style = placement === 'point' && point && bounds
    ? { left: Math.max(8, Math.min(point.x - bounds.left, bounds.width - 296)), top: Math.max(8, Math.min(point.y - bounds.top, bounds.height - 360)) }
    : undefined;
  return (
    <div ref={root} className={`cv-addmenu cv-addmenu-${placement}`} style={style} role="menu" aria-label={title} onKeyDown={keyDown}>
      <header><Plus size={14} aria-hidden="true" /><strong>{title}</strong></header>
      <div className="cv-addmenu-scroll">
        {sections.map((section) => (
          <section key={section.title} aria-label={section.title}>
            <h3>{section.title}</h3>
            {section.items.map((item) => {
              const Icon = ICONS[item.icon || item.id] || Sparkles;
              return (
                <button type="button" role="menuitem" key={item.id} className="cv-addmenu-item" disabled={item.disabled} title={item.disabled ? item.reason : undefined} onClick={() => item.run()}>
                  <span className="cv-menu-icon"><Icon size={16} aria-hidden="true" /></span>
                  <span className="cv-menu-text"><b>{item.label}</b><small>{item.disabled ? item.reason : item.description}</small></span>
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}
