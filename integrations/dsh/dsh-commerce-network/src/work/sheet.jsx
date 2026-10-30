import React,{useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Check,Info,TriangleAlert,X} from 'lucide-react';

const FOCUSABLE='button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet over the whole app frame. It is portaled to the frame because screen content animates with a
 * transform, which would otherwise become the sheet's containing block and strand it at the end of long pages.
 */
export function Sheet(props){
  const anchor=useRef(null),[frame,setFrame]=useState(null);
  useLayoutEffect(()=>{setFrame(anchor.current?.closest('.aw-app')||document.body);},[]);
  return <><span ref={anchor} hidden/>{frame&&createPortal(<SheetLayer {...props}/>,frame)}</>;
}

/** Escape and the scrim close the sheet unless a command is in flight. */
function SheetLayer({title,onClose,busy=false,children,footer}){
  const panel=useRef(null),titleId=useId();
  useEffect(()=>{
    const previous=document.activeElement;panel.current?.focus();
    return()=>{if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};
  },[]);
  const onKeyDown=event=>{
    if(event.key==='Escape'&&!busy){event.stopPropagation();onClose();return;}
    if(event.key!=='Tab')return;
    const nodes=[...panel.current.querySelectorAll(FOCUSABLE)];if(!nodes.length)return;
    const first=nodes[0],last=nodes[nodes.length-1];
    if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel.current)){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  };
  return <div className="aw-sheet-layer" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}>
    <div className="aw-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={panel} onKeyDown={onKeyDown}>
      <span className="aw-grab" aria-hidden="true"/>
      <header className="aw-sheet-head"><h2 id={titleId}>{title}</h2><button type="button" className="aw-icon" aria-label="关闭" disabled={busy} onClick={onClose}><X size={18}/></button></header>
      <div className="aw-sheet-body">{children}</div>
      {footer&&<footer className="aw-sheet-foot">{footer}</footer>}
    </div>
  </div>;
}

export function Field({label,hint,htmlFor,children}){
  return <div className="aw-field"><label className="aw-label" htmlFor={htmlFor}>{label}</label>{children}{hint&&<small className="aw-hint">{hint}</small>}</div>;
}

/** Single or multiple choice rendered as chips. Real inputs stay in the DOM for keyboards and screen readers. */
export function ChipGroup({legend,options,value,onChange,multiple=false,name}){
  const picked=multiple?value:[value];
  return <fieldset className="aw-chips"><legend className="aw-label">{legend}</legend>
    <div className="aw-chip-row">{options.map(option=>{
      const on=picked.includes(option.id);
      return <label key={option.id} className="aw-chip" data-on={on||undefined} data-disabled={option.disabled||undefined}>
        <input type={multiple?'checkbox':'radio'} name={name||legend} checked={on} disabled={option.disabled} onChange={()=>onChange(option.id)}/>
        <span>{option.label}</span>
      </label>;
    })}</div>
  </fieldset>;
}

/** One toggle per row: a capability, a confirmation, a product. */
export function CheckRow({label,note,checked,onChange,disabled=false}){
  return <label className="aw-check" data-disabled={disabled||undefined}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={event=>onChange(event.target.checked)}/>
    <span className="aw-box" aria-hidden="true">{checked&&<Check size={14} strokeWidth={3}/>}</span>
    <span className="aw-check-text"><strong>{label}</strong>{note&&<small>{note}</small>}</span>
  </label>;
}

export function Notice({tone='info',children}){
  const Icon=tone==='alert'?TriangleAlert:Info;
  return <p className="aw-notice" data-tone={tone} role={tone==='alert'?'alert':'note'}><Icon size={16} aria-hidden="true"/><span>{children}</span></p>;
}
