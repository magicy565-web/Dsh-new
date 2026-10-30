import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { AlertCircle, LoaderCircle, RefreshCw } from 'lucide-react';
import flowCss from '@xyflow/react/dist/style.css';
import appCss from './styles.css';
import canvasCss from './canvas.css';
import { BusinessWorkbench } from './BusinessWorkbench.jsx';
import { Mandates } from './Mandates.jsx';
import { TradeInspector, ImportRfq } from './TradeInspector.jsx';
import { callApi, stateFrom, unwrap, requestId, errorText } from './api.mjs';
import { projectGraph, KINDS, STATUSES, money } from './model.mjs';
import { Inspector, RelationshipInspector, Dialog, ReviewDialog, CredentialDialog, ArtifactDialog } from './Inspector.jsx';
import { nativeInstruction } from './native.mjs';
import { Banner } from './ui.jsx';
import { CanvasSurface } from './canvas/CanvasSurface.jsx';
import { TopBar } from './canvas/TopBar.jsx';
import { FloatingToolbar } from './canvas/FloatingToolbar.jsx';
import { ZoomControl } from './canvas/ZoomControl.jsx';
import { SearchPalette } from './canvas/SearchPalette.jsx';
import { AddMenu } from './canvas/AddMenu.jsx';
import { SelectionBar } from './canvas/SelectionBar.jsx';
import { Onboarding } from './canvas/Onboarding.jsx';
import { ShortcutsDialog, ConnectDialog } from './canvas/Dialogs.jsx';
import { ActivityDrawer, MembersPanel } from './canvas/Panels.jsx';
import { ADD_GROUPS, ADD_ITEMS, itemAvailability } from './canvas/add-catalog.mjs';
import { connectionPrompt, suggestionsFrom } from './canvas/connect-rules.mjs';
import { addDraft, createDraft, dismissDraft, reconcileDrafts, settleDraft } from './canvas/drafts.mjs';
import { layoutNodeIdsFromState } from '../layout-ids.js';
import { hasActiveFilter, matchingIds, relatedIds } from './canvas/search.mjs';
import { GRID, NODE_WIDTH } from './canvas/kinds.mjs';
import { snapToGrid } from './canvas/guides.mjs';
import { resolveShortcut } from './canvas/shortcuts.mjs';
import { effectiveTheme, loadThemeChoice, resolveHostTheme, saveThemeChoice, watchHostTheme } from './canvas/theme.mjs';

const EMPTY = { projects: [], revision: 0, projectId: null, events: [] };
const EMPTY_GRAPH = Object.freeze({ projectId: null, nodes: [], edges: [], layoutRevision: 0, viewport: null, commerceNetwork: null });
const NO_FILTERS = { query: '', kinds: new Set(), statuses: new Set() };
const IDLE_SYNC = { status: 'idle', message: '', pendingCount: 0 };
const publicState = (value) => { const { credential, ...rest } = value; return rest; };
const onboardingKey = (workspaceId) => `dsh-commerce-network:onboarding:${workspaceId}`;
const coarsePointer = () => Boolean(globalThis.matchMedia?.('(pointer: coarse)')?.matches);
let draftCounter = 0;

function BudgetDialog({ project, onClose, onSave, busy, error }) {
  const budget = project?.budget || {};
  const current = budget.maximumMinor ?? project?.maximumMinor ?? 0;
  const currency = budget.currency || project?.currency || 'USD';
  const [value, setValue] = useState((current / 100).toFixed(2));
  const minor = Math.round(Number(value) * 100);
  const valid = value.trim() !== '' && Number.isFinite(Number(value)) && Number.isSafeInteger(minor) && minor >= 0 && /^\d+(\.\d{0,2})?$/.test(value);
  return (
    <Dialog title="项目服务预算" onClose={onClose} footer={<><button type="button" className="cn-button" onClick={onClose}>返回</button><button type="button" className="cn-button cn-primary" disabled={!valid || busy} onClick={() => onSave({ maximumMinor: minor, currency })}>{busy ? '保存中…' : '确认预算上限'}</button></>}>
      <p>设置这个项目允许授权的服务费用上限。每项委托仍需单独批准；设置预算不会扣款。</p>
      {error && <p className="cn-danger-text" role="alert">{error}</p>}
      <div className="cn-budget-breakdown"><span>服务预留 <b>{money(budget.reservedMinor ?? 0, currency)}</b></span><span>已验收服务 <b>{money(budget.accruedMinor ?? 0, currency)}</b></span>{budget.riskHeldMinor > 0 && <span className="cn-danger-text">待核对的预留 <b>{money(budget.riskHeldMinor, currency)}</b></span>}</div>
      <label className="cn-field"><span>预算上限 · {currency}</span><input type="text" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} aria-label="项目服务预算上限" /></label>
      <p className="cn-field-note">设为 0 时，仅允许免费委托。已有服务预留会由服务端检查。</p>
    </Dialog>
  );
}

export function CommerceApp({ sessionId, active = true, submitPrompt, watchChanges, tabSignal, bindRefresh }) {
  const [state, setState] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [liveText, setLiveText] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [view, setView] = useState('all');
  const [tool, setTool] = useState(() => (coarsePointer() ? 'hand' : 'select'));
  const [filters, setFilters] = useState(NO_FILTERS);
  const [searchOpen, setSearchOpen] = useState(false);
  const [onlyRelated, setOnlyRelated] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [addMenu, setAddMenu] = useState(null);
  const [connect, setConnect] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [draftTick, setDraftTick] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [sync, setSync] = useState(IDLE_SYNC);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [themeChoice, setThemeChoice] = useState(() => loadThemeChoice());
  const [hostTheme, setHostTheme] = useState(() => resolveHostTheme());
  const [onboardingOpen, setOnboardingOpen] = useState(true);
  const [review, setReview] = useState(null);
  const [credential, setCredential] = useState(null);
  const [artifact, setArtifact] = useState(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [mandatesOpen, setMandatesOpen] = useState(false);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [promptPending, setPromptPending] = useState(false);

  const stateRef = useRef(state);
  const projectRef = useRef(null);
  const loadRef = useRef(null);
  const alive = useRef(true);
  const commandLock = useRef(false);
  const actions = useRef(null);
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const loadSequence = useRef(0);
  const abortLifetime = useRef(new AbortController());
  stateRef.current = state;

  const graph = useMemo(() => projectGraph(state), [state]);
  const surfaceGraph = graph || EMPTY_GRAPH;
  const saveableIds = useMemo(() => layoutNodeIdsFromState(state), [state]);
  const project = state.projects?.find((item) => item.id === state.projectId);
  const single = selectedIds.length === 1 ? graph?.nodes.find((node) => node.id === selectedIds[0]) || null : null;
  const selectedEdge = graph?.edges.find((edge) => edge.id === selectedEdgeId) || null;
  const theme = effectiveTheme(themeChoice, hostTheme);
  const scope = `${state.workspaceId || 'workspace'}:${state.projectId || 'none'}`;
  const workOrders = state.commerceNetwork?.workOrders || [];
  const decisions = workOrders.filter((order) => ['proposed', 'delivered'].includes(order.status));
  const running = workOrders.filter((order) => ['queued', 'claimed', 'running'].includes(order.status)).length;
  const budget = project?.budget || {};
  const matching = useMemo(() => matchingIds(graph?.nodes || [], { kinds: KINDS, statuses: STATUSES }, filters), [graph, filters]);
  const related = useMemo(() => (onlyRelated && selectedIds.length && graph ? relatedIds(graph.edges, selectedIds) : null), [onlyRelated, selectedIds, graph]);
  const kindCounts = useMemo(() => { const counts = {}; for (const node of graph?.nodes || []) counts[node.kind] = (counts[node.kind] || 0) + 1; return counts; }, [graph]);
  const inspectorOpen = Boolean(single || selectedEdge || membersOpen);
  const writable = surfaceGraph.commerceNetwork?.layoutWriteSupported === true;
  const movable = selectedIds.filter((id) => saveableIds.has(id)).length;

  const announce = useCallback((text) => setLiveText(text), []);
  const notify = useCallback((tone, text) => setToast({ tone, text }), []);

  const load = useCallback(async ({ quiet = false, projectId = projectRef.current } = {}) => {
    const sequence = ++loadSequence.current;
    loadRef.current?.abort();
    const controller = new AbortController();
    loadRef.current = controller;
    if (!quiet) setRefreshing(true);
    try {
      const params = new URLSearchParams({ sessionId, ...(projectId ? { projectId } : {}) });
      const next = stateFrom(await callApi(`/workspace?${params}`, { signal: controller.signal }));
      if (!alive.current || sequence !== loadSequence.current) return undefined;
      if (!Array.isArray(next.projects) || !Number.isSafeInteger(next.revision)) throw new Error('业务数据不完整，请检查插件服务。');
      if (next.projectId) {
        try { next.trade = unwrap(await callApi(`/trade?${new URLSearchParams({ sessionId, projectId: next.projectId })}`, { signal: controller.signal })); } catch (failure) { if (failure.name === 'AbortError') throw failure; next.tradeUnavailable = failure.message; }
      }
      if (!alive.current || sequence !== loadSequence.current) return undefined;
      projectRef.current = next.projectId || null;
      setState(publicState(next));
      if (!quiet) setError(null);
      return next;
    } catch (failure) {
      if (alive.current && sequence === loadSequence.current && failure.name !== 'AbortError') setError(errorText(failure));
      return undefined;
    } finally {
      if (alive.current && sequence === loadSequence.current) { setLoading(false); setRefreshing(false); }
    }
  }, [sessionId]);

  useEffect(() => {
    alive.current = true;
    projectRef.current = null;
    setState(EMPTY); setLoading(true); setMandatesOpen(false); setWorkbenchOpen(false); setImportOpen(false);
    setSelectedIds([]); setSelectedEdgeId(null); setCredential(null); setReview(null); setArtifact(null); setDrafts([]); setConnect(null); setAddMenu(null);
    const controller = new AbortController();
    abortLifetime.current = controller;
    const stop = () => { controller.abort(); loadRef.current?.abort(); };
    tabSignal?.addEventListener('abort', stop, { once: true });
    void load();
    return () => { alive.current = false; stop(); tabSignal?.removeEventListener('abort', stop); };
  }, [load, sessionId, tabSignal]);
  useEffect(() => {
    if (!active || review || credential) return undefined;
    const interval = setInterval(() => { if (document.visibilityState === 'visible' && !commandLock.current) void load({ quiet: true }); }, 6000);
    return () => clearInterval(interval);
  }, [active, load, review, credential]);
  useEffect(() => watchChanges?.(() => { if (active) void load({ quiet: true }); }), [active, load, watchChanges]);
  useEffect(() => bindRefresh?.(() => void load()), [bindRefresh, load]);
  useEffect(() => { if (!toast) return undefined; const timer = setTimeout(() => setToast(null), 6000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => watchHostTheme(setHostTheme), []);
  useEffect(() => {
    if (!state.workspaceId) return;
    try { setOnboardingOpen(globalThis.localStorage?.getItem(onboardingKey(state.workspaceId)) !== 'closed'); } catch { setOnboardingOpen(true); }
  }, [state.workspaceId]);

  const onAsk = useCallback(async (node, text) => {
    if (promptPending || !active) return { ok: false, reason: promptPending ? '上一项请求仍在提交。' : '请先切换到这个会话的画布。' };
    setPromptPending(true); setError(null);
    try {
      const instruction = nativeInstruction(projectRef.current, text || '请核对当前选中业务节点的最新状态、来源和下一步建议。先读取真实数据，不更改授权。', node);
      await submitPrompt(instruction, requestId(), abortLifetime.current.signal);
      if (alive.current) notify('success', '已交给当前 Assistant，请查看左侧会话。');
      return { ok: true };
    } catch (failure) {
      if (alive.current) setError(errorText(failure));
      return { ok: false, reason: errorText(failure) };
    } finally { if (alive.current) setPromptPending(false); }
  }, [active, promptPending, submitPrompt, notify]);

  const mutate = useCallback(async (command, payload, expectedRevision) => {
    if (commandLock.current) throw new Error('上一项操作仍在提交，请稍候。');
    commandLock.current = true; setBusy(true); setError(null);
    const projectId = projectRef.current;
    try {
      const response = await callApi('/command', { body: { sessionId, projectId, expectedRevision: expectedRevision ?? stateRef.current.revision, requestId: requestId(), command, payload }, signal: abortLifetime.current.signal });
      const data = unwrap(response);
      const next = stateFrom(response);
      if (alive.current && projectId === projectRef.current) { if (Array.isArray(next.projects)) setState(publicState(next)); else await load({ quiet: true }); }
      return data;
    } catch (failure) { if (alive.current) setError(errorText(failure)); throw failure; } finally { commandLock.current = false; if (alive.current) setBusy(false); }
  }, [sessionId, load]);

  const confirm = useCallback(async (command, record, reason) => {
    const payload = ['approve_mandate', 'revoke_mandate'].includes(command) ? { mandateId: record.id }
      : ['issue_agent_credential', 'revoke_agent'].includes(command) ? { agentServiceId: record.id }
        : { orderId: record.id, ...(['reject_delivery', 'resolve_failed_order'].includes(command) ? { reason } : {}), ...(command === 'approve_order' ? { reviewDigest: record.reviewDigest } : {}) };
    try {
      const result = await mutate(command, payload, record.networkRevision);
      setReview(null);
      if (result.credential?.token) setCredential(result.credential); else notify('success', '操作已保存，画布已读取最新状态。');
    } catch (failure) { setReview((current) => (current ? { ...current, error: errorText(failure) } : current)); }
  }, [mutate, notify]);

  const openReview = useCallback(async (command, record, revision) => {
    const currentRecord = { ...record, networkRevision: revision ?? stateRef.current.revision };
    setReview({ command, record: currentRecord, loading: command === 'approve_order' });
    if (command !== 'approve_order') return;
    try {
      const params = new URLSearchParams({ sessionId, projectId: projectRef.current, orderId: record.id });
      const snapshot = unwrap(await callApi(`/review?${params}`, { signal: abortLifetime.current.signal }));
      if (!snapshot.reviewDigest || snapshot.orderId !== record.id) throw new Error('未收到可核对的授权快照，请刷新后重试。');
      setReview((current) => (current?.command === command && current.record.id === record.id ? { command, record: { ...record, ...snapshot, id: record.id }, loading: false } : current));
    } catch (failure) {
      setError(errorText(failure));
      setReview((current) => (current?.command === command && current.record.id === record.id ? { ...current, loading: false, loadFailed: true, error: errorText(failure) } : current));
    }
  }, [sessionId]);

  const reloadReview = useCallback(async () => {
    if (!review || busy) return;
    const current = review;
    setReview({ ...current, loading: true, error: null });
    const next = await load();
    if (!next) { setReview((value) => (value ? { ...value, loading: false, error: '读取失败，请稍后重新核对。' } : value)); return; }
    const network = next.commerceNetwork || {};
    const updated = [...(network.workOrders || []), ...(network.agentServices || []), ...(network.salesAuthorizations || [])].find((record) => record.id === current.record.id);
    if (!updated) { setReview(null); setError('这项业务记录已经变化，请重新选择。'); return; }
    await openReview(current.command, updated, next.revision);
  }, [review, busy, load, openReview]);

  const saveLayout = useCallback(async (patch) => {
    const response = await callApi('/layout', { body: { ...patch, sessionId, requestId: requestId() }, signal: abortLifetime.current.signal });
    const value = unwrap(response);
    const next = stateFrom(response);
    return { layoutRevision: value.layoutRevision ?? value.receipt?.layoutRevision ?? next.canvasLayouts?.find((layout) => layout.projectId === patch.projectId)?.revision };
  }, [sessionId]);
  const reloadLatest = useCallback(() => load({ quiet: true }), [load]);

  const onSyncChange = useCallback((next) => setSync((current) => (current.status === next.status && current.message === next.message && current.pendingCount === next.pendingCount ? current : next)), []);
  const onHistoryChange = useCallback((next) => setHistory((current) => (current.canUndo === next.canUndo && current.canRedo === next.canRedo ? current : next)), []);

  const clearSelection = useCallback(() => actions.current?.clearSelection(), []);
  const selectionChanged = useCallback((ids) => {
    setSelectedIds(ids);
    if (ids.length) { setSelectedEdgeId(null); if (ids.length === 1) setMembersOpen(false); }
    if (ids.length === 1 && ids[0].startsWith('business_mandate:')) setMandatesOpen(ids[0].slice('business_mandate:'.length));
  }, []);
  const selectNode = useCallback((id) => { actions.current?.select([id]); setMembersOpen(false); setSelectedEdgeId(null); setTimeout(() => actions.current?.focus([id]), 0); }, []);
  const selectEdge = useCallback((id) => { setSelectedEdgeId(id); if (id) { actions.current?.clearSelection(); setMembersOpen(false); } }, []);
  const selectEvent = useCallback((reference) => {
    const node = graph?.nodes.find((candidate) => candidate.id === reference || candidate.refId === reference);
    if (!node) return;
    setView('all'); setFilters(NO_FILTERS); setOnlyRelated(false);
    setTimeout(() => selectNode(node.id), 0);
  }, [graph, selectNode]);
  const showDecisions = () => { const first = decisions[0]; if (first) selectEvent(`service_order:${first.id}`); };
  const focusRelated = useCallback(() => { if (!single) return; setView('all'); setFilters(NO_FILTERS); const ids = [...relatedIds(graph.edges, [single.id])]; setTimeout(() => actions.current?.focus(ids), 0); }, [single, graph]);
  const chooseProject = (event) => {
    projectRef.current = event.target.value || null;
    setSelectedIds([]); setSelectedEdgeId(null); setMembersOpen(false); setArtifact(null); setImportOpen(false); setDrafts([]); setFilters(NO_FILTERS); setSync(IDLE_SYNC);
    void load({ projectId: projectRef.current });
  };

  const stagePoint = (position) => ({ x: snapToGrid(position.x, GRID), y: snapToGrid(position.y, GRID) });
  const defaultPosition = useCallback(() => {
    const rect = stageRef.current?.getBoundingClientRect();
    const center = rect && actions.current?.screenToFlow({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    const offset = (drafts.length % 6) * 24;
    return stagePoint({ x: (center?.x ?? 0) - NODE_WIDTH / 2 + offset, y: (center?.y ?? 0) - 60 + offset });
  }, [drafts.length]);

  const startRequest = useCallback(async ({ kind, title, prompt, position, source }) => {
    const id = `d${Date.now().toString(36)}${draftCounter++}`;
    const target = position ? stagePoint(position) : defaultPosition();
    if (kind) setDrafts((current) => addDraft(current, { ...createDraft({ id, kind, title, position: target, anchorId: source?.id || null, nodes: graph?.nodes || [], now: Date.now() }), request: { kind, title, prompt, source } }));
    const outcome = await onAsk(source || null, prompt);
    if (kind) setDrafts((current) => settleDraft(current, id, outcome).map((draft) => (draft.id === id && !outcome.ok ? { ...draft, retryable: true } : draft)));
    return outcome;
  }, [onAsk, defaultPosition, graph]);
  const retryDraft = useCallback((draft) => {
    setDrafts((current) => dismissDraft(current, draft.id));
    if (draft.request) void startRequest({ ...draft.request, position: draft.position });
  }, [startRequest]);
  const removeDraft = useCallback((id) => setDrafts((current) => dismissDraft(current, id)), []);

  useEffect(() => {
    if (!drafts.some((draft) => draft.status === 'waiting')) return undefined;
    const timer = setInterval(() => setDraftTick((value) => value + 1), 15_000);
    return () => clearInterval(timer);
  }, [drafts]);
  useEffect(() => {
    if (!drafts.length) return;
    const { drafts: remaining, resolved } = reconcileDrafts(drafts, graph?.nodes || [], Date.now());
    if (!resolved.length && remaining.length === drafts.length && remaining.every((draft, index) => draft === drafts[index])) return;
    setDrafts(remaining);
    for (const { draft, nodeId } of resolved) {
      if (saveableIds.has(nodeId)) actions.current?.place(nodeId, draft.position);
      announce(`${draft.title}已保存为真实节点`);
    }
  }, [graph, draftTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeAddMenu = useCallback(() => setAddMenu(null), []);
  const openAddMenu = useCallback((next) => { setSearchOpen(false); setAddMenu(next); }, []);
  const addSections = useMemo(() => {
    if (!addMenu) return [];
    const icons = { business_mandate: 'mandate', service_order: 'order' };
    if (addMenu.source) {
      return [{ title: `从「${addMenu.source.title}」延伸`, items: suggestionsFrom(addMenu.source).map((suggestion) => ({
        id: suggestion.id, icon: icons[suggestion.draftKind] || 'review', label: suggestion.label, description: suggestion.description,
        run: () => { setAddMenu(null); void startRequest({ kind: suggestion.draftKind, title: suggestion.label, prompt: suggestion.prompt, position: addMenu.position, source: addMenu.source }); },
      })) }];
    }
    return ADD_GROUPS.map((group) => ({
      title: group,
      items: ADD_ITEMS.filter((item) => item.group === group).map((item) => {
        const availability = itemAvailability(item, { kindCounts, hasProject: Boolean(project), pending: promptPending, active });
        return {
          id: item.id, label: item.label, description: item.description, disabled: !availability.enabled, reason: availability.reason,
          run: () => {
            setAddMenu(null);
            if (item.action === 'import-rfq') setImportOpen(true);
            else void startRequest({ kind: item.draftKind, title: item.label, prompt: item.prompt, position: addMenu.position });
          },
        };
      }),
    })).filter((section) => section.items.length);
  }, [addMenu, kindCounts, project, promptPending, active, startRequest]);

  const connectNodes = useCallback((source, target, rule) => setConnect({ source, target, rule }), []);
  const confirmConnect = useCallback(async () => {
    const { source, target, rule } = connect;
    const position = { x: target.position.x + NODE_WIDTH + 80, y: target.position.y };
    const outcome = await startRequest({ kind: rule.draftKind, title: rule.label, prompt: connectionPrompt(rule, source, target), position, source });
    if (outcome.ok) setConnect(null);
  }, [connect, startRequest]);
  const dropConnection = useCallback(({ source, client, position }) => {
    if (!suggestionsFrom(source).length) { notify('warning', '这类节点不能作为连线起点；交易链路由交易系统生成。'); return; }
    openAddMenu({ placement: 'point', point: client, position: { x: position.x - NODE_WIDTH / 2, y: position.y - 40 }, source });
  }, [notify, openAddMenu]);
  const doubleClickPane = useCallback(({ client, position }) => openAddMenu({ placement: 'point', point: client, position: { x: position.x - NODE_WIDTH / 2, y: position.y - 40 } }), [openAddMenu]);

  const pickResult = useCallback((node) => {
    setSearchOpen(false); setView('all'); setFilters((current) => ({ ...current, query: '' }));
    setTimeout(() => selectNode(node.id), 0);
  }, [selectNode]);
  const clearFilters = () => { setFilters(NO_FILTERS); setSearchOpen(false); };
  const dismissOnboarding = () => {
    setOnboardingOpen(false);
    try { globalThis.localStorage?.setItem(onboardingKey(state.workspaceId), 'closed'); } catch { /* A blocked store only forgets the dismissal. */ }
  };
  const changeTheme = (choice) => { setThemeChoice(choice); saveThemeChoice(choice); };

  const escape = () => {
    if (addMenu) setAddMenu(null);
    else if (searchOpen) setSearchOpen(false);
    else if (helpOpen) setHelpOpen(false);
    else if (activityOpen) setActivityOpen(false);
    else if (membersOpen) setMembersOpen(false);
    else if (selectedEdgeId) setSelectedEdgeId(null);
    else if (selectedIds.length) clearSelection();
    else if (hasActiveFilter(filters)) setFilters(NO_FILTERS);
  };
  const onKeyDown = (event) => {
    const result = resolveShortcut(event.nativeEvent, { canvasFocused: event.target === rootRef.current });
    if (!result) return;
    const run = actions.current;
    const handled = (() => {
      switch (result.id) {
        case 'tool.select': setTool('select'); return true;
        case 'tool.hand': setTool('hand'); return true;
        case 'add.open': openAddMenu({ placement: 'toolbar' }); return true;
        case 'search.open': setAddMenu(null); setSearchOpen(true); return true;
        case 'select.all': run?.selectAll(); return true;
        case 'inspect.open': rootRef.current?.querySelector('.cn-inspector [role="tab"][tabindex="0"]')?.focus(); return Boolean(single);
        case 'escape': escape(); return true;
        case 'nudge': return Boolean(run?.nudge(result.payload.dx, result.payload.dy));
        case 'history.undo': run?.undo(); return true;
        case 'history.redo': run?.redo(); return true;
        case 'view.fit': run?.fit(); return true;
        case 'view.focus': run?.focusSelection(); return true;
        case 'view.zoomIn': run?.zoomIn(); return true;
        case 'view.zoomOut': run?.zoomOut(); return true;
        case 'view.zoomReset': run?.zoomTo(1); return true;
        case 'help.open': setHelpOpen(true); return true;
        default: return false;
      }
    })();
    if (handled) event.preventDefault();
  };

  const stageBounds = stageRef.current?.getBoundingClientRect();
  const noMatches = matching && matching.size === 0;
  const showOnboarding = !loading && !error && !(graph?.nodes.length) && onboardingOpen;

  return (
    <section className="cn" data-theme={theme} ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown} aria-label="Commerce Network 商业协作画布">
      <style>{flowCss}{appCss}{canvasCss}</style>
      {importOpen && project && <ImportRfq sessionId={sessionId} projectId={state.projectId} onClose={() => setImportOpen(false)} onRefresh={() => void load()} />}
      <TopBar
        projects={state.projects || []} projectId={state.projectId} onProject={chooseProject} view={view} onView={(next) => { setView(next); clearSelection(); }}
        sync={sync} loading={loading} workspaceId={state.workspaceId} onRetry={() => void actions.current?.retry()}
        decisions={decisions.length} onDecisions={showDecisions} hasProject={Boolean(project)} budgetText={money(budget.maximumMinor ?? project?.maximumMinor ?? 0, budget.currency || project?.currency || 'USD')}
        onBudget={() => { setError(null); setBudgetOpen(true); }} onWorkbench={() => setWorkbenchOpen(true)} onMandates={() => setMandatesOpen(true)} onImport={() => setImportOpen(true)}
        refreshing={refreshing} onRefresh={() => void load()} membersOpen={membersOpen} onMembers={() => { setMembersOpen((value) => !value); clearSelection(); setSelectedEdgeId(null); }}
        themeChoice={themeChoice} onTheme={changeTheme} onHelp={() => setHelpOpen(true)} activityOpen={activityOpen} onActivity={() => setActivityOpen((value) => !value)}
      />
      <div className="cv-banners">
        {state.tradeUnavailable && <Banner tone="error">交易投影读取失败：{state.tradeUnavailable}</Banner>}
        {state.trade?.truncated && <Banner>当前画布只显示部分交易记录，请通过原生会话分页读取完整记录。</Banner>}
        {state.trade && Object.values(state.trade.dependencies || {}).some((value) => value !== 'available') && <Banner>部分交易插件尚未加载，相关记录暂不可读取。</Banner>}
        {sync.status === 'conflict' && <Banner tone="warning" action={<span className="cv-banner-actions"><button type="button" className="cn-button" onClick={() => void actions.current?.resolveConflict('latest')}>载入最新</button><button type="button" className="cn-button cn-primary" onClick={() => void actions.current?.resolveConflict('mine')}>保留我的</button></span>}>{sync.message}</Banner>}
        {sync.status === 'error' && <Banner tone="error" action={<button type="button" className="cn-button" onClick={() => void actions.current?.retry()}>重试保存</button>}>{sync.message}</Banner>}
        {sync.status === 'offline' && state.workspaceId && <Banner tone="warning">{sync.message}</Banner>}
        {sync.status === 'readonly' && graph && <Banner>当前服务未开放布局保存，节点位置仅供查看。</Banner>}
        {hasActiveFilter(filters) && !searchOpen && <Banner tone={noMatches ? 'warning' : 'info'} action={<button type="button" className="cn-button" onClick={clearFilters}>清除筛选</button>}>{noMatches ? '没有节点符合当前筛选。' : `筛选中：${matching.size} 个节点匹配，其余已淡化。`}</Banner>}
        {error && !loading && graph && <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner>}
        {toast && <Banner tone={toast.tone} onDismiss={() => setToast(null)}>{toast.text}</Banner>}
      </div>
      <ReactFlowProvider key={`${sessionId}:${surfaceGraph.projectId}`}>
        <div className={`cv-stage${inspectorOpen ? ' cv-has-side' : ''}${activityOpen ? ' cv-has-drawer' : ''}`} ref={stageRef}>
          <CanvasSurface
            graph={surfaceGraph} saveableIds={saveableIds} scope={scope} view={view} tool={tool} matching={matching} related={related} drafts={drafts}
            selectedEdgeId={selectedEdgeId} showMap={showMap} showEdgeLabels={showLabels} inspectorOpen={inspectorOpen}
            onSelectionChange={selectionChanged} onSelectEdge={selectEdge} onOpenNode={() => actions.current && rootRef.current?.querySelector('.cn-inspector [role="tab"][tabindex="0"]')?.focus()}
            onAsk={onAsk} onConnectNodes={connectNodes} onConnectDrop={dropConnection} onConnectRefused={(reason) => notify('warning', reason)} onPaneDoubleClick={doubleClickPane}
            onDraftDismiss={removeDraft} onDraftRetry={retryDraft} onSaveLayout={saveLayout} onReload={reloadLatest} onSyncChange={onSyncChange} onHistoryChange={onHistoryChange}
            announce={announce} actionRef={actions}
          />
          {loading && <div className="cv-loading" role="status"><LoaderCircle className="cn-spin" size={22} /><p>正在读取工作区…</p></div>}
          {!loading && error && !graph && <div className="cv-loading cv-loading-error" role="alert"><AlertCircle size={26} /><h2>暂时无法打开工作区</h2><p>{error}</p><button type="button" className="cn-button" onClick={() => void load()}><RefreshCw size={15} />重新读取</button></div>}
          {showOnboarding && <Onboarding hasProject={Boolean(project)} pending={promptPending} onAsk={onAsk} onDismiss={dismissOnboarding} />}
          {selectedIds.length > 1 && <SelectionBar count={selectedIds.length} movable={movable} writable={writable} onAlign={(mode) => actions.current?.align(mode)} onClear={clearSelection} />}
          <FloatingToolbar
            tool={tool} onTool={setTool} onAdd={() => (addMenu ? setAddMenu(null) : openAddMenu({ placement: 'toolbar' }))} addHint={!onboardingOpen && !graph?.nodes.length} addDisabled={loading}
            onSearch={() => { setAddMenu(null); setSearchOpen((value) => !value); }} searchActive={searchOpen || hasActiveFilter(filters)}
            canUndo={history.canUndo} canRedo={history.canRedo} onUndo={() => actions.current?.undo()} onRedo={() => actions.current?.redo()}
            onArrange={() => actions.current?.arrange()} canArrange={writable && Boolean(graph?.nodes.length)}
            showMap={showMap} onToggleMap={() => setShowMap((value) => !value)} showLabels={showLabels} onToggleLabels={() => setShowLabels((value) => !value)}
            onlyRelated={onlyRelated} onToggleRelated={() => setOnlyRelated((value) => !value)} relatedDisabled={!selectedIds.length} onHelp={() => setHelpOpen(true)}
          />
          <ZoomControl actions={actions} />
          {searchOpen && graph && <SearchPalette nodes={graph.nodes} filters={filters} onFilters={setFilters} onPick={pickResult} onClose={() => setSearchOpen(false)} view={view} />}
          {addMenu && <AddMenu title={addMenu.source ? '延伸这个节点' : '添加到网络'} sections={addSections} placement={addMenu.placement} point={addMenu.point} bounds={stageBounds} onClose={closeAddMenu} />}
          {single?.tradeRecord
            ? <TradeInspector key={`${sessionId}:${single.id}`} node={single} sessionId={sessionId} workspaceId={state.workspaceId} onClose={clearSelection} onAsk={onAsk} onRefresh={() => void load()} />
            : single && <Inspector key={single.id} node={single} state={state} graph={graph} busy={busy} onClose={clearSelection} onAsk={onAsk} onAction={openReview} onFocus={focusRelated} onArtifact={setArtifact} onSelectNode={selectNode} onSelectEdge={selectEdge} />}
          {selectedEdge && !single && !membersOpen && <RelationshipInspector edge={selectedEdge} graph={graph} state={state} busy={busy} onClose={() => setSelectedEdgeId(null)} onAsk={onAsk} onAction={openReview} />}
          {membersOpen && !single && <MembersPanel state={state} onClose={() => setMembersOpen(false)} onAsk={onAsk} onSelect={selectNode} />}
          {activityOpen && <ActivityDrawer state={state} onClose={() => setActivityOpen(false)} onSelect={selectEvent} />}
        </div>
      </ReactFlowProvider>
      <footer className="cv-footer">
        <button type="button" className={activityOpen ? 'cn-active' : ''} aria-pressed={activityOpen} onClick={() => setActivityOpen((value) => !value)}>协作动态{running > 0 && <b>{running} 项进行中</b>}</button>
        {graph?.nodes.length > 0 && <small className="cn-mono">{graph.nodes.length} 个节点 · {graph.edges.length} 条关系</small>}
        <small className="cv-footer-hint">按 <kbd>?</kbd> 查看快捷键</small>
      </footer>
      <div className="cn-sr-only" role="status" aria-live="polite">{liveText}</div>
      {workbenchOpen && <BusinessWorkbench key={`${sessionId}:${state.workspaceId}:${state.projectId}`} state={state} sessionId={sessionId} onClose={() => setWorkbenchOpen(false)} onChanged={(projectId) => load({ projectId })} onMandate={(id) => { setWorkbenchOpen(false); setMandatesOpen(id); }} onWork={(id) => { setWorkbenchOpen(false); setView('all'); selectEvent(`service_order:${id}`); }} onArtifact={(delivery) => { setWorkbenchOpen(false); setArtifact(delivery); }} onAsk={onAsk} promptPending={promptPending} active={active} />}
      {mandatesOpen && <Mandates key={`${sessionId}:${state.workspaceId}`} state={state} sessionId={sessionId} initialId={typeof mandatesOpen === 'string' ? mandatesOpen : null} onClose={() => setMandatesOpen(false)} onChanged={(projectId) => load({ projectId })} />}
      {review && <ReviewDialog review={review} onClose={() => { if (!busy) setReview(null); }} onConfirm={confirm} onReload={reloadReview} busy={busy} />}
      {credential && <CredentialDialog credential={credential} onClose={() => setCredential(null)} onError={setError} />}
      {artifact && <ArtifactDialog key={`${sessionId}:${state.projectId}:${artifact.id}`} artifact={artifact} sessionId={sessionId} projectId={state.projectId} onClose={() => setArtifact(null)} />}
      {budgetOpen && <BudgetDialog project={project} busy={busy} error={error} onClose={() => setBudgetOpen(false)} onSave={async (payload) => { try { await mutate('set_budget', payload); setBudgetOpen(false); notify('success', '项目预算已更新。'); } catch { /* The dialog shows the service error. */ } }} />}
      {connect && <ConnectDialog rule={connect.rule} source={connect.source} target={connect.target} busy={promptPending} onClose={() => setConnect(null)} onConfirm={() => void confirmConnect()} />}
      {helpOpen && <ShortcutsDialog onClose={() => setHelpOpen(false)} />}
    </section>
  );
}
