import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { api, ApiError, requestId } from '../api';
import { Icon } from '../icons';
import './inquiry-recovery.css';

export type RecoveryRole = 'admin' | 'operator' | 'viewer';

type RejectionRow = { row?: number; code?: string; message?: string };

export type RecoveryImport = {
  importId: string;
  sourceName: string;
  format: string;
  actor: string;
  at: string;
  rows: number;
  accepted: number;
  rejected: RejectionRow[];
  inputSha256: string;
  inserted: number;
  updated: number;
  duplicate: number;
  conflict: number;
};

export type RecoveryStatus = {
  engineVersion: number;
  staleDays: number;
  asOf: string;
  counts: { leads: number; selections: number; imports: number; conflicts: number; follow_up: number; need_evidence: number; nurture: number; hold: number };
  lastImport: RecoveryImport | null;
};

export type RecoveryEvidence = {
  kind: string;
  sourceMessageId: string;
  quote: string;
  occurredAt: string | null;
  independentlyVerified: boolean;
  note?: string;
};

export type RecoveryCard = {
  leadId: string;
  sourceId: string;
  revision: number;
  sourceHash: string;
  company: { name: string | null; url: string | null; email: string | null; contact: string | null };
  request: { productId: string | null; product: string | null; quantity: number | null; unit: string | null; destination: string | null };
  status: string;
  identity: { status: string; reviewerConfirmed: boolean };
  lastContactAt: string | null;
  daysStale: number | null;
  decision: 'follow_up' | 'need_evidence' | 'nurture' | 'hold';
  reasons: string[];
  missing: string[];
  evidence: RecoveryEvidence[];
  nextStep: { action: string; why: string; risk: string };
  draft: { filename: string; sha256: string; sent: boolean; humanReviewRequired: boolean } | null;
  dateUnknown: string[];
  updatedAt: string;
};

type RecoveryOpportunities = {
  asOf: string;
  staleDays: number;
  summary: { follow_up: number; need_evidence: number; nurture: number; hold: number };
  cards: RecoveryCard[];
};

type RecoverySelection = {
  id: string;
  leadId: string;
  decision: string;
  daysStale: number | null;
  draft: { filename: string; sha256: string; content: string; sent: boolean; humanReviewRequired: boolean; humanReviewed: boolean };
  goalDraft: { draft: boolean; enabled: boolean; notWritten: boolean; title: string; description: string; maxSteps: number; authorityRequired: string };
};

type SheetState = { kind: 'import' } | { kind: 'identity'; card: RecoveryCard } | { kind: 'draft'; selection: RecoverySelection } | null;

const MAX_IMPORT_BYTES = 64 * 1024;
const DECISION_LABELS: Record<string, string> = { follow_up: '待跟进', need_evidence: '待补证', nurture: '培育中', hold: '暂停' };
const LEAD_STATUS_LABELS: Record<string, string> = { active: '活跃', won: '已成交', lost: '已流失', opted_out: '已拒绝联系', manual_hold: '人工暂停' };
const EVIDENCE_KIND_LABELS: Record<string, string> = { rfq: '询价', contact: '联系信息', purchase: '采购说法' };
const MISSING_LABELS: Record<string, string> = {
  contact_channel: '缺少可用的联系渠道（邮箱或联系人）',
  company_url: '缺少公司网址',
  product_binding: '缺少产品绑定',
};
const DATE_UNKNOWN_LABELS: Record<string, string> = { requestedAt: '询价时间', receivedAt: '接收时间', lastContactAt: '最近联系时间' };
const COLUMN_HELP = [
  'leadId', 'sourceId', 'revision', 'companyName', 'companyUrl', 'contactEmail', 'customerName',
  'productId', 'product', 'quantity', 'unit', 'destination', 'requestedAt', 'receivedAt', 'lastContactAt',
  'status', 'body', 'history', 'facts', 'requestedCertifications',
];

function errorText(error: unknown) { return error instanceof Error ? error.message : '操作未完成，请重试'; }
function isForbidden(error: unknown) {
  return error instanceof ApiError && (error.status === 403 || ['INQUIRY_ROLE_REQUIRED', 'ROLE_REQUIRED', 'SESSION_REQUIRED'].includes(error.code || ''));
}
function isConflict(error: unknown) {
  return error instanceof ApiError && error.status === 409;
}
function notEligible(error: unknown) { return error instanceof ApiError && error.code === 'INQUIRY_NOT_ELIGIBLE'; }
function errorRejections(error: unknown): RejectionRow[] {
  if (!(error instanceof ApiError) || !error.detail || typeof error.detail !== 'object') return [];
  const detail = error.detail as { rejected?: unknown; error?: { rejected?: unknown } };
  const rows = [detail.rejected, detail.error?.rejected].find(Array.isArray);
  return Array.isArray(rows) ? rows as RejectionRow[] : [];
}
function formatDay(value: string | null | undefined) {
  if (!value) return '日期未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '日期未知';
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
function reasonLabel(reason: string, staleDays: number) {
  if (reason === 'IDENTITY_UNCONFIRMED') return '公司身份未确认';
  if (reason === 'IDENTITY_CONFLICT') return '公司身份信息存在冲突';
  if (reason === 'LAST_CONTACT_UNKNOWN') return '最近联系时间未知';
  if (reason === 'STALE_FOLLOW_UP') return `超过 ${staleDays} 天未跟进`;
  if (reason === 'RECENT_CONTACT') return '最近联系过，暂未到跟进阈值';
  const statusReason = /^STATUS_(.+)$/u.exec(reason);
  if (statusReason) {
    const label = LEAD_STATUS_LABELS[statusReason[1].toLowerCase()];
    return label ? `记录状态为${label}，暂停复联` : '当前记录状态不生成外发草稿';
  }
  return `其他判定依据（${reason}）`;
}
function missingLabel(missing: string) { return MISSING_LABELS[missing] || `缺少：${missing}`; }
function evidenceKindLabel(kind: string) { return EVIDENCE_KIND_LABELS[kind] || kind; }
function quantityText(card: RecoveryCard) {
  if (card.request.quantity === null || card.request.quantity === undefined) return '数量未提供';
  return `${card.request.quantity}${card.request.unit ? ` ${card.request.unit}` : ''}`;
}

/** Bottom sheet shared by import, identity review and the unsent draft result. */
function RecoverySheet({ title, eyebrow, busy = false, onClose, children }: { title: string; eyebrow: string; busy?: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (!busyRef.current) closeRef.current(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus(); };
  }, []);
  return (
    <div className="ir-sheet-layer">
      <button type="button" className="ir-sheet-backdrop" aria-label={`关闭${title}`} onClick={() => { if (!busy) onClose(); }} />
      <section className="ir-sheet" role="dialog" aria-modal="true" aria-labelledby="ir-sheet-title" tabIndex={-1} ref={ref}>
        <div className="ir-sheet-handle" />
        <header className="ir-sheet-header">
          <div><span className="ir-eyebrow">{eyebrow}</span><h2 id="ir-sheet-title">{title}</h2></div>
          <button type="button" className="ir-sheet-close" aria-label="关闭" onClick={onClose} disabled={busy}><Icon name="close" size={18} /></button>
        </header>
        <div className="ir-sheet-scroll">{children}</div>
      </section>
    </div>
  );
}

function RejectionTable({ rows }: { rows: RejectionRow[] }) {
  return (
    <table className="ir-rejections">
      <caption>未通过校验、未导入的行</caption>
      <thead><tr><th scope="col">行</th><th scope="col">错误码</th><th scope="col">说明</th></tr></thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.row ?? index}-${row.code ?? ''}`}>
            <td>{row.row ?? '—'}</td>
            <td><code>{row.code || 'INQUIRY_ROW_INVALID'}</code></td>
            <td>{row.message || '该行未通过服务端校验。'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function InquiryRecovery({ role }: { role: RecoveryRole }) {
  const viewer = role === 'viewer';
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [opportunities, setOpportunities] = useState<RecoveryOpportunities | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [importText, setImportText] = useState('');
  const [importPending, setImportPending] = useState(false);
  const [importResult, setImportResult] = useState<RecoveryImport | null>(null);
  const [importRejections, setImportRejections] = useState<RejectionRow[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [identityPending, setIdentityPending] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [identityBasis, setIdentityBasis] = useState<number | null>(null);
  const [identityUrl, setIdentityUrl] = useState('');
  const loadSequence = useRef(0);

  const load = useCallback(async (quiet = false) => {
    const sequence = ++loadSequence.current;
    if (!quiet) setLoading(true);
    const [statusResult, listResult] = await Promise.allSettled([
      api<RecoveryStatus>('/inquiry-recovery/status'),
      api<RecoveryOpportunities>('/inquiry-recovery/opportunities'),
    ]);
    if (sequence !== loadSequence.current) return;
    if (listResult.status === 'fulfilled') {
      setOpportunities(listResult.value);
      setLoadError(null);
    } else if (isForbidden(listResult.reason)) {
      setForbidden(true);
      setLoadError(null);
    } else {
      setLoadError(errorText(listResult.reason));
    }
    if (statusResult.status === 'fulfilled') setStatus(statusResult.value);
    else if (isForbidden(statusResult.reason)) setForbidden(true);
    if (!quiet) setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const readOnly = viewer || forbidden;
  const busy = selectingId !== null || identityPending || importPending;

  async function reloadQuiet() { await load(true); }

  /** Re-read the list after a 409 so the next decision is based on current data. */
  async function readLatest(leadId: string) {
    try {
      const refreshed = await api<RecoveryOpportunities>('/inquiry-recovery/opportunities');
      setOpportunities(refreshed);
      return refreshed.cards.find(item => item.leadId === leadId);
    } catch {
      return undefined;
    }
  }

  function openImport() {
    if (readOnly) { setNotice({ text: '当前账号只有读取权限，不能导入历史询盘。', error: true }); return; }
    setImportText('');
    setImportResult(null);
    setImportRejections([]);
    setImportError(null);
    setSheet({ kind: 'import' });
  }

  function openIdentity(card: RecoveryCard) {
    if (readOnly) { setNotice({ text: '当前账号只有读取权限，不能核对询盘身份。', error: true }); return; }
    setIdentityBasis(null);
    setIdentityUrl('');
    setIdentityError(null);
    setSheet({ kind: 'identity', card });
  }

  async function submitIdentity(event?: FormEvent) {
    event?.preventDefault();
    if (sheet?.kind !== 'identity' || identityPending || readOnly) return;
    const card = sheet.card;
    if (identityBasis === null) { setIdentityError('请至少选择一条逐字证据作为人工依据。'); return; }
    const evidence = card.evidence[identityBasis];
    if (!evidence) { setIdentityError('选中的证据已不可用，请重新打开卡片。'); return; }
    const url = identityUrl.trim();
    if (url && !/^https?:\/\/\S+$/u.test(url)) { setIdentityError('公司官网必须是 http(s) 开头的完整地址。'); return; }
    setIdentityPending(true);
    setIdentityError(null);
    try {
      await api(`/inquiry-recovery/leads/${encodeURIComponent(card.leadId)}/identity`, 'POST', {
        requestId: requestId(),
        sourceHash: card.sourceHash,
        status: 'confirmed',
        basis: [{ sourceId: card.sourceId, quote: evidence.quote, ...(url ? { officialUrl: url } : {}) }],
      });
      setSheet(null);
      setNotice({ text: '公司身份已记录人工依据，列表已刷新。', error: false });
      await reloadQuiet();
    } catch (error) {
      if (isForbidden(error)) {
        setForbidden(true);
        setIdentityError('当前账号没有核对身份的权限（只读）。');
      } else if (isConflict(error)) {
        setSheet(null);
        setNotice({ text: '该询盘已被更新，已为你刷新最新证据；请重新打开卡片核对后再确认身份。', error: true });
        await reloadQuiet();
      } else {
        setIdentityError(errorText(error));
      }
    } finally {
      setIdentityPending(false);
    }
  }

  async function selectCard(card: RecoveryCard) {
    if (readOnly || selectingId !== null || !opportunities) return;
    setSelectingId(card.leadId);
    setNotice(null);
    try {
      const selection = await api<RecoverySelection>(`/inquiry-recovery/leads/${encodeURIComponent(card.leadId)}/select`, 'POST', {
        requestId: requestId(),
        expectedRevision: card.revision,
        sourceHash: card.sourceHash,
        asOf: opportunities.asOf.slice(0, 10),
      });
      setSheet({ kind: 'draft', selection });
    } catch (error) {
      if (isForbidden(error)) {
        setForbidden(true);
        setNotice({ text: '当前账号没有生成复联草稿的权限（只读）。', error: true });
      } else if (notEligible(error)) {
        const latest = await readLatest(card.leadId);
        setNotice({ text: `该询盘当前不符合生成复联草稿的条件${latest ? `（当前判定：${DECISION_LABELS[latest.decision]}）` : ''}，已刷新最新判定。`, error: true });
      } else if (isConflict(error)) {
        setNotice({ text: '该询盘已在别处更新，已为你刷新最新版本；请重新核对卡片后再操作。', error: true });
        await reloadQuiet();
      } else {
        setNotice({ text: errorText(error), error: true });
      }
    } finally {
      setSelectingId(null);
    }
  }

  async function submitImport(event?: FormEvent) {
    event?.preventDefault();
    if (importPending || readOnly) return;
    const bytes = new TextEncoder().encode(importText).length;
    if (!importText.trim()) { setImportError('请先粘贴 CSV 内容。'); return; }
    if (bytes > MAX_IMPORT_BYTES) { setImportError('CSV 超过 64 KiB 上限，请拆分后再导入。'); return; }
    setImportPending(true);
    setImportError(null);
    setImportRejections([]);
    try {
      const result = await api<RecoveryImport>('/inquiry-recovery/import', 'POST', {
        format: 'csv',
        requestId: requestId(),
        content: importText,
      });
      setImportResult(result);
      setImportText('');
      if (result.rejected.length) setImportRejections(result.rejected as RejectionRow[]);
      setNotice({ text: `导入完成：接受 ${result.accepted} 行，插入 ${result.inserted} · 更新 ${result.updated} · 重复 ${result.duplicate} · 冲突 ${result.conflict}。`, error: false });
      await reloadQuiet();
    } catch (error) {
      const rejections = errorRejections(error);
      if (isForbidden(error)) {
        setForbidden(true);
        setImportError('当前账号没有导入权限（只读）。');
      } else if (rejections.length) {
        setImportRejections(rejections);
        setImportError('所有行都未通过校验，未导入任何数据。逐行原因见下表。');
      } else {
        setImportError(errorText(error));
      }
    } finally {
      setImportPending(false);
    }
  }

  const importBytes = new TextEncoder().encode(importText).length;
  const importTooLarge = importBytes > MAX_IMPORT_BYTES;
  const importCanSubmit = !readOnly && !importPending && importText.trim().length > 0 && !importTooLarge;
  const staleDays = opportunities?.staleDays ?? status?.staleDays ?? 7;

  return (
    <section className="inquiry-recovery" data-testid="inquiry-recovery" aria-busy={loading || busy} aria-label="历史询盘捞回">
      <header className="ir-head">
        <div className="ir-head-copy">
          <span className="ir-eyebrow">HISTORICAL INQUIRY RECOVERY</span>
          <h1>询盘捞回</h1>
          <p>只使用已经授权的历史询盘与逐字证据：先核实身份、补齐缺失信息，再把值得跟进的询盘变成未发送的人工审核草稿。</p>
        </div>
        <div className="ir-head-actions">
          <button type="button" className="ir-primary ir-import-open" onClick={openImport} disabled={readOnly || busy}>导入历史询盘</button>
          <button type="button" className="ir-secondary" onClick={() => void load()} disabled={loading}>刷新</button>
        </div>
      </header>

      {status && (
        <div className="ir-meta">
          <span>评估基准日 {formatDay(opportunities?.asOf || status.asOf)}</span>
          <span>跟进阈值 {staleDays} 天</span>
          <span>已导入 {status.counts.imports} 批 · 线索 {status.counts.leads} 条</span>
          {status.lastImport && (
            <span>最近导入：{status.lastImport.sourceName}（插入 {status.lastImport.inserted} · 更新 {status.lastImport.updated} · 重复 {status.lastImport.duplicate} · 冲突 {status.lastImport.conflict}）</span>
          )}
        </div>
      )}

      {readOnly && (
        <p className="ir-readonly" role="status">
          <Icon name="lock" size={16} />
          当前账号为只读权限：可以查看询盘卡片，但不能导入历史数据、核对身份或生成复联草稿。
        </p>
      )}

      <div className="ir-live" role={notice?.error ? 'alert' : 'status'} aria-live={notice?.error ? 'assertive' : 'polite'}>{notice?.text || ''}</div>

      {loading ? (
        <div className="ir-skeleton" role="status" aria-label="正在读取历史询盘">
          <p className="ir-skeleton-label">正在读取已授权的历史询盘…</p>
          {[0, 1, 2].map(index => (
            <div className="ir-skeleton-card" key={index} aria-hidden="true">
              <span className="ir-skeleton-line wide" /><span className="ir-skeleton-line" /><span className="ir-skeleton-line short" />
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="ir-error" role="alert">
          <strong>历史询盘暂时无法读取</strong>
          <p>{loadError}</p>
          <button type="button" className="ir-secondary" onClick={() => void load()}>重试</button>
        </div>
      ) : !opportunities || opportunities.cards.length === 0 ? (
        <div className="ir-empty">
          <span className="ir-empty-icon"><Icon name="route" size={26} /></span>
          <strong>还没有导入任何历史询盘</strong>
          <p>这里只显示真实导入的数据。粘贴已经授权的历史询盘 CSV 后，会按证据给出待跟进、待补证、培育中与暂停的卡片；不会生成示例数据。</p>
          <button type="button" className="ir-primary" onClick={openImport} disabled={readOnly || busy}>导入历史询盘</button>
        </div>
      ) : (
        <>
          <ul className="ir-chips" aria-label="询盘状态汇总">
            {(['follow_up', 'need_evidence', 'nurture', 'hold'] as const).map(decision => (
              <li key={decision} className={`ir-chip ir-chip-${decision}`}>
                <span>{DECISION_LABELS[decision]}</span>
                <strong>{opportunities.summary[decision]}</strong>
              </li>
            ))}
          </ul>

          <div className="ir-cards">
            {opportunities.cards.map(card => (
              <article className="ir-card" key={card.leadId} data-decision={card.decision} data-lead-id={card.leadId}>
                <header className="ir-card-head">
                  <div className="ir-card-title">
                    <h2>{card.company.name || '公司名称未提供'}</h2>
                    <p className="ir-card-sub">
                      <span>来源 {card.sourceId}</span>
                      <span>版本 {card.revision}</span>
                      <span>记录状态 {LEAD_STATUS_LABELS[card.status] || card.status}</span>
                    </p>
                  </div>
                  <span className={`ir-badge ir-badge-${card.decision}`}>{DECISION_LABELS[card.decision]}</span>
                </header>

                <dl className="ir-facts">
                  <div><dt>需求</dt><dd>{card.request.product || '产品未提供'}</dd></div>
                  <div><dt>数量</dt><dd>{quantityText(card)}</dd></div>
                  <div><dt>目的地</dt><dd>{card.request.destination || '未提供'}</dd></div>
                  <div><dt>最近联系</dt><dd>{formatDay(card.lastContactAt)}{card.daysStale === null ? ' · 天数未知' : ` · 已 ${card.daysStale} 天`}</dd></div>
                  <div><dt>公司身份</dt><dd>{card.identity.status === 'confirmed' ? '已由人工确认' : card.identity.status === 'conflicting' ? '存在冲突，待核对' : '未确认'}</dd></div>
                  {(card.company.email || card.company.contact) && (
                    <div><dt>联系资料</dt><dd>{[card.company.contact, card.company.email].filter(Boolean).join(' · ')}</dd></div>
                  )}
                  {card.company.url && <div><dt>公司网址</dt><dd className="ir-break">{card.company.url}</dd></div>}
                </dl>

                {card.dateUnknown.length > 0 && (
                  <p className="ir-date-unknown">日期信息不完整：{card.dateUnknown.map(key => DATE_UNKNOWN_LABELS[key] || key).join('、')} 未提供，判定时按未知处理。</p>
                )}

                <section className="ir-section">
                  <h3>为什么这样判定</h3>
                  <ul className="ir-reasons">
                    {card.reasons.length ? card.reasons.map(reason => <li key={reason}>{reasonLabel(reason, staleDays)}</li>) : <li>服务端未提供额外原因。</li>}
                  </ul>
                  {card.missing.length > 0 && (
                    <p className="ir-missing"><strong>缺失信息：</strong>{card.missing.map(missingLabel).join('；')}</p>
                  )}
                </section>

                <section className="ir-section">
                  <h3>逐字证据</h3>
                  {card.evidence.length ? (
                    <ul className="ir-evidence-list">
                      {card.evidence.map((evidence, index) => (
                        <li className="ir-evidence" key={`${evidence.sourceMessageId}-${index}`}>
                          <p className="ir-quote">“{evidence.quote}”</p>
                          <p className="ir-evidence-meta">
                            <span>{evidenceKindLabel(evidence.kind)}</span>
                            <span>来源消息 {evidence.sourceMessageId}</span>
                            <span>{formatDay(evidence.occurredAt)}</span>
                            <span className="ir-independent">独立核实：{evidence.independentlyVerified ? '是' : '否'}</span>
                          </p>
                          {evidence.note && <p className="ir-evidence-note">{evidence.note}</p>}
                        </li>
                      ))}
                    </ul>
                  ) : <p className="ir-section-empty">该询盘没有可引用的逐字证据，不能据此生成外发内容。</p>}
                </section>

                <section className="ir-next-step">
                  <h3>下一步</h3>
                  <p className="ir-next-action">{card.nextStep.action}</p>
                  <p><strong>为什么：</strong>{card.nextStep.why}</p>
                  <p className="ir-risk"><strong>风险：</strong>{card.nextStep.risk}</p>
                </section>

                <div className="ir-actions">
                  {card.decision === 'follow_up' && (
                    <button type="button" className="ir-primary" onClick={() => void selectCard(card)} disabled={readOnly || busy}>
                      {selectingId === card.leadId ? '正在生成草稿…' : '生成复联草稿'}
                    </button>
                  )}
                  {card.decision === 'need_evidence' && card.identity.status !== 'confirmed' && (
                    <button type="button" className="ir-secondary" onClick={() => openIdentity(card)} disabled={readOnly || busy}>核对公司身份</button>
                  )}
                  {readOnly && <span className="ir-action-hint">只读账号不能执行该操作。</span>}
                  {!readOnly && card.decision === 'hold' && <span className="ir-action-hint">已暂停：不生成外发草稿，客户重新主动联系后再评估。</span>}
                  {!readOnly && card.decision === 'nurture' && <span className="ir-action-hint">未到跟进阈值，到期后会重新给出判定。</span>}
                  {!readOnly && card.decision === 'need_evidence' && card.identity.status === 'confirmed' && <span className="ir-action-hint">补齐上方缺失信息并重新导入后，系统会重新判定。</span>}
                  {!readOnly && card.decision === 'need_evidence' && card.identity.status !== 'confirmed' && !card.evidence.length && <span className="ir-action-hint">没有逐字证据，无法核对身份。</span>}
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {sheet?.kind === 'import' && (
        <RecoverySheet title="导入历史询盘" eyebrow="PASTE CSV" busy={importPending} onClose={() => { if (!importPending) setSheet(null); }}>
          <form onSubmit={submitImport}>
            <p className="ir-sheet-lead">粘贴已授权的真实历史询盘 CSV。本页不会补造缺失数据，也不会发送任何消息；导入后仅用于证据核对与未发送草稿。</p>
            <div className="ir-columns">
              <p><strong>必填列：</strong><code>leadId, sourceId, revision</code></p>
              <p><strong>常用可选列：</strong><code>companyName, companyUrl, contactEmail, customerName, productId, product, quantity, unit, destination, lastContactAt, status</code></p>
              <p><strong>证据列：</strong><code>history, facts</code>（CSV 单元格内填 JSON 数组；facts 的 quote 必须出现在对应 history 的正文里）</p>
              <p><strong>全部分列：</strong><code>{COLUMN_HELP.join(', ')}</code></p>
            </div>
            <label className="ir-field">
              <span>CSV 内容</span>
              <textarea
                aria-label="粘贴 CSV 内容"
                value={importText}
                onChange={event => { setImportText(event.target.value); setImportError(null); setImportRejections([]); }}
                spellCheck={false}
                rows={9}
                placeholder={'leadId,sourceId,revision,companyName,companyUrl,contactEmail,customerName,productId,product,quantity,unit,destination,lastContactAt,status,history,facts\n...'}
              />
            </label>
            <p className={`ir-size${importTooLarge ? ' over' : ''}`}>{importBytes} / 65536 字节{importTooLarge ? ' · 超过 64 KiB 上限，请拆分后再导入' : ''}</p>
            {importError && <p className="ir-error-inline" role="alert">{importError}</p>}
            {importRejections.length > 0 && <RejectionTable rows={importRejections} />}
            {importResult && (
              <div className="ir-import-result" role="status">
                <strong>导入完成</strong>
                <p>{importResult.sourceName} · 总行数 {importResult.rows} · 接受 {importResult.accepted}</p>
                <p>插入 {importResult.inserted} · 更新 {importResult.updated} · 重复 {importResult.duplicate} · 冲突 {importResult.conflict}</p>
                <p className="ir-hash">SHA256 <code>{importResult.inputSha256}</code></p>
              </div>
            )}
            <div className="ir-sheet-footer">
              {importResult ? (
                <button type="button" className="ir-primary" onClick={() => setSheet(null)}>完成</button>
              ) : (
                <>
                  <button type="button" className="ir-secondary" onClick={() => setSheet(null)} disabled={importPending}>取消</button>
                  <button type="submit" className="ir-primary" disabled={!importCanSubmit}>{importPending ? '正在导入…' : '导入 CSV'}</button>
                </>
              )}
            </div>
          </form>
        </RecoverySheet>
      )}

      {sheet?.kind === 'identity' && (
        <RecoverySheet title="核对公司身份" eyebrow="IDENTITY REVIEW" busy={identityPending} onClose={() => { if (!identityPending) setSheet(null); }}>
          <form onSubmit={submitIdentity}>
            <p className="ir-sheet-lead">
              核对 <strong>{sheet.card.company.name || sheet.card.leadId}</strong>（来源 {sheet.card.sourceId} · 版本 {sheet.card.revision}）是否为公司主体。
              确认后只会记录你选择的一条逐字证据，不会自动联系客户，也不会改变历史记录本身。
            </p>
            <fieldset className="ir-basis">
              <legend>人工依据（至少选择一条逐字证据）</legend>
              {sheet.card.evidence.length ? sheet.card.evidence.map((evidence, index) => (
                <label className={`ir-basis-option${identityBasis === index ? ' selected' : ''}`} key={`${evidence.sourceMessageId}-${index}`}>
                  <input
                    type="radio"
                    name="identity-basis"
                    value={index}
                    checked={identityBasis === index}
                    onChange={() => { setIdentityBasis(index); setIdentityError(null); }}
                    disabled={identityPending}
                  />
                  <span>
                    <span className="ir-quote">“{evidence.quote}”</span>
                    <span className="ir-evidence-meta">{evidenceKindLabel(evidence.kind)} · 来源消息 {evidence.sourceMessageId} · {formatDay(evidence.occurredAt)}</span>
                  </span>
                </label>
              )) : <p className="ir-section-empty">该询盘没有逐字证据，无法确认身份。</p>}
            </fieldset>
            <label className="ir-field">
              <span>公司官网（可选，需 http(s) 地址）</span>
              <input aria-label="公司官网" value={identityUrl} onChange={event => { setIdentityUrl(event.target.value); setIdentityError(null); }} placeholder="https://example.com" disabled={identityPending} />
            </label>
            {identityError && <p className="ir-error-inline" role="alert">{identityError}</p>}
            <div className="ir-sheet-footer">
              <button type="button" className="ir-secondary" onClick={() => setSheet(null)} disabled={identityPending}>取消</button>
              <button type="submit" className="ir-primary" disabled={identityPending || identityBasis === null}>{identityPending ? '正在记录…' : '确认身份'}</button>
            </div>
          </form>
        </RecoverySheet>
      )}

      {sheet?.kind === 'draft' && (
        <RecoverySheet
          title="复联草稿预览"
          eyebrow={`UNSENT DRAFT · ${sheet.selection.leadId}`}
          onClose={() => {
            setSheet(null);
            setNotice({ text: '草稿已保存为未发送状态，未做任何外部联系。', error: false });
          }}
        >
          <div className="ir-unsent" role="status">
            <Icon name="warning" size={18} />
            <div><strong>未发送 · 需人工审核</strong><span>本页只生成可审核草稿。发送、报价与任何对外承诺都必须另行人工审批。</span></div>
          </div>
          <dl className="ir-draft-meta">
            <div><dt>文件名</dt><dd>{sheet.selection.draft.filename}</dd></div>
            <div><dt>SHA256</dt><dd className="ir-hash"><code>{sheet.selection.draft.sha256}</code></dd></div>
            <div><dt>人工审核</dt><dd>{sheet.selection.draft.humanReviewRequired ? '必需' : '未标记'}</dd></div>
          </dl>
          <pre className="ir-draft-content" aria-label="复联草稿正文">{sheet.selection.draft.content}</pre>
          <section className="ir-goal-draft">
            <h3>Goal 草稿</h3>
            <p className="ir-goal-state"><strong>未启用</strong> · <strong>未写入</strong> Runtime</p>
            <dl>
              <div><dt>标题</dt><dd>{sheet.selection.goalDraft.title}</dd></div>
              <div><dt>描述</dt><dd>{sheet.selection.goalDraft.description}</dd></div>
              <div><dt>最大步数</dt><dd>{sheet.selection.goalDraft.maxSteps}</dd></div>
              <div><dt>权限说明</dt><dd>{sheet.selection.goalDraft.authorityRequired}</dd></div>
            </dl>
          </section>
          <div className="ir-sheet-footer">
            <button type="button" className="ir-primary" onClick={() => { setSheet(null); setNotice({ text: '草稿已保存为未发送状态，未做任何外部联系。', error: false }); }}>关闭</button>
          </div>
        </RecoverySheet>
      )}
    </section>
  );
}
