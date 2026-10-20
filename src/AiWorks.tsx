import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiError, requestId } from './api';
import { Icon } from './icons';
import './ai-works.css';

export type AiWorkField = {
  name: string;
  label: string;
  type: 'string' | 'integer' | 'product_ref';
  required: boolean;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  default?: string | number;
  description?: string;
};

type AiWorkStep = { id: string; title: string; owner: 'agent' | 'human'; output: string };

export type AiWorkProduct = {
  id: string;
  revision: number;
  status: 'published' | 'retired';
  playbook: string;
  name: string;
  nameEn?: string;
  summary: string;
  category: string;
  contentHash: string;
  inputSchema: { fields: AiWorkField[] };
  workflow: AiWorkStep[];
  deliverables: string[];
  acceptance: string[];
  publishedAt?: string | null;
};

export type LibraryProduct = {
  id: string;
  revision: number;
  name: string;
  category: string;
  description: string;
  status: string;
  skus: Array<{ code: string; unit?: string; moq?: number | null }>;
  supply?: Record<string, string>;
};

type AiWorksCatalog = {
  products: AiWorkProduct[];
  status: {
    version: number;
    products: number;
    publishedProducts: number;
    productIds: string[];
    delegations: number;
    draftDelegations: number;
    approvedDelegations: number;
    cancelledDelegations: number;
    productLibraryAvailable: boolean;
    firstProduct: { id: string; revision: number } | null;
  };
};

export type PlanProductFacts = {
  productId: string;
  revision: number;
  sha256: string;
  name: string;
  category: string;
  description: string;
  skus: Array<{ code: string; unit: string; specs: Array<{ key: string; value: string }>; moq: number | null; leadTimeDays: number | null; pricingMode: string }>;
  supply: Record<string, string>;
  documents: number;
  images: number;
  sourceKind: string;
  missingFields: string[];
  factCompleteness: 'complete' | 'partial' | 'incomplete';
};

export type DevelopmentPlan = {
  schema: string;
  generator: string;
  generatedAt: string;
  aiWork: { id: string; revision: number; contentHash: string };
  productFacts: PlanProductFacts | null;
  objective: string;
  market: {
    country: { code: string | null; nameZh: string; nameEn: string; known: boolean };
    language: { code: string; label: string };
    currency: string | null;
    region: string;
    coldEmailPolicy: 'allowed' | 'notice_and_objection' | 'consent_required';
    coldEmailNote: string;
  };
  buyerProfile: { type: string; typeEn: string; known: boolean; definition: string; decisionRoles: string[]; buyingSignals: string[]; disqualifiers: string[]; languageHint: string };
  discovery: {
    targetCount: number;
    probeCount: number;
    queries: Array<{ purpose: string; query: string; source: string; language?: string }>;
    sources: Array<{ id: string; label: string; availability: string; note: string }>;
    dedupeKeys: string[];
    qualityGates: string[];
  };
  workflow: Array<AiWorkStep & { dueInDays: number; status: string }>;
  deliverables: Array<{ name: string; dueInDays: number; status: string }>;
  acceptance: string[];
  approvalGates: string[];
  requiredSignals: string[];
  risks: string[];
  openQuestions: string[];
  notes: string[];
  sla: { deadlineAt: string; deadlineDays: number; firstBatchDays: number; reportCadence: string };
  budgetCredits: number;
};

export type AiWorkDelegation = {
  id: string;
  requestId: string;
  productId: string;
  productRevision: number;
  productHash: string;
  productRefs: Array<{ field: string; productId: string; revision: number; sha256: string }>;
  input: Record<string, unknown> & { targetCountry: string; buyerType: string; targetCount: number; deadlineDays: number };
  plan: DevelopmentPlan;
  planHash: string;
  status: 'draft' | 'approved' | 'cancelled';
  execution: {
    status: 'not_started' | 'awaiting_source' | 'completed' | 'failed';
    startedAt: string | null;
    finishedAt: string | null;
    sources: string[];
    importIds: string[];
    counts: { importBatches: number; imported: number; duplicates: number; rejectedRows: number; candidates: number; needsReview: number; qualified: number; rejected: number };
    lastError: { code?: string; message?: string; at?: string } | null;
    lastExecuteRequestId: string | null;
    workerOrderId: string | null;
    reason: string;
  };
  createdAt: string;
  updatedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  artifactId: string | null;
  artifactSha256: string | null;
};

export type AiWorkerCandidate = {
  id: string;
  delegationId: string;
  companyName: string;
  website: string;
  websiteDomain: string;
  country: string;
  buyerType: string;
  contact: { name: string; title: string; email: string };
  notes: string;
  evidence: Array<{ kind: string; sourceUrl: string; excerpt: string; fetchedAt: string | null }>;
  fitScore: number;
  fitReasons: string[];
  missingFields: string[];
  status: 'needs_review' | 'qualified' | 'rejected';
  review: { requestId: string; decision: string; reason: string; reviewer: string; at: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type AiWorkDraft = {
  id: string;
  delegationId: string;
  candidateId: string;
  revision: number;
  language: string;
  subject: string;
  body: string;
  contentHash?: string;
  evidenceRefs: Array<{ sourceUrl: string; excerpt: string; fetchedAt: string | null }>;
  productFacts: { name: string; category: string; revision: number; sha256: string };
  compliance: { coldEmailPolicy: string; consentRequired: boolean; optOutRequired: boolean; humanReviewRequired: boolean; sent: boolean; externalSend: string; note: string };
  warnings: string[];
  status: 'draft' | 'approved' | 'rejected';
  sent: boolean;
  sentAt?: string | null;
  sendReceipt?: { provider: string; messageId: string; to: string; at: string; consentBasis: string | null } | null;
  sendAttempts?: Array<{ requestId: string; at: string; outcome: 'sent' | 'failed'; provider?: string; error?: string }>;
  lastSendError?: { code: string; message: string; at: string } | null;
  humanReviewRequired: boolean;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OutreachReadiness = { configured: boolean; provider: string | null; providerLabel: string | null; fromEmail: string | null; status: string; dualApproval: boolean; note: string };
export type OutreachStats = { sent: number; attempts: number; failedAttempts: number; suppressions: number; providers: Record<string, number>; lastError: { message: string; at: string } | null };
export type FailedDraft = { draftId: string; delegationId: string; candidateId: string; companyName: string; provider: string | null; error: string; at: string };
export type AiWorkEvent = { id: string; type: string; at: string; actor: string | null; delegationId?: string; draftId?: string; candidateId?: string; [key: string]: unknown };

export type AiWorkSource = { id: string; label: string; kind: string; implemented: boolean; configured: boolean; status: string; note: string };

type ReadinessCheck = { id: string; label: string; status: string; detail?: string };
type ProductReadiness = { overall: string; productRevision: number; checks: ReadinessCheck[] };
type PublishField = { name: string; label: string; type: 'string' | 'integer' | 'product_ref'; required: boolean; description: string };
type PublishStep = { id: string; title: string; owner: 'agent' | 'human'; output: string };
type PublishForm = {
  id: string; name: string; nameEn: string; summary: string; category: string;
  playbook: 'lead-discovery'; expectedRevision: string;
  fields: PublishField[]; steps: PublishStep[]; deliverables: string; acceptance: string;
};

export type AiWorksRole = 'admin' | 'operator' | 'viewer';

const DELEGATION_STATUS: Record<string, string> = { draft: '待审批', approved: '已批准', cancelled: '已取消' };
const EXECUTION_STATUS: Record<string, string> = { not_started: '未开始', awaiting_source: '等待数据源', completed: '已完成', failed: '失败' };
const CANDIDATE_STATUS: Record<string, string> = { needs_review: '待审核', qualified: '已合格', rejected: '已剔除' };
const EVENT_FILTERS: Record<string, string[]> = {
  review: ['delegation_approved', 'delegation_cancelled', 'candidate_reviewed', 'draft_approved', 'draft_rejected'],
  execution: ['candidates_imported', 'execution_completed', 'execution_awaiting_source'],
  outreach: ['draft_created', 'draft_updated', 'outreach_sent', 'outreach_failed', 'suppression_added', 'suppression_removed'],
};
const DRAFT_STATUS: Record<string, string> = { draft: '待审批', approved: '已批准（未发送）', rejected: '已拒绝' };
const SOURCE_STATUS: Record<string, string> = { available: '可用', unconfigured: '未配置', not_implemented: '执行器未接入' };
const READINESS_LABELS: Record<string, string> = { ready_for_review: '可送审', needs_review: '需人工核对', incomplete: '缺项待补' };
const EMPTY_PUBLISH_FORM = (): PublishForm => ({
  id: '', name: '', nameEn: '', summary: '', category: '线索发现', playbook: 'lead-discovery', expectedRevision: '',
  fields: [{ name: 'productId', label: '产品库产品', type: 'product_ref', required: true, description: '选择企业产品库中的产品，委托会钉住 revision 与 SHA-256' },
    { name: 'targetCountry', label: '目标国家', type: 'string', required: true, description: '如：美国、德国' },
    { name: 'buyerType', label: '采购客户类型', type: 'string', required: true, description: '如：进口商、分销商' }],
  steps: [{ id: 'intake', title: '受理与输入校验', owner: 'human', output: '开发计划委托' }],
  deliverables: '开发计划书\n候选买家清单\n周报', acceptance: '每条线索必须能打开公开来源\n禁止编造联系人、认证、价格',
});
const COMPLETENESS: Record<string, string> = { complete: '完整', partial: '部分缺失', incomplete: '缺项较多' };
const BUYER_TYPES = ['进口商', '分销商', '经销商', '批发商', '连锁零售', '品牌商', '电商卖家', '工程承包商', 'OEM/ODM 采购', '贸易公司'];
const COUNTRY_SUGGESTIONS = ['美国', '英国', '德国', '法国', '意大利', '西班牙', '荷兰', '波兰', '瑞典', '加拿大', '墨西哥', '巴西', '澳大利亚', '日本', '韩国', '印度', '越南', '泰国', '马来西亚', '新加坡', '阿联酋', '沙特阿拉伯', '土耳其', '南非'];
const SUPPLY_LABELS: Record<string, string> = { packaging: '包装', samplePolicy: '样品政策', paymentTerms: '付款条款', shippingTerms: '运输条款', capacityNote: '产能说明' };

function errorText(error: unknown) {
  if (error instanceof ApiError) return `${error.message}${error.code ? `（${error.code}）` : ''}`;
  return error instanceof Error ? error.message : '操作未完成，请重试';
}
function shortHash(value: string | null | undefined) { return value ? `${value.slice(0, 12)}…` : '—'; }
function formatDay(value: string) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }) : value; }

export function AiWorks({ role, onOpenLibrary }: { role: AiWorksRole; onOpenLibrary?: () => void }) {
  const readOnly = role === 'viewer';
  const isAdmin = role === 'admin';
  const [catalog, setCatalog] = useState<AiWorksCatalog | null>(null);
  const [products, setProducts] = useState<LibraryProduct[]>([]);
  const [delegations, setDelegations] = useState<AiWorkDelegation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeId, setActiveId] = useState<string>('');
  const [candidates, setCandidates] = useState<AiWorkerCandidate[]>([]);
  const [drafts, setDrafts] = useState<AiWorkDraft[]>([]);
  const [events, setEvents] = useState<AiWorkEvent[]>([]);
  const [sources, setSources] = useState<AiWorkSource[]>([]);
  const [outreach, setOutreach] = useState<OutreachReadiness | null>(null);
  const [outreachStats, setOutreachStats] = useState<OutreachStats | null>(null);
  const [failedDrafts, setFailedDrafts] = useState<FailedDraft[]>([]);
  const [draftEdit, setDraftEdit] = useState<{ id: string; subject: string; body: string } | null>(null);
  const [sendDraft, setSendDraft] = useState<{ id: string; consentConfirmed: boolean; consentBasis: string } | null>(null);
  const [readiness, setReadiness] = useState<ProductReadiness | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishForm, setPublishForm] = useState<PublishForm>(EMPTY_PUBLISH_FORM);
  const [draftReject, setDraftReject] = useState<{ draftId: string; reason: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importFormat, setImportFormat] = useState<'csv' | 'json'>('csv');
  const [importContent, setImportContent] = useState('');
  const [executionBusy, setExecutionBusy] = useState(false);
  const [reviewDraft, setReviewDraft] = useState<{ id: string; decision: 'qualified' | 'rejected'; reason: string } | null>(null);
  const [form, setForm] = useState({ productId: '', targetCountry: '美国', buyerType: '进口商', productScope: '', targetCount: 50, deadlineDays: 30, notes: '' });

  const [workId, setWorkId] = useState('lead-discovery');
  const [delegationQuery, setDelegationQuery] = useState('');
  const [delegationStatus, setDelegationStatus] = useState('all');
  const aiWork = useMemo(() => catalog?.products.find(item => item.id === workId) || catalog?.products.find(item => item.id === 'lead-discovery') || catalog?.products[0], [catalog, workId]);
  const active = useMemo(() => delegations.find(item => item.id === activeId) || null, [delegations, activeId]);
  const visibleDelegations = useMemo(() => {
    const query = delegationQuery.trim().toLocaleLowerCase();
    return delegations.filter(item => {
      if (delegationStatus !== 'all' && item.status !== delegationStatus) return false;
      if (!query) return true;
      return [item.plan.productFacts?.name, item.plan.objective, item.input?.targetCountry, item.input?.buyerType, item.status].filter(Boolean).join(' ').toLocaleLowerCase().includes(query);
    });
  }, [delegations, delegationQuery, delegationStatus]);
  const activeProductId = active?.plan?.productFacts?.productId || '';

  useEffect(() => {
    let cancelled = false;
    if (!activeProductId) { setReadiness(null); return undefined; }
    api<{ readiness: ProductReadiness }>(`/library/products/${activeProductId}/readiness`)
      .then(result => { if (!cancelled) setReadiness(result.readiness); })
      .catch(() => { if (!cancelled) setReadiness(null); });
    return () => { cancelled = true; };
  }, [activeProductId, active?.updatedAt]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [catalogResult, library, delegationResult, sourceResult, outreachResult] = await Promise.all([
        api<AiWorksCatalog>('/ai-works'),
        api<{ items?: LibraryProduct[]; products?: LibraryProduct[] }>('/library/products'),
        api<{ delegations: AiWorkDelegation[] }>('/ai-work-delegations'),
        api<{ sources: AiWorkSource[] }>('/ai-work-sources'),
        api<{ outreach: OutreachReadiness; stats: OutreachStats; failedDrafts: FailedDraft[] }>('/ai-work-outreach'),
      ]);
      const libraryProducts = (library.items || library.products || []).filter(item => item.status !== 'archived');
      setCatalog(catalogResult);
      setProducts(libraryProducts);
      setWorkId(current => catalogResult.products.some(product => product.id === current) ? current : (catalogResult.products.find(product => product.id === 'lead-discovery')?.id || catalogResult.products[0]?.id || ''));
      setDelegations(delegationResult.delegations);
      setSources(sourceResult.sources);
      setOutreach(outreachResult.outreach);
      setOutreachStats(outreachResult.stats || null);
      setFailedDrafts(outreachResult.failedDrafts || []);
      setActiveId(current => current && delegationResult.delegations.some(item => item.id === current) ? current : (delegationResult.delegations[0]?.id || ''));
      setForm(current => ({
        ...current,
        productId: current.productId && libraryProducts.some(item => item.id === current.productId) ? current.productId : (libraryProducts[0]?.id || ''),
      }));
    } catch (error) {
      setLoadError(errorText(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const refreshCandidates = useCallback(async (delegationId: string) => {
    if (!delegationId) { setCandidates([]); setDrafts([]); setEvents([]); return; }
    try {
      const [candidateResult, draftResult, eventResult] = await Promise.all([
        api<{ candidates: AiWorkerCandidate[] }>(`/ai-work-delegations/${delegationId}/candidates`),
        api<{ drafts: AiWorkDraft[] }>(`/ai-work-delegations/${delegationId}/drafts`),
        api<{ events: AiWorkEvent[] }>(`/ai-work-delegations/${delegationId}/events`),
      ]);
      setCandidates(candidateResult.candidates);
      setDrafts(draftResult.drafts);
      setEvents(eventResult.events);
    } catch (error) {
      setCandidates([]);
      setDrafts([]);
      setEvents([]);
      setNotice({ text: errorText(error), error: true });
    }
  }, []);

  useEffect(() => { void refreshCandidates(active?.id || ''); setReviewDraft(null); setDraftReject(null); setImportOpen(false); }, [active?.id, refreshCandidates]);

  async function importCandidates() {
    if (!active || readOnly || executionBusy) return;
    if (!importContent.trim()) { setNotice({ text: '请粘贴客户授权的线索内容（CSV / JSON）。', error: true }); return; }
    setExecutionBusy(true);
    try {
      const result = await api<{ import: { imported: number; duplicates: number; rejected: Array<{ row: number; code: string; message: string }> }; delegation: AiWorkDelegation }>(`/ai-work-delegations/${active.id}/candidates`, 'POST', {
        requestId: requestId(), format: importFormat, content: importContent,
      });
      setNotice({ text: `导入完成：新增 ${result.import.imported} 条，重复 ${result.import.duplicates} 条，逐行拒绝 ${result.import.rejected.length} 行。` });
      setImportContent('');
      setImportOpen(false);
      await load();
      await refreshCandidates(active.id);
    } catch (error) {
      setNotice({ text: errorText(error), error: true });
    } finally {
      setExecutionBusy(false);
    }
  }

  async function executeDelegation() {
    if (!active || readOnly || executionBusy) return;
    setExecutionBusy(true);
    try {
      const result = await api<{ delegation: AiWorkDelegation; awaitingSource?: boolean }>(`/ai-work-delegations/${active.id}/execute`, 'POST', { requestId: requestId() });
      setNotice({
        text: result.awaitingSource
          ? '没有可执行的线索输入：请先导入客户授权线索，或在服务器配置 SERPER_API_KEY / COMPANIES_HOUSE_API_KEY 启用自动搜索；未配置前不会生成任何线索。'
          : `执行完成：${result.delegation.execution.counts.candidates} 条候选已进入待审核队列（自动搜索只提供来源与摘要，需人工确认产品匹配）。`,
        error: !!result.awaitingSource,
      });
      await load();
      await refreshCandidates(active.id);
    } catch (error) {
      setNotice({ text: errorText(error), error: true });
    } finally {
      setExecutionBusy(false);
    }
  }

  async function reviewCandidate(candidate: AiWorkerCandidate, decision: 'qualified' | 'rejected', reason: string) {
    if (!active || readOnly || executionBusy) return;
    if (reason.trim().length < 2) { setNotice({ text: '审核理由至少 2 个字符。', error: true }); return; }
    setExecutionBusy(true);
    try {
      await api(`/ai-work-candidates/${candidate.id}/review`, 'POST', { requestId: requestId(), decision, reason: reason.trim() });
      setNotice({ text: `${candidate.companyName} 已${decision === 'qualified' ? '合格' : '剔除'}。` });
      setReviewDraft(null);
      await load();
      await refreshCandidates(active.id);
    } catch (error) {
      setNotice({ text: errorText(error), error: true });
    } finally {
      setExecutionBusy(false);
    }
  }

  async function generateDraft(candidate: AiWorkerCandidate) {
    if (!active || readOnly || executionBusy) return;
    setExecutionBusy(true);
    try {
      await api(`/ai-work-candidates/${candidate.id}/drafts`, 'POST', { requestId: requestId() });
      setNotice({ text: `${candidate.companyName} 的开发信草稿已生成（未发送，需人工审批）。` });
      await refreshCandidates(active.id);
    } catch (error) {
      setNotice({ text: errorText(error), error: true });
    } finally {
      setExecutionBusy(false);
    }
  }

  async function approveDraftAction(draft: AiWorkDraft) {
    if (!active || !isAdmin || executionBusy) return;
    setExecutionBusy(true);
    try {
      await api(`/ai-work-drafts/${draft.id}/approve`, 'POST', { requestId: requestId(), confirmed: true });
      setNotice({ text: '草稿已批准，但未发送：外发通道尚未接入，仍需后续独立发送审批。' });
      await refreshCandidates(active.id);
    } catch (error) {
      setNotice({ text: errorText(error), error: true });
    } finally {
      setExecutionBusy(false);
    }
  }

  async function confirmRejectDraft() {
    if (!active || readOnly || executionBusy || !draftReject) return;
    if (draftReject.reason.trim().length < 2) { setNotice({ text: '拒绝理由至少 2 个字符。', error: true }); return; }
    setExecutionBusy(true);
    try {
      await api(`/ai-work-drafts/${draftReject.draftId}/reject`, 'POST', { requestId: requestId(), reason: draftReject.reason.trim() });
      setNotice({ text: '开发信草稿已拒绝。' });
      setDraftReject(null);
      await refreshCandidates(active.id);
    } catch (error) {
      setNotice({ text: errorText(error), error: true });
    } finally {
      setExecutionBusy(false);
    }
  }

  async function saveDraftEdit() {
    if (!active || readOnly || executionBusy || !draftEdit) return;
    if (draftEdit.subject.trim().length < 2 || draftEdit.body.trim().length < 20) { setNotice({ text: '主题至少 2 个字符，正文至少 20 个字符。', error: true }); return; }
    setExecutionBusy(true);
    try {
      await api(`/ai-work-drafts/${draftEdit.id}`, 'PATCH', { requestId: requestId(), subject: draftEdit.subject.trim(), body: draftEdit.body });
      setNotice({ text: '草稿已保存为新的 revision；请重新审批后再发送。' });
      setDraftEdit(null);
      await refreshCandidates(active.id);
    } catch (error) {
      setNotice({ text: errorText(error), error: true });
    } finally {
      setExecutionBusy(false);
    }
  }

  async function confirmSendDraft() {
    if (!active || !isAdmin || executionBusy || !sendDraft) return;
    const draft = drafts.find(item => item.id === sendDraft.id);
    if (!draft) return;
    setExecutionBusy(true);
    try {
      const result = await api<{ draft: AiWorkDraft; duplicate: boolean }>(`/ai-work-drafts/${sendDraft.id}/send`, 'POST', {
        requestId: requestId(),
        confirmed: true,
        ...(draft.compliance.consentRequired ? { consentConfirmed: sendDraft.consentConfirmed, consentBasis: sendDraft.consentBasis.trim() } : {}),
      });
      setNotice({ text: result.duplicate ? '该草稿已发送过（幂等）。' : `开发信已发送：${result.draft.sendReceipt?.provider} ${result.draft.sendReceipt?.messageId}` });
      setSendDraft(null);
      await refreshCandidates(active.id);
      await load();
    } catch (error) {
      setNotice({ text: errorText(error), error: true });
    } finally {
      setExecutionBusy(false);
    }
  }

  function fillPublishFromCurrent(mode: 'copy' | 'edit') {
    if (!aiWork) return;
    setPublishForm({
      id: mode === 'copy' ? `${aiWork.id}-copy` : aiWork.id,
      name: mode === 'copy' ? `${aiWork.name}（副本）` : aiWork.name,
      nameEn: aiWork.nameEn || '',
      summary: aiWork.summary,
      category: aiWork.category,
      playbook: 'lead-discovery',
      expectedRevision: mode === 'edit' ? String(aiWork.revision) : '',
      fields: aiWork.inputSchema.fields.map(field => ({ name: field.name, label: field.label, type: field.type, required: field.required, description: field.description || '' })),
      steps: aiWork.workflow.map(step => ({ id: step.id, title: step.title, owner: step.owner, output: step.output })),
      deliverables: aiWork.deliverables.join('\n'),
      acceptance: aiWork.acceptance.join('\n'),
    });
    setPublishOpen(true);
  }

  async function publishProduct() {
    if (!isAdmin || publishBusy) return;
    const lines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean);
    const fields = publishForm.fields.filter(field => field.name.trim() && field.label.trim());
    const steps = publishForm.steps.filter(step => step.id.trim() && step.title.trim() && step.output.trim());
    if (!publishForm.id.trim() || !publishForm.name.trim() || !publishForm.summary.trim()) { setNotice({ text: '产品 ID、名称与简介为必填项。', error: true }); return; }
    if (fields.length === 0 || steps.length === 0) { setNotice({ text: '至少需要 1 个输入字段与 1 个工作流步骤。', error: true }); return; }
    setPublishBusy(true);
    try {
      const result = await api<{ product: AiWorkProduct; duplicate: boolean }>('/ai-works', 'POST', {
        requestId: requestId(),
        id: publishForm.id.trim(),
        playbook: publishForm.playbook,
        name: publishForm.name.trim(),
        ...(publishForm.nameEn.trim() ? { nameEn: publishForm.nameEn.trim() } : {}),
        summary: publishForm.summary.trim(),
        category: publishForm.category.trim() || '其他',
        inputSchema: { fields: fields.map(field => ({
          name: field.name.trim(), label: field.label.trim(), type: field.type, required: field.required,
          ...(field.description.trim() ? { description: field.description.trim() } : {}),
        })) },
        workflow: steps.map(step => ({ id: step.id.trim(), title: step.title.trim(), owner: step.owner, output: step.output.trim() })),
        deliverables: lines(publishForm.deliverables),
        acceptance: lines(publishForm.acceptance),
        ...(publishForm.expectedRevision.trim() ? { expectedRevision: Number(publishForm.expectedRevision) } : {}),
      });
      setNotice({ text: `${result.duplicate ? '产品已存在且内容一致' : '已发布'}：${result.product.name} v${result.product.revision}（${result.product.id}）` });
      setPublishOpen(false);
      await load();
    } catch (error) {
      setNotice({ text: errorText(error), error: true });
    } finally {
      setPublishBusy(false);
    }
  }

  async function downloadExport(kind: 'candidates' | 'drafts' | 'events') {
    if (!active) return;
    try {
      const result = await api<{ export: { filename: string; contentType: string; content: string; rows: number } }>(`/ai-work-delegations/${active.id}/export/${kind}`);
      setNotice({ text: `已导出 ${result.export.filename}（${result.export.rows} 行）` });
      if (typeof URL.createObjectURL === 'function') {
        const blob = new Blob([result.export.content], { type: result.export.contentType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = result.export.filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) {
      setNotice({ text: errorText(error), error: true });
    }
  }

  async function createFromNewerVersion() {
    if (!active || readOnly || busy || !aiWork) return;
    const facts = active.plan.productFacts;
    if (!facts) return;
    const input = active.input;
    setBusy(true);
    try {
      const result = await api<{ delegation: AiWorkDelegation }>(`/ai-works/${aiWork.id}/delegations`, 'POST', {
        requestId: requestId(),
        productId: facts.productId,
        targetCountry: input.targetCountry,
        buyerType: input.buyerType,
        ...(input.productScope ? { productScope: input.productScope } : {}),
        ...(input.targetCount ? { targetCount: input.targetCount } : {}),
        ...(input.deadlineDays ? { deadlineDays: input.deadlineDays } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
      });
      setNotice({ text: `已用产品库最新版本 v${result.delegation.plan.productFacts?.revision ?? '?'} 新建委托；旧委托仍钉住原版本。` });
      setActiveId(result.delegation.id);
      await load();
    } catch (error) {
      setNotice({ text: errorText(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (readOnly || busy || !aiWork) return;
    if (!form.productId) { setNotice({ text: '请先选择产品库中的产品；产品库为空时请先创建产品。', error: true }); return; }
    if (!form.targetCountry.trim() || !form.buyerType.trim()) { setNotice({ text: '目标国家与采购客户类型为必填项。', error: true }); return; }
    setBusy(true);
    setNotice({ text: '正在校验产品库精确版本并生成开发计划书…' });
    try {
      const result = await api<{ delegation: AiWorkDelegation; duplicate: boolean }>(`/ai-works/${aiWork.id}/delegations`, 'POST', {
        requestId: requestId(),
        productId: form.productId,
        targetCountry: form.targetCountry.trim(),
        buyerType: form.buyerType,
        ...(form.productScope.trim() ? { productScope: form.productScope.trim() } : {}),
        targetCount: Number(form.targetCount),
        deadlineDays: Number(form.deadlineDays),
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      });
      setActiveId(result.delegation.id);
      setNotice({ text: `开发计划委托已建立（${result.delegation.status === 'draft' ? '待审批' : result.delegation.status}），计划书已保存为工件。` });
      await load();
    } catch (error) {
      setNotice({ text: errorText(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function approve(delegation: AiWorkDelegation) {
    if (!isAdmin || busy) return;
    setBusy(true);
    try {
      await api(`/ai-work-delegations/${delegation.id}/approve`, 'POST', { requestId: requestId(), confirmed: true });
      setNotice({ text: '开发计划已审批。下一步可导入客户授权线索并执行规则评分；自动搜索执行器尚未接入，不会生成任何线索。' });
      await load();
    } catch (error) {
      setNotice({ text: errorText(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function cancel(delegation: AiWorkDelegation) {
    if (readOnly || busy) return;
    setBusy(true);
    try {
      await api(`/ai-work-delegations/${delegation.id}/cancel`, 'POST', { requestId: requestId(), reason: '运营取消' });
      setNotice({ text: '委托已取消。' });
      await load();
    } catch (error) {
      setNotice({ text: errorText(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ai-works" data-testid="ai-works" aria-busy={loading || busy} aria-label="客户线索挖掘 AI 工作">
      <header className="aiw-head">
        <div className="aiw-head-copy">
          <span className="aiw-eyebrow">AI WORK · LEAD DISCOVERY</span>
          <h1>客户线索挖掘</h1>
          <p>从企业产品库选择真实产品，输入目标国家与采购客户类型，生成一份可审核的海外买家开发计划。自动搜索要么使用客户授权导入的线索，要么使用已配置的公开搜索/企业登记 API；两者都没有时委托保持"等待数据源"，不会生成假线索或自动发信。</p>
        </div>
        <div className="aiw-head-actions">
          <button type="button" className="aiw-secondary" onClick={() => void load()} disabled={loading}>刷新</button>
          {onOpenLibrary && <button type="button" className="aiw-secondary" onClick={onOpenLibrary}>产品库</button>}
        </div>
      </header>

      {catalog && (
        <div className="aiw-meta">
          <span>AI-work 产品 {catalog.status.publishedProducts} 个 · 当前 {aiWork ? `${aiWork.name} v${aiWork.revision}` : '未发布'}</span>
          <span>产品库 {products.length} 个可用产品 · {catalog.status.productLibraryAvailable ? '已接入' : '未接入'}</span>
          <span>委托 {catalog.status.delegations} 个（待审批 {catalog.status.draftDelegations} · 已批准 {catalog.status.approvedDelegations}）</span>
        </div>
      )}

      {readOnly && (
        <p className="aiw-readonly" role="status"><Icon name="lock" size={16} />当前账号为只读权限：可以查看产品与开发计划，但不能建立或审批委托。</p>
      )}

      <div className="aiw-live" role={notice?.error ? 'alert' : 'status'} aria-live={notice?.error ? 'assertive' : 'polite'}>{notice?.text || ''}</div>

      {!loading && outreachStats && (
        <section className="aiw-dashboard" aria-label="外发运营概览" aria-live="polite">
          <div className="aiw-panel-head">
            <h2>外发运营概览</h2>
            <span className="aiw-panel-note">发送统计与失败重试（当前失败 {failedDrafts.length} 条）</span>
            <button type="button" className="aiw-secondary" onClick={() => void load()} disabled={loading}>刷新概览</button>
          </div>
          <div className="aiw-stat-grid">
            <div className="aiw-stat"><span>已发送</span><strong>{outreachStats.sent}</strong></div>
            <div className="aiw-stat"><span>发送尝试</span><strong>{outreachStats.attempts}</strong></div>
            <div className="aiw-stat"><span>失败次数</span><strong>{outreachStats.failedAttempts}</strong></div>
            <div className="aiw-stat"><span>抑制名单</span><strong>{outreachStats.suppressions}</strong></div>
            <div className="aiw-stat"><span>外发通道</span><strong>{outreach?.configured ? outreach.providerLabel : '未配置'}</strong></div>
            <div className="aiw-stat"><span>Provider 调用</span><strong>{Object.keys(outreachStats.providers).length ? Object.entries(outreachStats.providers).map(([provider, count]) => `${provider} ${count}`).join(' · ') : '0'}</strong></div>
          </div>
          {outreachStats.lastError && <p className="aiw-fineprint">最近一次失败：{outreachStats.lastError.message} · {formatDay(outreachStats.lastError.at)}</p>}
          {failedDrafts.length > 0 && (
            <div className="aiw-failed-list">
              <h4>失败待重试</h4>
              {failedDrafts.map(item => (
                <div className="aiw-failed-row" key={item.draftId}>
                  <span>{item.companyName || item.draftId} · {item.error}</span>
                  <button type="button" className="aiw-secondary" onClick={() => setActiveId(item.delegationId)}>打开委托重试</button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {isAdmin && !loading && catalog && (
        <section className="aiw-publish" aria-label="发布 AI-work 产品">
          <div className="aiw-panel-head">
            <h2>发布 AI-work 产品</h2>
            <span className="aiw-panel-note">管理员：写入平台 AI-work 产品数据库（新产品或新版本；版本更新需 expectedRevision）</span>
          </div>
          <div className="aiw-publish-actions">
            <button type="button" className="aiw-secondary" onClick={() => fillPublishFromCurrent('copy')} disabled={!aiWork}>复制当前产品为新 ID</button>
            <button type="button" className="aiw-secondary" onClick={() => fillPublishFromCurrent('edit')} disabled={!aiWork}>编辑当前产品（新版本）</button>
            <button type="button" className="aiw-secondary" onClick={() => setPublishOpen(open => !open)}>{publishOpen ? '收起编辑器' : '手动填写'}</button>
          </div>
          {publishOpen && (
            <div className="aiw-publish-form">
              <div className="aiw-field-row">
                <label className="aiw-field"><span>产品 ID（小写 kebab-case）</span><input aria-label="产品 ID" value={publishForm.id} onChange={event => setPublishForm({ ...publishForm, id: event.target.value })} disabled={publishBusy} /></label>
                <label className="aiw-field"><span>产品名称</span><input aria-label="产品名称" value={publishForm.name} onChange={event => setPublishForm({ ...publishForm, name: event.target.value })} disabled={publishBusy} /></label>
              </div>
              <div className="aiw-field-row">
                <label className="aiw-field"><span>英文名（可选）</span><input aria-label="产品英文名" value={publishForm.nameEn} onChange={event => setPublishForm({ ...publishForm, nameEn: event.target.value })} disabled={publishBusy} /></label>
                <label className="aiw-field"><span>品类</span><input aria-label="产品品类" value={publishForm.category} onChange={event => setPublishForm({ ...publishForm, category: event.target.value })} disabled={publishBusy} /></label>
              </div>
              <label className="aiw-field"><span>简介</span><textarea aria-label="产品简介" rows={3} value={publishForm.summary} onChange={event => setPublishForm({ ...publishForm, summary: event.target.value })} disabled={publishBusy} /></label>
              <div className="aiw-field-row">
                <label className="aiw-field"><span>Playbook</span><select aria-label="Playbook" value={publishForm.playbook} onChange={() => undefined} disabled><option value="lead-discovery">lead-discovery</option></select></label>
                <label className="aiw-field"><span>expectedRevision（更新已有产品时必填）</span><input aria-label="expectedRevision" type="number" min={1} value={publishForm.expectedRevision} onChange={event => setPublishForm({ ...publishForm, expectedRevision: event.target.value })} disabled={publishBusy} /></label>
              </div>

              <h4>输入字段</h4>
              {publishForm.fields.map((field, index) => (
                <div className="aiw-publish-row" key={index}>
                  <input aria-label={`字段 ${index + 1} 名称`} value={field.name} placeholder="name" onChange={event => setPublishForm({ ...publishForm, fields: publishForm.fields.map((item, position) => position === index ? { ...item, name: event.target.value } : item) })} disabled={publishBusy} />
                  <input aria-label={`字段 ${index + 1} 标签`} value={field.label} placeholder="标签" onChange={event => setPublishForm({ ...publishForm, fields: publishForm.fields.map((item, position) => position === index ? { ...item, label: event.target.value } : item) })} disabled={publishBusy} />
                  <select aria-label={`字段 ${index + 1} 类型`} value={field.type} onChange={event => setPublishForm({ ...publishForm, fields: publishForm.fields.map((item, position) => position === index ? { ...item, type: event.target.value as PublishField['type'] } : item) })} disabled={publishBusy}>
                    <option value="string">string</option>
                    <option value="integer">integer</option>
                    <option value="product_ref">product_ref</option>
                  </select>
                  <label className="aiw-publish-check"><input type="checkbox" checked={field.required} onChange={event => setPublishForm({ ...publishForm, fields: publishForm.fields.map((item, position) => position === index ? { ...item, required: event.target.checked } : item) })} disabled={publishBusy} />必填</label>
                  <button type="button" className="aiw-secondary" onClick={() => setPublishForm({ ...publishForm, fields: publishForm.fields.filter((_, position) => position !== index) })} disabled={publishBusy || publishForm.fields.length <= 1}>移除</button>
                </div>
              ))}
              <button type="button" className="aiw-secondary" onClick={() => setPublishForm({ ...publishForm, fields: [...publishForm.fields, { name: '', label: '', type: 'string', required: false, description: '' }] })} disabled={publishBusy}>添加字段</button>

              <h4>工作流步骤</h4>
              {publishForm.steps.map((step, index) => (
                <div className="aiw-publish-row" key={index}>
                  <input aria-label={`步骤 ${index + 1} ID`} value={step.id} placeholder="step-id" onChange={event => setPublishForm({ ...publishForm, steps: publishForm.steps.map((item, position) => position === index ? { ...item, id: event.target.value } : item) })} disabled={publishBusy} />
                  <input aria-label={`步骤 ${index + 1} 标题`} value={step.title} placeholder="标题" onChange={event => setPublishForm({ ...publishForm, steps: publishForm.steps.map((item, position) => position === index ? { ...item, title: event.target.value } : item) })} disabled={publishBusy} />
                  <select aria-label={`步骤 ${index + 1} 负责人`} value={step.owner} onChange={event => setPublishForm({ ...publishForm, steps: publishForm.steps.map((item, position) => position === index ? { ...item, owner: event.target.value as PublishStep['owner'] } : item) })} disabled={publishBusy}>
                    <option value="agent">agent</option>
                    <option value="human">human</option>
                  </select>
                  <input aria-label={`步骤 ${index + 1} 产出`} value={step.output} placeholder="产出" onChange={event => setPublishForm({ ...publishForm, steps: publishForm.steps.map((item, position) => position === index ? { ...item, output: event.target.value } : item) })} disabled={publishBusy} />
                  <button type="button" className="aiw-secondary" onClick={() => setPublishForm({ ...publishForm, steps: publishForm.steps.filter((_, position) => position !== index) })} disabled={publishBusy || publishForm.steps.length <= 1}>移除</button>
                </div>
              ))}
              <button type="button" className="aiw-secondary" onClick={() => setPublishForm({ ...publishForm, steps: [...publishForm.steps, { id: '', title: '', owner: 'agent', output: '' }] })} disabled={publishBusy}>添加步骤</button>

              <div className="aiw-field-row">
                <label className="aiw-field"><span>交付物（每行一项）</span><textarea aria-label="交付物" rows={3} value={publishForm.deliverables} onChange={event => setPublishForm({ ...publishForm, deliverables: event.target.value })} disabled={publishBusy} /></label>
                <label className="aiw-field"><span>验收标准（每行一项）</span><textarea aria-label="验收标准" rows={3} value={publishForm.acceptance} onChange={event => setPublishForm({ ...publishForm, acceptance: event.target.value })} disabled={publishBusy} /></label>
              </div>
              <button type="button" className="aiw-primary" onClick={() => void publishProduct()} disabled={publishBusy}>{publishBusy ? '正在发布…' : '发布产品'}</button>
            </div>
          )}
        </section>
      )}

      {loading ? (
        <div className="aiw-skeleton" role="status" aria-label="正在读取 AI-work">
          <p className="aiw-skeleton-label">正在读取 AI-work 产品、产品库与委托…</p>
          {[0, 1].map(index => <div className="aiw-skeleton-card" key={index} aria-hidden="true"><span className="aiw-skeleton-line wide" /><span className="aiw-skeleton-line" /><span className="aiw-skeleton-line short" /></div>)}
        </div>
      ) : loadError ? (
        <div className="aiw-error" role="alert">
          <strong>AI-work 暂时无法读取</strong>
          <p>{loadError}</p>
          <button type="button" className="aiw-secondary" onClick={() => void load()}>重试</button>
        </div>
      ) : !aiWork ? (
        <div className="aiw-empty">
          <span className="aiw-empty-icon"><Icon name="work" size={26} /></span>
          <strong>平台还没有发布 AI-work 产品</strong>
          <p>首个通用 AI-work 由服务启动时发布；如果这里为空，请检查服务版本与数据目录。</p>
        </div>
      ) : (
        <div className="aiw-layout">
          <section className="aiw-panel aiw-form-panel" aria-label="建立开发计划委托">
            <div className="aiw-panel-head">
              <h2>建立开发计划委托</h2>
              <span className="aiw-panel-note">输入：国家 + 采购客户类型 + 产品库产品</span>
            </div>
            {products.length === 0 ? (
              <div className="aiw-inline-empty">
                <p>产品库还没有可用产品。开发计划必须绑定产品库的精确版本，请先创建产品。</p>
                {onOpenLibrary && <button type="button" className="aiw-primary" onClick={onOpenLibrary}>去产品库创建产品</button>}
              </div>
            ) : (
              <form className="aiw-form" onSubmit={submit}>
                <label className="aiw-field">
                  <span>AI-work 产品（平台产品库）</span>
                  <select aria-label="AI-work 产品" value={aiWork?.id || ''} onChange={event => setWorkId(event.target.value)} disabled={readOnly || busy}>
                    {(catalog?.products || []).map(item => <option key={item.id} value={item.id}>{item.name} · v{item.revision}</option>)}
                  </select>
                  <small>委托会绑定所选 AI-work 产品；产品本身发布在平台 AI-work 产品库，当前 playbook 为 lead-discovery。</small>
                </label>
                <label className="aiw-field">
                  <span>产品（产品库精确版本）</span>
                  <select aria-label="产品库产品" value={form.productId} onChange={event => setForm({ ...form, productId: event.target.value })} disabled={readOnly || busy} required>
                    {products.map(item => <option key={item.id} value={item.id}>{item.name} · {item.category || '品类待补'} · v{item.revision}</option>)}
                  </select>
                  <small>委托会钉住产品的 revision 与 SHA-256；计划中的品类、SKU、MOQ、交期与供货条件只来自产品库。</small>
                </label>
                <div className="aiw-field-row">
                  <label className="aiw-field">
                    <span>目标国家</span>
                    <input aria-label="目标国家" list="aiw-countries" value={form.targetCountry} maxLength={80} onChange={event => setForm({ ...form, targetCountry: event.target.value })} disabled={readOnly || busy} required />
                    <datalist id="aiw-countries">{COUNTRY_SUGGESTIONS.map(item => <option key={item} value={item} />)}</datalist>
                  </label>
                  <label className="aiw-field">
                    <span>采购客户类型</span>
                    <select aria-label="采购客户类型" value={form.buyerType} onChange={event => setForm({ ...form, buyerType: event.target.value })} disabled={readOnly || busy} required>
                      {BUYER_TYPES.map(item => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </label>
                </div>
                <div className="aiw-field-row">
                  <label className="aiw-field">
                    <span>目标候选线索数</span>
                    <input aria-label="目标候选线索数" type="number" min={5} max={500} value={form.targetCount} onChange={event => setForm({ ...form, targetCount: Number(event.target.value) })} disabled={readOnly || busy} />
                  </label>
                  <label className="aiw-field">
                    <span>交付周期（天）</span>
                    <input aria-label="交付周期" type="number" min={3} max={90} value={form.deadlineDays} onChange={event => setForm({ ...form, deadlineDays: Number(event.target.value) })} disabled={readOnly || busy} />
                  </label>
                </div>
                <label className="aiw-field">
                  <span>产品/品类范围（可选，默认用产品库品类）</span>
                  <input aria-label="产品品类范围" value={form.productScope} maxLength={200} placeholder="例如：手工具 / 花园五金" onChange={event => setForm({ ...form, productScope: event.target.value })} disabled={readOnly || busy} />
                </label>
                <label className="aiw-field">
                  <span>补充说明（可选）</span>
                  <textarea aria-label="补充说明" rows={3} maxLength={1000} value={form.notes} placeholder="例如：首批优先有进口记录的分销商；排除客户已有客户。" onChange={event => setForm({ ...form, notes: event.target.value })} disabled={readOnly || busy} />
                </label>
                <button type="submit" className="aiw-primary" disabled={readOnly || busy || !form.productId}>{busy ? '正在生成…' : '生成开发计划并建立委托'}</button>
                <p className="aiw-fineprint">生成的是开发计划书与待审批委托，不执行线索发现、不发信、不调用模型。</p>
              </form>
            )}
          </section>

          <section className="aiw-panel aiw-result-panel" aria-label="开发计划委托">
            <div className="aiw-panel-head">
              <h2>开发计划委托</h2>
              <span className="aiw-panel-note">{delegations.length ? `显示 ${visibleDelegations.length} / ${delegations.length} 个` : '尚无委托'}</span>
            </div>
            {delegations.length === 0 ? (
              <div className="aiw-inline-empty"><p>还没有开发计划委托。填写左侧输入后会出现在这里；所有数据来自真实产品库与服务端。</p></div>
            ) : (
              <>
                <div className="aiw-list-tools">
                  <input aria-label="搜索委托" className="aiw-search" value={delegationQuery} onChange={event => setDelegationQuery(event.target.value)} placeholder="按产品/国家/买家类型/状态搜索委托" />
                  <select aria-label="委托状态" className="aiw-status-filter" value={delegationStatus} onChange={event => setDelegationStatus(event.target.value)}>
                    <option value="all">全部状态</option>
                    <option value="draft">待审批</option>
                    <option value="approved">已批准</option>
                    <option value="cancelled">已取消</option>
                  </select>
                </div>
                <div className="aiw-delegation-list" role="list">
                  {visibleDelegations.slice(0, 8).map(item => (
                    <button type="button" key={item.id} role="listitem" className={`aiw-delegation ${item.id === activeId ? 'selected' : ''}`} onClick={() => setActiveId(item.id)}>
                      <span className="aiw-delegation-main">
                        <strong>{item.plan.productFacts?.name || item.input?.targetCountry || '开发计划'}</strong>
                        <small>{item.input?.targetCountry} · {item.input?.buyerType} · {formatDay(item.createdAt)}</small>
                      </span>
                      <span className={`aiw-badge aiw-badge-${item.status}`}>{DELEGATION_STATUS[item.status] || item.status}</span>
                    </button>
                  ))}
                </div>
                {visibleDelegations.length === 0 && <p className="aiw-empty-text">没有匹配的委托；清空搜索可恢复。</p>}
                {active && <DelegationDetail
                  delegation={active}
                  candidates={candidates}
                  drafts={drafts}
                  sources={sources}
                  events={events}
                  readiness={readiness}
                  outreach={outreach}
                  draftEdit={draftEdit}
                  sendDraft={sendDraft}
                  libraryProducts={products}
                  onOpenLibrary={onOpenLibrary}
                  onCreateFromNewerVersion={() => void createFromNewerVersion()}
                  onExport={kind => void downloadExport(kind)}
                  isAdmin={isAdmin}
                  readOnly={readOnly}
                  busy={busy || executionBusy}
                  importOpen={importOpen}
                  importFormat={importFormat}
                  importContent={importContent}
                  reviewDraft={reviewDraft}
                  draftReject={draftReject}
                  onApprove={() => void approve(active)}
                  onCancel={() => void cancel(active)}
                  onToggleImport={() => setImportOpen(open => !open)}
                  onImportFormat={setImportFormat}
                  onImportContent={setImportContent}
                  onImport={() => void importCandidates()}
                  onExecute={() => void executeDelegation()}
                  onReviewStart={(candidate, decision) => setReviewDraft({ id: candidate.id, decision, reason: '' })}
                  onReviewReason={reason => setReviewDraft(current => current ? { ...current, reason } : current)}
                  onReviewConfirm={() => { const candidate = candidates.find(item => item.id === reviewDraft?.id); if (candidate && reviewDraft) void reviewCandidate(candidate, reviewDraft.decision, reviewDraft.reason); }}
                  onReviewCancel={() => setReviewDraft(null)}
                  onGenerateDraft={candidate => void generateDraft(candidate)}
                  onApproveDraft={draft => void approveDraftAction(draft)}
                  onStartRejectDraft={draft => setDraftReject({ draftId: draft.id, reason: '' })}
                  onRejectReason={reason => setDraftReject(current => current ? { ...current, reason } : current)}
                  onConfirmRejectDraft={() => void confirmRejectDraft()}
                  onCancelRejectDraft={() => setDraftReject(null)}
                  onStartEditDraft={draft => setDraftEdit({ id: draft.id, subject: draft.subject, body: draft.body })}
                  onDraftEditChange={next => setDraftEdit(current => current ? { ...current, ...next } : current)}
                  onSaveDraftEdit={() => void saveDraftEdit()}
                  onCancelDraftEdit={() => setDraftEdit(null)}
                  onStartSendDraft={draft => setSendDraft({ id: draft.id, consentConfirmed: false, consentBasis: '' })}
                  onSendDraftChange={next => setSendDraft(current => current ? { ...current, ...next } : current)}
                  onConfirmSendDraft={() => void confirmSendDraft()}
                  onCancelSendDraft={() => setSendDraft(null)}
                />}
              </>
            )}
          </section>
        </div>
      )}
    </section>
  );
}

function DelegationDetail({
  delegation, candidates, drafts, sources, events, readiness, outreach, draftEdit, sendDraft, libraryProducts, onOpenLibrary, onCreateFromNewerVersion, onExport, isAdmin, readOnly, busy, importOpen, importFormat, importContent, reviewDraft, draftReject,
  onApprove, onCancel, onToggleImport, onImportFormat, onImportContent, onImport, onExecute,
  onReviewStart, onReviewReason, onReviewConfirm, onReviewCancel,
  onGenerateDraft, onApproveDraft, onStartRejectDraft, onRejectReason, onConfirmRejectDraft, onCancelRejectDraft,
  onStartEditDraft, onDraftEditChange, onSaveDraftEdit, onCancelDraftEdit, onStartSendDraft, onSendDraftChange, onConfirmSendDraft, onCancelSendDraft,
}: {
  delegation: AiWorkDelegation;
  candidates: AiWorkerCandidate[];
  drafts: AiWorkDraft[];
  sources: AiWorkSource[];
  events: AiWorkEvent[];
  readiness: ProductReadiness | null;
  outreach: OutreachReadiness | null;
  draftEdit: { id: string; subject: string; body: string } | null;
  sendDraft: { id: string; consentConfirmed: boolean; consentBasis: string } | null;
  libraryProducts: LibraryProduct[];
  onOpenLibrary?: () => void;
  onCreateFromNewerVersion?: () => void;
  onExport?: (kind: 'candidates' | 'drafts' | 'events') => void;
  isAdmin: boolean;
  readOnly: boolean;
  busy: boolean;
  importOpen: boolean;
  importFormat: 'csv' | 'json';
  importContent: string;
  reviewDraft: { id: string; decision: 'qualified' | 'rejected'; reason: string } | null;
  draftReject: { draftId: string; reason: string } | null;
  onApprove: () => void;
  onCancel: () => void;
  onToggleImport: () => void;
  onImportFormat: (format: 'csv' | 'json') => void;
  onImportContent: (content: string) => void;
  onImport: () => void;
  onExecute: () => void;
  onReviewStart: (candidate: AiWorkerCandidate, decision: 'qualified' | 'rejected') => void;
  onReviewReason: (reason: string) => void;
  onReviewConfirm: () => void;
  onReviewCancel: () => void;
  onGenerateDraft: (candidate: AiWorkerCandidate) => void;
  onApproveDraft: (draft: AiWorkDraft) => void;
  onStartRejectDraft: (draft: AiWorkDraft) => void;
  onRejectReason: (reason: string) => void;
  onConfirmRejectDraft: () => void;
  onCancelRejectDraft: () => void;
  onStartEditDraft: (draft: AiWorkDraft) => void;
  onDraftEditChange: (next: { subject?: string; body?: string }) => void;
  onSaveDraftEdit: () => void;
  onCancelDraftEdit: () => void;
  onStartSendDraft: (draft: AiWorkDraft) => void;
  onSendDraftChange: (next: { consentConfirmed?: boolean; consentBasis?: string }) => void;
  onConfirmSendDraft: () => void;
  onCancelSendDraft: () => void;
}) {
  const plan = delegation.plan;
  const facts = plan.productFacts;
  const [eventFilter, setEventFilter] = useState<'all' | 'review' | 'execution' | 'outreach'>('all');
  const filteredEvents = eventFilter === 'all' ? events : events.filter(event => EVENT_FILTERS[eventFilter].includes(event.type));
  const currentProduct = facts ? libraryProducts.find(item => item.id === facts.productId) : undefined;
  const missingChecks = readiness?.checks.filter(check => ['missing', 'invalid', 'expired'].includes(check.status)).length || 0;
  const executionLabel = EXECUTION_STATUS[delegation.execution.status] || delegation.execution.status;
  return (
    <article className="aiw-detail" data-delegation-id={delegation.id} aria-label="委托详情">
      <header className="aiw-detail-head">
        <div>
          <span className="aiw-eyebrow">DEVELOPMENT PLAN DELEGATION</span>
          <h3>{plan.objective}</h3>
          <p className="aiw-detail-meta">
            <span>{delegation.input?.targetCountry} · {delegation.input?.buyerType} · 目标 {plan.discovery.targetCount} 条</span>
            <span>计划 hash {shortHash(delegation.planHash)}</span>
            <span>创建 {formatDay(delegation.createdAt)}</span>
          </p>
        </div>
        <span className={`aiw-badge aiw-badge-${delegation.status}`}>{DELEGATION_STATUS[delegation.status] || delegation.status}</span>
      </header>

      <p className="aiw-execution" role="status">
        <Icon name="info" size={15} />
        执行状态：{executionLabel}。{delegation.execution.reason}
      </p>

      {delegation.status === 'approved' && (
        <section className="aiw-execution-panel" aria-label="执行与人工审核">
          <div className="aiw-execution-head">
            <h4>执行与人工审核</h4>
            <span className={`aiw-exec-status aiw-exec-status-${delegation.execution.status}`}>{executionLabel}</span>
          </div>
          <div className="aiw-export-actions" aria-label="导出">
            <button type="button" className="aiw-secondary" onClick={() => onExport?.('candidates')} disabled={busy}>导出候选 CSV</button>
            <button type="button" className="aiw-secondary" onClick={() => onExport?.('drafts')} disabled={busy}>导出草稿 CSV</button>
            <button type="button" className="aiw-secondary" onClick={() => onExport?.('events')} disabled={busy}>导出审计事件 CSV</button>
          </div>
          <p className="aiw-empty-text">
            已导入 {delegation.execution.counts.imported} 条 · 重复 {delegation.execution.counts.duplicates} · 拒绝 {delegation.execution.counts.rejectedRows} 行 · 候选 {delegation.execution.counts.candidates} 条（待审核 {delegation.execution.counts.needsReview} · 合格 {delegation.execution.counts.qualified} · 剔除 {delegation.execution.counts.rejected}）
          </p>
          {sources.length > 0 && (
            <div className="aiw-source-status" aria-label="数据源状态">
              {sources.map(source => (
                <span key={source.id} className={`aiw-source-pill aiw-source-${source.status}`}>
                  {source.label} · {source.status === 'available' ? '可用' : source.status === 'unconfigured' ? '未配置' : '未接入'}
                </span>
              ))}
            </div>
          )}
          <div className="aiw-exec-actions">
            <button type="button" className="aiw-secondary" onClick={onToggleImport} disabled={busy}>{importOpen ? '收起导入' : '导入客户授权线索'}</button>
            <button type="button" className="aiw-primary" onClick={onExecute} disabled={busy}>开始执行（自动搜索 + 已导入线索）</button>
          </div>
          <p className="aiw-fineprint">自动搜索：Serper / Companies House 需要服务器配置 API key 才会运行；未配置时只使用客户授权导入。每条记录必须带来源 URL、抓取时间与逐字摘录；自动结果只作为候选，需人工确认产品匹配。当前没有任何外发通道。</p>
          {importOpen && (
            <div className="aiw-import-box">
              <label className="aiw-field">
                <span>格式</span>
                <select aria-label="导入格式" value={importFormat} onChange={event => onImportFormat(event.target.value as 'csv' | 'json')} disabled={busy}>
                  <option value="csv">CSV</option>
                  <option value="json">JSON</option>
                </select>
              </label>
              <label className="aiw-field">
                <span>内容</span>
                <textarea
                  aria-label="导入内容"
                  rows={6}
                  value={importContent}
                  onChange={event => onImportContent(event.target.value)}
                  disabled={busy}
                  placeholder={importFormat === 'csv'
                    ? 'companyName,website,country,buyerType,contactName,contactTitle,contactEmail,sourceUrl,sourceExcerpt,sourceFetchedAt,notes'
                    : '{"candidates":[{"companyName":"…","website":"https://…","sourceUrl":"https://…","sourceExcerpt":"…","sourceFetchedAt":"2026-10-15"}]}'}
                />
              </label>
              <button type="button" className="aiw-primary" onClick={onImport} disabled={busy || !importContent.trim()}>导入并逐行校验</button>
            </div>
          )}
          {candidates.length > 0 && (
            <div className="aiw-candidates">
              {candidates.map(candidate => {
                const badge = candidate.status === 'qualified' ? 'approved' : candidate.status === 'rejected' ? 'cancelled' : 'draft';
                const draft = drafts.find(item => item.candidateId === candidate.id);
                return (
                  <article className="aiw-candidate" key={candidate.id} data-candidate-id={candidate.id}>
                    <header className="aiw-candidate-head">
                      <strong>{candidate.companyName}</strong>
                      <span className={`aiw-badge aiw-badge-${badge}`}>{CANDIDATE_STATUS[candidate.status]}</span>
                    </header>
                    <p className="aiw-candidate-meta">{candidate.websiteDomain} · {candidate.country || '国家缺项'} · {candidate.buyerType || '类型缺项'} · 匹配分 {candidate.fitScore}</p>
                    {candidate.evidence.map(evidence => (
                      <p className="aiw-candidate-evidence" key={`${evidence.sourceUrl}-${evidence.fetchedAt || 'unknown'}`}>
                        <a href={evidence.sourceUrl} target="_blank" rel="noreferrer">来源</a> · {evidence.fetchedAt ? formatDay(evidence.fetchedAt) : '日期缺项'} · {evidence.excerpt}
                      </p>
                    ))}
                    {candidate.fitReasons.length > 0 && <p className="aiw-candidate-reasons">{candidate.fitReasons.join('；')}</p>}
                    {candidate.status === 'needs_review' && (
                      reviewDraft?.id === candidate.id ? (
                        <div className="aiw-review-box">
                          <input aria-label={`审核理由 ${candidate.companyName}`} value={reviewDraft.reason} onChange={event => onReviewReason(event.target.value)} placeholder="填写人工审核理由（至少 2 个字符）" disabled={busy} />
                          <button type="button" className="aiw-primary" onClick={onReviewConfirm} disabled={busy}>确认{reviewDraft.decision === 'qualified' ? '合格' : '剔除'}</button>
                          <button type="button" className="aiw-secondary" onClick={onReviewCancel} disabled={busy}>取消</button>
                        </div>
                      ) : (
                        <div className="aiw-review-actions">
                          <button type="button" className="aiw-secondary" onClick={() => onReviewStart(candidate, 'qualified')} disabled={busy}>合格</button>
                          <button type="button" className="aiw-secondary" onClick={() => onReviewStart(candidate, 'rejected')} disabled={busy}>剔除</button>
                        </div>
                      )
                    )}
                    {candidate.review && <p className="aiw-candidate-review">{candidate.review.decision === 'qualified' ? '合格' : '剔除'} · {candidate.review.reviewer} · {candidate.review.reason}</p>}
                    {draft ? (
                      <div className="aiw-draft" data-draft-id={draft.id}>
                        <div className="aiw-draft-head">
                          <strong>开发信草稿 · {draft.language.toUpperCase()} · revision {draft.revision}</strong>
                          <span className={`aiw-badge aiw-badge-${draft.sent ? 'approved' : draft.status === 'approved' ? 'approved' : draft.status === 'rejected' ? 'cancelled' : 'draft'}`}>{draft.sent ? '已发送' : DRAFT_STATUS[draft.status]}</span>
                        </div>
                        <p className={draft.sent ? 'aiw-candidate-review' : 'aiw-unsent'} role="status">
                          {draft.sent
                            ? `已发送 · ${draft.sendReceipt?.provider || ''} ${draft.sendReceipt?.messageId || ''} · ${draft.sentAt ? formatDay(draft.sentAt) : ''}`
                            : outreach?.configured ? '未发送 · 外发通道已配置；发送需管理员逐封确认' : '未发送 · 外发通道未配置（服务端 OUTREACH_PROVIDER / API key / OUTREACH_FROM_EMAIL）'}
                        </p>
                        <p className="aiw-draft-subject">主题：{draft.subject}</p>
                        <pre className="aiw-draft-body">{draft.body}</pre>
                        {draft.warnings.length > 0 && (
                          <ul className="aiw-draft-warnings">{draft.warnings.map(item => <li key={item}>{item}</li>)}</ul>
                        )}
                        {draftEdit?.id === draft.id && (
                          <div className="aiw-review-box">
                            <input aria-label={`草稿主题 ${candidate.companyName}`} value={draftEdit.subject} onChange={event => onDraftEditChange({ subject: event.target.value })} disabled={busy} />
                            <textarea aria-label={`草稿正文 ${candidate.companyName}`} rows={10} value={draftEdit.body} onChange={event => onDraftEditChange({ body: event.target.value })} disabled={busy} />
                            <button type="button" className="aiw-primary" onClick={onSaveDraftEdit} disabled={busy}>保存草稿修订</button>
                            <button type="button" className="aiw-secondary" onClick={onCancelDraftEdit} disabled={busy}>取消</button>
                          </div>
                        )}
                        {draft.status === 'draft' && (
                          draftReject?.draftId === draft.id ? (
                            <div className="aiw-review-box">
                              <input aria-label={`拒绝理由 ${candidate.companyName}`} value={draftReject.reason} onChange={event => onRejectReason(event.target.value)} placeholder="填写拒绝理由（至少 2 个字符）" disabled={busy} />
                              <button type="button" className="aiw-primary" onClick={onConfirmRejectDraft} disabled={busy}>确认拒绝</button>
                              <button type="button" className="aiw-secondary" onClick={onCancelRejectDraft} disabled={busy}>取消</button>
                            </div>
                          ) : (
                            <div className="aiw-draft-actions">
                              {isAdmin && <button type="button" className="aiw-primary" onClick={() => onApproveDraft(draft)} disabled={busy}>审批草稿</button>}
                              {!readOnly && <button type="button" className="aiw-secondary" onClick={() => onStartEditDraft(draft)} disabled={busy}>编辑草稿</button>}
                              {!readOnly && <button type="button" className="aiw-secondary" onClick={() => onStartRejectDraft(draft)} disabled={busy}>拒绝草稿</button>}
                            </div>
                          )
                        )}
                        {draft.status === 'approved' && !draft.sent && (
                          <div className="aiw-draft-actions">
                            {draft.lastSendError && <p className="aiw-draft-rejected">上次发送失败：{draft.lastSendError.message}（可重试）</p>}
                            {!outreach?.configured ? (
                              <p className="aiw-draft-rejected">外发通道未配置，无法发送；草稿保持已批准未发送。</p>
                            ) : sendDraft?.id === draft.id ? (
                              <div className="aiw-review-box">
                                {draft.compliance.consentRequired && (
                                  <>
                                    <label className="aiw-publish-check"><input type="checkbox" checked={sendDraft.consentConfirmed} onChange={event => onSendDraftChange({ consentConfirmed: event.target.checked })} disabled={busy} />已取得收件人事先同意（记录依据）</label>
                                    <input aria-label={`同意依据 ${candidate.companyName}`} value={sendDraft.consentBasis} onChange={event => onSendDraftChange({ consentBasis: event.target.value })} placeholder="同意来源/时间（至少 5 个字符）" disabled={busy} />
                                  </>
                                )}
                                {outreach.dualApproval && <p className="aiw-fineprint">已开启双人审批：审批人与发送人必须是不同管理员。</p>}
                                <button type="button" className="aiw-primary" onClick={onConfirmSendDraft} disabled={busy}>确认发送（{outreach.providerLabel}）</button>
                                <button type="button" className="aiw-secondary" onClick={onCancelSendDraft} disabled={busy}>取消</button>
                              </div>
                            ) : isAdmin ? (
                              <button type="button" className="aiw-primary" onClick={() => onStartSendDraft(draft)} disabled={busy}>{draft.lastSendError ? '重试发送' : '发送开发信'}</button>
                            ) : (
                              <p className="aiw-candidate-review">已批准，等待管理员发送。</p>
                            )}
                          </div>
                        )}
                        {draft.sent && <p className="aiw-candidate-review">发送回执：{draft.sendReceipt?.provider} · {draft.sendReceipt?.messageId} · 收件人 {draft.sendReceipt?.to}</p>}
                        {draft.status === 'rejected' && (
                          <div className="aiw-draft-actions">
                            <p className="aiw-draft-rejected">已拒绝：{draft.rejectReason}</p>
                            <button type="button" className="aiw-secondary" onClick={() => onGenerateDraft(candidate)} disabled={busy}>重新生成草稿</button>
                          </div>
                        )}
                      </div>
                    ) : candidate.status === 'qualified' ? (
                      <div className="aiw-draft-actions">
                        <button type="button" className="aiw-secondary" onClick={() => onGenerateDraft(candidate)} disabled={busy}>生成开发信草稿</button>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {events.length > 0 && (
        <section className="aiw-events" aria-label="审计事件">
          <div className="aiw-events-head">
            <h4>审计事件（最近 {filteredEvents.length} 条）</h4>
            <div className="aiw-event-filters" role="group" aria-label="审计事件筛选">
              {([['all', '全部'], ['review', '审批'], ['execution', '执行'], ['outreach', '草稿与发送']] as const).map(([value, label]) => (
                <button key={value} type="button" className={`aiw-filter ${eventFilter === value ? 'active' : ''}`} aria-pressed={eventFilter === value} onClick={() => setEventFilter(value)}>{label}</button>
              ))}
            </div>
          </div>
          {filteredEvents.length === 0 ? <p className="aiw-empty-text">该分类暂无事件。</p> : (
            <ol className="aiw-event-list">
              {filteredEvents.slice(0, 20).map(event => (
                <li className="aiw-event" key={event.id}>
                  <span className="aiw-event-type">{event.type}</span>
                  <span className="aiw-event-meta">{event.actor || 'system'} · {formatDay(event.at)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      <div className="aiw-detail-grid">
        <section className="aiw-block">
          <h4>产品库精确版本</h4>
          {facts ? (
            <dl className="aiw-facts">
              <div><dt>产品</dt><dd>{facts.name}</dd></div>
              <div><dt>品类</dt><dd>{facts.category || '缺项'}</dd></div>
              <div><dt>版本</dt><dd>revision {facts.revision} · SHA-256 <code>{shortHash(facts.sha256)}</code></dd></div>
              <div><dt>完整度</dt><dd><span className={`aiw-completeness aiw-completeness-${facts.factCompleteness}`}>{COMPLETENESS[facts.factCompleteness] || facts.factCompleteness}</span>{facts.missingFields.length > 0 && <span className="aiw-missing"> 缺：{facts.missingFields.join('、')}</span>}</dd></div>
              <div><dt>SKU</dt><dd>{facts.skus.length === 0 ? '缺项' : facts.skus.map(sku => `${sku.code}${sku.unit ? ` (${sku.unit})` : ''}${sku.moq ? ` · MOQ ${sku.moq}` : ''}`).join('；')}</dd></div>
              <div><dt>供货</dt><dd>{Object.entries(SUPPLY_LABELS).map(([key, label]) => `${label}：${facts.supply?.[key] || '缺项'}`).join('；')}</dd></div>
            </dl>
          ) : <p className="aiw-empty-text">本委托未绑定产品库产品。</p>}
          {readiness && (
            <p className={`aiw-readiness aiw-readiness-${readiness.overall}`} role="status">
              产品库 readiness：{READINESS_LABELS[readiness.overall] || readiness.overall} · 检查项 {readiness.checks.length}（缺项/过期 {missingChecks}）
              {missingChecks > 0 && onOpenLibrary && <button type="button" className="aiw-link" onClick={onOpenLibrary}>去产品库补齐</button>}
            </p>
          )}
          {facts && currentProduct && currentProduct.revision > facts.revision && (
            <p className="aiw-newer-version" role="status">
              产品库已有新版本 v{currentProduct.revision}；本委托仍使用开启时的 v{facts.revision}，不会自动替换。
              {!readOnly && onCreateFromNewerVersion && <button type="button" className="aiw-link" onClick={onCreateFromNewerVersion}>用新版本新建委托</button>}
            </p>
          )}
        </section>

        <section className="aiw-block">
          <h4>市场与买家画像</h4>
          <dl className="aiw-facts">
            <div><dt>市场</dt><dd>{plan.market.country.nameZh}{plan.market.country.code ? `（${plan.market.country.code}）` : ''} · {plan.market.language.label} · {plan.market.currency || '币种待确认'}</dd></div>
            <div><dt>冷邮件</dt><dd className={`aiw-policy aiw-policy-${plan.market.coldEmailPolicy}`}>{plan.market.coldEmailNote}</dd></div>
            <div><dt>买家类型</dt><dd>{plan.buyerProfile.type}（{plan.buyerProfile.typeEn}）{plan.buyerProfile.known ? '' : ' · 通用模板，需人工补充'}</dd></div>
            <div><dt>决策角色</dt><dd>{plan.buyerProfile.decisionRoles.join('、')}</dd></div>
            <div><dt>采购信号</dt><dd>{plan.buyerProfile.buyingSignals.join('；')}</dd></div>
            <div><dt>排除条件</dt><dd>{plan.buyerProfile.disqualifiers.join('；')}</dd></div>
          </dl>
        </section>
      </div>

      <section className="aiw-block">
        <h4>线索发现计划</h4>
        <p className="aiw-empty-text">目标候选 {plan.discovery.targetCount} 条，探测量级约 {plan.discovery.probeCount}；去重键：{plan.discovery.dedupeKeys.join('、')}。</p>
        <div className="aiw-query-list">
          {plan.discovery.queries.map((query, index) => (
            <div className="aiw-query" key={`${query.purpose}-${index}`}>
              <span>{query.purpose}</span>
              <code>{query.query}</code>
              <small>{query.source}</small>
            </div>
          ))}
        </div>
        <div className="aiw-source-list">
          {plan.discovery.sources.map(source => (
            <div className="aiw-source" key={source.id}>
              <strong>{source.label}</strong>
              <span>{source.availability}</span>
              <small>{source.note}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="aiw-block">
        <h4>执行工作流</h4>
        <ol className="aiw-workflow">
          {plan.workflow.map(step => (
            <li key={step.id}>
              <span>{step.title}</span>
              <small>{step.owner === 'human' ? '人工' : 'AI/Agent'} · D+{step.dueInDays} · {step.output}</small>
            </li>
          ))}
        </ol>
      </section>

      <div className="aiw-detail-grid">
        <section className="aiw-block">
          <h4>交付物</h4>
          <ul>{plan.deliverables.map(item => <li key={item.name}>{item.name}<small> · D+{item.dueInDays}</small></li>)}</ul>
        </section>
        <section className="aiw-block">
          <h4>验收标准</h4>
          <ul>{plan.acceptance.map(item => <li key={item}>{item}</li>)}</ul>
        </section>
      </div>

      <section className="aiw-block">
        <h4>风险与开放问题</h4>
        <ul className="aiw-risks">{plan.risks.map(item => <li key={item}>{item}</li>)}</ul>
        {plan.notes.length > 0 && <ul className="aiw-notes">{plan.notes.map(item => <li key={item}>{item}</li>)}</ul>}
        <ul className="aiw-open">{plan.openQuestions.map(item => <li key={item}>{item}</li>)}</ul>
      </section>

      <footer className="aiw-detail-actions">
        {delegation.artifactId && <a className="aiw-secondary" href={`/api/artifacts/${delegation.artifactId}/download`} target="_blank" rel="noreferrer">下载开发计划书（SHA {shortHash(delegation.artifactSha256)}）</a>}
        {delegation.status === 'draft' && isAdmin && <button type="button" className="aiw-primary" onClick={onApprove} disabled={busy}>审批开发计划</button>}
        {delegation.status === 'draft' && !readOnly && <button type="button" className="aiw-secondary" onClick={onCancel} disabled={busy}>取消委托</button>}
        {delegation.status === 'approved' && <span className="aiw-approved">已由 {delegation.approvedBy} 审批 · {delegation.approvedAt ? formatDay(delegation.approvedAt) : ''}</span>}
      </footer>
    </article>
  );
}

export default AiWorks;
