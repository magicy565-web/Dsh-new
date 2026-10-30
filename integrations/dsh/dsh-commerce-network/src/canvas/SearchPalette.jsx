import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { KINDS, STATUSES } from '../model.mjs';
import { KindIcon, familyClass, Status } from '../NodeCard.jsx';
import { KIND_GROUPS, isVisibleInView } from './kinds.mjs';
import { searchNodes } from './search.mjs';

const LABELS = { kinds: KINDS, statuses: STATUSES };

function toggled(set, value) {
  const next = new Set(set);
  if (next.has(value)) next.delete(value); else next.add(value);
  return next;
}

/** Command-palette style search with type and status filters. Results are ranked and keyboard navigable. */
export function SearchPalette({ nodes, filters, onFilters, onPick, onClose, view }) {
  const listId = useId();
  const input = useRef(null);
  const [active, setActive] = useState(0);
  const candidates = useMemo(() => nodes.filter((node) => node.kind), [nodes]);
  const statuses = useMemo(() => [...new Set(candidates.map((node) => node.status))].filter(Boolean).sort((a, b) => (STATUSES[a] || a).localeCompare(STATUSES[b] || b, 'zh-CN')), [candidates]);
  const presentKinds = useMemo(() => new Set(candidates.map((node) => node.kind)), [candidates]);
  const results = useMemo(() => searchNodes(candidates, LABELS, filters), [candidates, filters]);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { setActive(0); }, [filters]);

  const toggleGroup = (group) => {
    const present = group.kinds.filter((kind) => presentKinds.has(kind));
    const all = present.length > 0 && present.every((kind) => filters.kinds.has(kind));
    const next = new Set(filters.kinds);
    for (const kind of present) { if (all) next.delete(kind); else next.add(kind); }
    onFilters({ ...filters, kinds: next });
  };
  const pick = (entry) => { if (entry) onPick(entry.node); };
  const keyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.length) setActive((value) => (value + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
    }
    if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); pick(results[active]); }
  };

  return (
    <div className="cv-palette" role="dialog" aria-label="搜索节点" onKeyDown={keyDown}>
      <div className="cv-palette-input">
        <Search size={16} aria-hidden="true" />
        <input ref={input} value={filters.query} role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
          placeholder="搜索名称、类型、状态或编号" aria-label="搜索节点" autoComplete="off" spellCheck={false}
          onChange={(event) => onFilters({ ...filters, query: event.target.value })} />
        {filters.query && <button type="button" className="cn-icon-button" aria-label="清空搜索词" onClick={() => { onFilters({ ...filters, query: '' }); input.current?.focus(); }}><X size={14} /></button>}
        <kbd aria-hidden="true">Esc</kbd>
      </div>
      <div className="cv-chips" role="group" aria-label="按类型筛选">
        {KIND_GROUPS.filter((group) => group.kinds.some((kind) => presentKinds.has(kind))).map((group) => {
          const on = group.kinds.some((kind) => filters.kinds.has(kind));
          return <button type="button" key={group.id} className={on ? 'cv-selected' : ''} aria-pressed={on} onClick={() => toggleGroup(group)}>{group.label}</button>;
        })}
      </div>
      {statuses.length > 1 && (
        <div className="cv-chips" role="group" aria-label="按状态筛选">
          {statuses.map((status) => <button type="button" key={status} className={filters.statuses.has(status) ? 'cv-selected' : ''} aria-pressed={filters.statuses.has(status)} onClick={() => onFilters({ ...filters, statuses: toggled(filters.statuses, status) })}>{STATUSES[status] || status}</button>)}
        </div>
      )}
      <ul id={listId} role="listbox" aria-label={`搜索结果，共 ${results.length} 项`} className="cv-results">
        {results.map((entry, index) => (
          <li key={entry.node.id} id={`${listId}-${index}`} role="option" aria-selected={index === active} className={index === active ? 'cv-active' : ''} onMouseMove={() => setActive(index)} onClick={() => pick(entry)}>
            <span className={`cn-node-icon ${familyClass(entry.node.kind)}`}><KindIcon kind={entry.node.kind} size={16} /></span>
            <span className="cv-result-text"><b>{entry.node.title}</b><small>{KINDS[entry.node.kind]}{isVisibleInView(view, entry.node.kind) ? '' : ' · 当前视图已隐藏'}</small></span>
            <Status value={entry.node.status} />
          </li>
        ))}
        {!results.length && <li className="cv-results-empty" role="presentation">没有匹配的节点。试试更短的关键词，或清除筛选。</li>}
      </ul>
    </div>
  );
}
