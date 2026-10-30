import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, Check, Info, X } from 'lucide-react';
import { keyLabel } from './canvas/shortcuts.mjs';

export function IconButton({ label, children, pressed, active, className = '', ...rest }) {
  return (
    <button type="button" className={`cn-icon-button${active ? ' cn-active' : ''} ${className}`.trim()} aria-label={label} title={label} aria-pressed={pressed} {...rest}>
      {children}
    </button>
  );
}

export function Segmented({ value, options, onChange, label, className = '' }) {
  return (
    <div className={`cv-segmented ${className}`.trim()} role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.id} type="button" className={value === option.id ? 'cv-selected' : ''} aria-pressed={value === option.id} title={option.title} onClick={() => onChange(option.id)}>
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export function KeyHint({ keys }) {
  return (
    <span className="cv-keys" aria-hidden="true">
      {keys.map((key) => <kbd key={key}>{keyLabel(key)}</kbd>)}
    </span>
  );
}

const itemsOf = (root) => [...(root?.querySelectorAll('[role="menuitem"]:not(:disabled),[role="menuitemradio"]:not(:disabled)') || [])];

/** A button that opens a small menu. Closes on outside press, Escape, or after a choice. */
export function MenuButton({ label, children, icon, text, align = 'end', direction = 'down', badge, disabled, className = '', buttonClassName = 'cn-icon-button' }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef(null);
  const id = useId();
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => { if (!wrapper.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside, true);
    itemsOf(wrapper.current)[0]?.focus();
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  const keydown = (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); wrapper.current?.querySelector('[aria-haspopup]')?.focus(); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = itemsOf(wrapper.current);
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  };
  return (
    <span className={`cv-anchor ${className}`.trim()} ref={wrapper} onKeyDown={keydown}>
      <button type="button" className={buttonClassName} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={() => setOpen((value) => !value)}>
        {icon}{text && <span>{text}</span>}{badge && <i className="cv-dot" aria-hidden="true" />}
      </button>
      {open && <div id={id} role="menu" aria-label={label} className={`cv-popover cv-popover-${align} cv-popover-${direction}`}>{typeof children === 'function' ? children(() => setOpen(false)) : children}</div>}
    </span>
  );
}

export function MenuItem({ icon, children, hint, onSelect, disabled, reason, checked, role = 'menuitem', danger }) {
  return (
    <button type="button" role={role} aria-checked={role === 'menuitemradio' ? Boolean(checked) : undefined} className={`cv-menu-item${danger ? ' cv-danger' : ''}`} disabled={disabled} title={disabled ? reason : undefined} onClick={onSelect}>
      <span className="cv-menu-icon">{icon}</span>
      <span className="cv-menu-text">{children}{disabled && reason && <small>{reason}</small>}</span>
      {role === 'menuitemradio' && checked && <Check size={14} aria-hidden="true" />}
      {hint && <span className="cv-menu-hint">{hint}</span>}
    </button>
  );
}

export const MenuSeparator = () => <div className="cv-menu-separator" role="separator" />;
export const MenuLabel = ({ children }) => <div className="cv-menu-label" role="presentation">{children}</div>;

export function Detail({ label, value, mono = false }) {
  return <div className="cn-detail"><span>{label}</span><strong className={mono ? 'cn-mono' : ''}>{value === null || value === undefined || value === '' ? '待确认' : String(value)}</strong></div>;
}

export function TagList({ items, labels = {} }) {
  return <div className="cn-tags">{items?.length ? items.map((value, index) => <span key={`${value}:${index}`} title={String(value)}>{labels[value] || String(value)}</span>) : <span>公开信息研究</span>}</div>;
}

export function Banner({ tone = 'info', children, action, onDismiss }) {
  const Icon = tone === 'error' || tone === 'warning' ? AlertCircle : tone === 'success' ? Check : Info;
  return (
    <div className={`cv-banner cv-banner-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={15} aria-hidden="true" />
      <span>{children}</span>
      {action}
      {onDismiss && <button type="button" className="cn-icon-button" aria-label="关闭提示" onClick={onDismiss}><X size={14} /></button>}
    </div>
  );
}
