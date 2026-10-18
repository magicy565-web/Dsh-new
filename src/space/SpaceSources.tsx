import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';

export type SpaceSource = { kind: 'product' | 'document' | 'medusa-product'; id: string; revision: number; sourceId?: string; sourceHash?: string; documentVersion?: number; asset?: { artifactId: string; version: number; sha256: string } };
export type SourceResolution = { reference: SpaceSource; status: 'current' | 'updated' | 'archived' | 'missing' | 'unavailable' | 'unchecked'; consistency?: string; checkedAt?: string; title?: string; referenceOnly?: boolean; libraryPath?: string };
type Option = { reference: SpaceSource; title: string; referenceOnly: boolean };
const key = (ref: SpaceSource) => `${ref.kind}:${ref.id}`;
const labels = { current: '版本一致', updated: '来源已更新，请重新选择', archived: '来源已归档', missing: '来源已移除', unavailable: '来源当前不可用', unchecked: '尚未核对远端来源' };

export function SpaceSources({ spaceId, selected, resolution, editable, onChange, onDenied, beforeNavigate }: {
  spaceId: string; selected: SpaceSource[]; resolution: SourceResolution[]; editable: boolean;
  onChange: (sources: SpaceSource[]) => void; onDenied: (reason: unknown) => void; beforeNavigate: () => boolean;
}) {
  const [kind, setKind] = useState<'product' | 'document' | 'medusa-product'>('product'), [q, setQ] = useState('');
  const [items, setItems] = useState<Option[]>([]), [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(0), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  function resetChoices() { generation.current++; setItems([]); setNext(null); setError(''); setBusy(false); }
  async function browse(offset = '0') {
    const ticket = ++generation.current;
    setBusy(true); setError('');
    try {
      const query = new URLSearchParams({ kind, q, offset });
      const result = await api<{ items: Option[]; nextOffset: string | null }>(`/library/spaces/${spaceId}/sources?${query}`);
      if (!alive.current || ticket !== generation.current) return;
      setItems(result.items); setNext(result.nextOffset);
    } catch (reason) {
      if (!alive.current || ticket !== generation.current) return;
      setItems([]); setNext(null);
      if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) onDenied(reason);
      setError(reason instanceof ApiError && reason.code === 'SPACE_MEDUSA_UNCONFIGURED' ? 'Medusa 来源尚未配置，请由管理员连接企业实例。' : reason instanceof Error ? reason.message : '无法读取来源。');
    } finally { if (alive.current && ticket === generation.current) setBusy(false); }
  }
  return <section className="space-sources" aria-label="页面来源">
    <h4>引用产品与资料</h4>
    <p className="space-hint">引用保留选定版本，不复制文件内容。分享此 Space 的成员可看到引用信息；模型和外部 Worker 的使用需另行授权。</p>
    {!selected.length && <p className="space-hint">尚未引用来源。</p>}
    <ul>{selected.map(ref => {
      const saved = resolution.find(row => key(row.reference) === key(ref) && JSON.stringify(row.reference) === JSON.stringify(ref));
      const option = items.find(row => JSON.stringify(row.reference) === JSON.stringify(ref));
      return <li key={key(ref)}><div><strong>{saved?.title ?? option?.title ?? `${ref.kind === 'document' ? '资料' : '产品'} · ${ref.id.slice(0, 8)}`}</strong><small>{ref.kind === 'product' ? `产品修订 ${ref.revision}` : ref.kind === 'medusa-product' ? `Medusa 审核修订 ${ref.revision}` : `资料 v${ref.documentVersion} · 修订 ${ref.revision}`} · {saved ? labels[saved.status] : '待保存时核对'}</small>{saved?.consistency === 'remote-point-in-time' && <small>远端核对于 {saved.checkedAt ? new Date(saved.checkedAt).toLocaleString() : '本次读取'}；不代表持续锁定</small>}{(saved?.referenceOnly || option?.referenceOnly) && <small>公开参考 · 不代表本企业供货或资质</small>}{saved?.libraryPath && <a href={`/library/${saved.libraryPath}`} onClick={event => { if (!beforeNavigate()) event.preventDefault(); }}>查看原库</a>}</div>{editable && <button type="button" aria-label={`移除引用 ${saved?.title ?? ref.id}`} onClick={() => onChange(selected.filter(row => key(row) !== key(ref)))}>移除</button>}</li>;
    })}</ul>
    {editable && <details><summary>选择来源</summary>
      <div className="space-form-row"><label>来源类型<select value={kind} onChange={event => { resetChoices(); setKind(event.target.value as typeof kind); }}><option value="product">企业产品</option><option value="document">企业资料</option><option value="medusa-product">Medusa 已审核产品</option></select></label><label>按名称查找<input value={q} maxLength={100} onChange={event => { resetChoices(); setQ(event.target.value); }} /></label></div>
      <button type="button" disabled={busy} onClick={() => void browse()}>{busy ? '正在读取…' : '查找来源'}</button>
      {error && <p role="alert">{error}</p>}
      <ul>{items.map(item => {
        const existing = selected.find(row => key(row) === key(item.reference)), same = JSON.stringify(existing) === JSON.stringify(item.reference);
        return <li key={key(item.reference)}><div><strong>{item.title}</strong><small>修订 {item.reference.revision}{item.reference.documentVersion ? ` · 文件 v${item.reference.documentVersion}` : ''}</small>{item.referenceOnly && <small>公开参考 · 不代表本企业供货或资质</small>}</div><button type="button" disabled={same || !existing && selected.length >= 30} onClick={() => onChange([...selected.filter(row => key(row) !== key(item.reference)), item.reference])}>{same ? '已选择' : existing ? '改用此版本' : '引用'}</button></li>;
      })}</ul>
      {next && <button type="button" disabled={busy} onClick={() => void browse(next)}>下一页来源</button>}
      <p className="space-hint">最多 30 项，其中 Medusa 最多 8 项。选择后使用页面的“保存修改”一起保存。Medusa 查询仅检查最近返回的最多 100 项已审核产品，不保证完整目录。</p>
    </details>}
  </section>;
}
