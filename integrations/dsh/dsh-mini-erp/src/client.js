import { assistants, assistantModule, assistantPrompt, launchAssistant } from './assistant.js';
import React, { useState, useEffect, useRef } from 'react';
import { ProductEditorSurface, FileSurface, CompanySettingsSurface } from 'dsh-workspace-library';
import { Theme, Card, Button, TextField, TextArea, Badge, Table, Progress, AlertDialog } from '@radix-ui/themes';
import { House, ChartNoAxesCombined, Settings2, Store, ShoppingCart, Layers, Warehouse, ArrowLeftRight, Gift, ListFilter, Megaphone, Zap, BadgePercent, Globe2, Activity, Wallet, Palette, LayoutGrid, Truck, MapPin, Bell, ChevronDown, Download, Package, UsersRound, ClipboardList, FolderOpen, FileText, Menu, Plus, Search, RefreshCw, ArrowRight, ArrowLeft, X, Link2, CircleHelp, Check } from 'lucide-react';
import radixStyles from 'erp:radix-css';
import fontStyles from './fonts.css';
import styles from './theme.css';
const h = React.createElement, API = '/mini-erp-api', NS = 'mini-erp';
const icons = {home:House,chart:ChartNoAxesCombined,settings:Settings2,store:Store,cart:ShoppingCart,collection:Layers,inventory:Warehouse,transfer:ArrowLeftRight,gift:Gift,segments:ListFilter,marketing:Megaphone,automation:Zap,discount:BadgePercent,globe:Globe2,activity:Activity,wallet:Wallet,palette:Palette,apps:LayoutGrid,truck:Truck,pin:MapPin,bell:Bell,down:ChevronDown,download:Download,product:Package,buyer:UsersRound,order:ClipboardList,folder:FolderOpen,document:FileText,menu:Menu,plus:Plus,search:Search,refresh:RefreshCw,arrow:ArrowRight,back:ArrowLeft,close:X,link:Link2,info:CircleHelp,check:Check};
function Icon({name,size=20}) { return h(icons[name] || Package, {className:'me-icon','data-icon':name,size,strokeWidth:1.65,'aria-hidden':true,focusable:false}); }
const ERPInput = React.forwardRef((props, ref) => ['checkbox','radio','file','hidden'].includes(props.type) ? h('input', {...props,ref}) : h(TextField.Root, {size:'2',variant:'surface',...props,ref}));
const ERPButton = React.forwardRef(({className='',...props}, ref) => h(Button, {size:'2',variant:/primary/.test(className)?'solid':/plain|text-button/.test(className)?'ghost':'surface',color:/primary/.test(className)?undefined:'gray',...props,ref,className}));
const Surface = React.forwardRef(({as='section',...props}, ref) => h(Card,{asChild:true,size:'2',variant:'surface'},h(as,{...props,ref})));
function ERPTheme({appearance, ...props}) {
  const ref = useRef(null), [inherited, setInherited] = useState('dark');
  useEffect(() => {
    if (appearance !== 'system') return;
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const read = () => {
      const scheme = getComputedStyle(ref.current.parentElement).colorScheme;
      setInherited(scheme === 'light' ? 'light' : scheme === 'dark' ? 'dark' : media?.matches === false ? 'light' : 'dark');
    };
    read();
    const observer = new MutationObserver(read);
    for (let node = ref.current.parentElement; node; node = node.parentElement) observer.observe(node, {attributes:true,attributeFilter:['class','style','data-theme','data-color-scheme']});
    media?.addEventListener('change', read);
    return () => {observer.disconnect();media?.removeEventListener('change', read);};
  }, [appearance]);
  return h(Theme, {...props, ref, appearance:appearance === 'system' ? inherited : appearance});
}
const libraryUI = { Input: ERPInput, TextArea, Button: ERPButton, Card: React.forwardRef((props,ref)=>h(Surface,{as:'div',...props,ref})) };
  function DiscardDialog({ request, onResolve }) {
    const accepted = useRef(false);
    return h(AlertDialog.Root, { open: true, onOpenChange: open => { if (!open) onResolve(false); } },
      h(AlertDialog.Content, { container: document.querySelector('.me'), className: 'me-discard-dialog', size: '3', 'aria-modal': true,
        onEscapeKeyDown: event => event.stopPropagation(),
        onCloseAutoFocus: event => {
          event.preventDefault();
          setTimeout(() => {
            if (document.querySelector('.me-discard-dialog')) return;
            const target = !accepted.current && request.returnFocus?.isConnected ? request.returnFocus : document.querySelector('.me-main h1');
            target?.focus({ preventScroll: true });
          }, 0);
        } },
        h('div', { className: 'me-discard-body' }, h('div', { className: 'me-discard-mark' }, h(Icon, { name: 'document', size: 23 })),
          h(AlertDialog.Title, { className: 'me-discard-title' }, '放弃未保存的更改？'),
          h(AlertDialog.Description, { className: 'me-discard-description' }, '这些更改尚未保存。你可以继续编辑，或放弃本次更改后离开。')),
        h('div', { className: 'me-discard-actions' },
          h(AlertDialog.Cancel, null, button('继续编辑', () => onResolve(false))),
          h(AlertDialog.Action, null, button('放弃更改', () => { accepted.current = true; onResolve(true); }, { variant: 'solid', color: 'red', className: 'me-button-danger' })))));
  }
  async function request(path, body, signal) {
    const response = await fetch(API + path, { credentials: 'same-origin', cache: 'no-store', signal,
      ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      const messages = { CATALOG_CHANGED: '商品资料已更新，请核对新报价后重新提交。', REVISION_CONFLICT: '供应数量已更新，请重新读取后提交。', CUSTOMER_CHANGED: '客户资料已被修改，请返回列表重新读取后再编辑。',
        QUOTE_REQUIRED: '当前数量没有可用报价，请核对起订量和价格档。', OUT_OF_STOCK: '可供应数量不足，请调整采购数量。',
        NO_SLOTS: '这个供货名额已满或已截止，请重新选择。', ALREADY_HELD: '该客户已持有此供货权益，请查看已有订单。',
        CATALOG_UNAVAILABLE: '商品资料已归档或不可用，请核对原产品库。', ORDER_STATE: '订单状态已变化，请重新读取订单。' };
      const error = new Error(messages[result.error?.code] || result.error?.message || `HTTP ${response.status}`);
      error.code = result.error?.code; error.status = response.status;
      error.rejected = response.status >= 400 && response.status < 500 && result.ok === false && error.code !== 'IDEMPOTENCY_CONFLICT';
      throw error;
    }
    return result.data;
  }
  const labels = { order: '订单', product: '库存', buyer: '客户' };
  const descriptions = {
    product: '管理商品报价、采购条件与可供应数量。', buyer: '查看客户资料，保持每一笔交易的客户信息清晰。',
    order: '跟进采购预留，确认订单或释放尚未成交的数量。',
  };
  const states = { reserved: '已预留', confirmed: '已确认', cancelled: '已取消', expired: '已到期', linked: '已关联', unavailable: '来源不可用', 'legacy-unlinked': '待关联' };
  const button = (label, onClick, options = {}) => {
    const { icon, className = '', ...props } = options;
    return h(ERPButton, { type: 'button', className: `me-button ${className}`, onClick,
      ...(!label && props['aria-label'] ? { title: props['aria-label'] } : {}), ...props },
      icon ? h(Icon, { name: icon, size: 16 }) : null, label);
  };
  const field = (label, node, hint) => h('label', { className: 'me-field' }, h('span', null, label), node, hint ? h('small', null, hint) : null);
  const badge = (value, text) => h(Badge, { size: '1', variant: 'soft', color: ['linked','confirmed','active'].includes(value) ? 'green' : ['reserved','draft'].includes(value) ? 'amber' : 'gray', className: `me-badge me-badge-${value || 'neutral'}` }, text || states[value] || value);
  const money = (value, currency) => value == null ? '待询价' : `${currency} ${(value / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const price = row => money(row.unitPriceMinor, row.currency);
  const shortId = id => `#${id.slice(0, 8)}`;
  const clock = value => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '';
  const imageUrl = (row, img) => `/workspace-library-api/products/${encodeURIComponent(row.catalogProductId)}/images/${encodeURIComponent(img.id)}`;
  function EmptyArtwork({ entity }) {
    return h('div', { className: 'me-empty-icon', 'aria-hidden': true }, h(Icon, { name: entity, size: 30 }));
  }
  // Only submitted commands are retained, scoped to this browser tab and workspace.
  // An uncertain reply freezes the command until the same request can be replayed.
  function useSubmission(workspace, action, onSaved, onBusy, recordId = '') {
    const storageKey = `mini-erp:pending:${workspace}:${action}${recordId ? `:${recordId}` : ''}`;
    const [initial] = useState(() => {
      try {
        const raw = window.sessionStorage.getItem(storageKey);
        if (!raw) return { pending: null };
        const record = JSON.parse(raw);
        if (record.workspace !== workspace || record.body?.action !== action || recordId && record.body.id !== recordId || typeof record.body.requestId !== 'string') throw new Error('invalid recovery record');
        return { pending: record.body };
      } catch { return { pending: null, storageError: '无法读取上次提交的重试记录。请先核对已有记录，再处理浏览器存储。' }; }
    });
    const [pending, setPending] = useState(initial.pending), [error, setError] = useState(null), [busy, setBusy] = useState(false);
    const flight = useRef(false), alive = useRef(true), saved = useRef(initial.pending);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    async function submit(input) {
      if (flight.current || initial.storageError) return;
      const retrying = !!saved.current;
      const body = saved.current || { ...input, action, requestId: crypto.randomUUID() };
      try { window.sessionStorage.setItem(storageKey, JSON.stringify({ workspace, body })); }
      catch { setError(new Error('无法保存重试信息，本次尚未提交。请检查浏览器存储后重试。')); return; }
      saved.current = body; setPending(body); flight.current = true; setBusy(true); setError(null); onBusy?.(true);
      try {
        const receipt = await request(`/workspaces/${encodeURIComponent(workspace)}/command`, body);
        window.sessionStorage.removeItem(storageKey); saved.current = null;
        if (alive.current) { setPending(null); onSaved(receipt); }
      } catch (e) {
        // Losing authentication during a retry says nothing about the original commit.
        if (e.rejected && (!retrying || e.status === 409 && e.code !== 'WORKSPACE_REQUIRED')) {
          try { window.sessionStorage.removeItem(storageKey); saved.current = null; if (alive.current) setPending(null); }
          catch { e = new Error('提交被拒绝，但无法清理重试记录。请恢复浏览器存储后重试同一次提交。'); }
        }
        if (alive.current) setError(e);
      } finally { flight.current = false; onBusy?.(false); if (alive.current) setBusy(false); }
    }
    return { pending, initial: initial.pending, error, busy, blocked: !!initial.storageError, storageError: initial.storageError, submit };
  }
  function SubmissionNotice({ submission }) {
    const s = submission;
    return h(React.Fragment, null,
      s.storageError ? h('div', { className: 'me-alert me-alert-error', role: 'alert' }, s.storageError) : null,
      s.error ? h('div', { className: 'me-alert me-alert-error', role: 'alert' }, s.error.message) : null,
      s.pending && !s.busy ? h('div', { className: 'me-alert', role: 'status' }, h(Icon, { name: 'info' }), h('div', null,
        h('strong', null, '上次提交的结果尚未确认'), h('p', null, '重试会核对同一次提交，不会另建一笔。当前参数已锁定；刷新页面后仍可继续核对。'),
        h('small', null, `请求编号 ${s.pending.requestId}`))) : null);
  }
  function CustomerComposer({ workspace, customer, onSaved, onClose, onBusy, onDirtyChange }) {
    const s = useSubmission(workspace, customer ? 'update_buyer' : 'add_buyer', onSaved, onBusy, customer?.id);
    const [initial] = useState(() => s.initial || customer || {});
    const [id] = useState(() => initial.id || crypto.randomUUID());
    const [name, setName] = useState(initial.name || ''), [email, setEmail] = useState(initial.email || '');
    const [phone, setPhone] = useState(initial.phone || ''), [note, setNote] = useState(initial.note || '');
    const dirty = [name, email, phone, note].some((v, i) => v !== (initial[['name', 'email', 'phone', 'note'][i]] || ''));
    useEffect(() => { onDirtyChange?.(dirty && !s.pending); return () => onDirtyChange?.(false); }, [dirty, !!s.pending]);
    const locked = s.busy || !!s.pending || s.blocked;
    function submit(e) {
      e.preventDefault(); if (locked || !name.trim()) return;
      s.submit({ id, name: name.trim(), email: email.trim(), phone: phone.trim(), note: note.trim(),
        ...(customer ? { expectedRevision: initial.expectedRevision ?? initial.revision } : {}) });
    }
    return h('form', { className: 'me-compose me-customer-compose', onSubmit: submit },
      h(SubmissionNotice, { submission: s }),
      h('div', { className: 'me-detail-grid' },
        h(Surface, { className: 'me-card' }, h('div', { className: 'me-card-header' }, h('h2', null, '客户信息')),
          h('fieldset', { disabled: locked, className: 'me-card-body me-compose-fields' },
            field('姓名', h(ERPInput, { name: 'customerName', autoComplete: 'name', required: true, maxLength: 500, value: name, onChange: e => setName(e.target.value) })),
            field('邮箱', h(ERPInput, { name: 'customerEmail', type: 'email', autoComplete: 'email', maxLength: 254, value: email, onChange: e => setEmail(e.target.value) })),
            field('电话号码', h(ERPInput, { name: 'customerPhone', type: 'tel', autoComplete: 'tel', maxLength: 50, value: phone, onChange: e => setPhone(e.target.value) })),
            customer?.legacyContact || s.initial?.contact ? h('p', { className: 'me-help' }, '原联系方式：', customer?.legacyContact || s.initial.contact) : null)),
        h(Surface, { className: 'me-card' }, h('div', { className: 'me-card-header' }, h('h2', null, '备注')),
          h('fieldset', { disabled: locked, className: 'me-card-body me-compose-fields' },
            field('客户备注', h(TextArea, { name: 'customerNote', rows: 6, maxLength: 2000, value: note, onChange: e => setNote(e.target.value) }), '仅供内部查看。')))),
      h('div', { className: 'me-compose-footer' }, dirty && !s.pending ? h('span', { className: 'me-save-state' }, '有未保存的更改') : null,
        button(s.pending ? '稍后核对' : '取消', onClose, { disabled: s.busy }),
        s.pending ? button(s.busy ? '正在核对…' : '重试同一次提交', () => s.submit(), { disabled: s.busy, className: 'me-button-primary' })
          : button('保存客户', undefined, { type: 'submit', disabled: s.blocked || !name.trim(), className: 'me-button-primary' })));
  }
  function useChoices(workspace, entity, filters = {}, enabled = true) {
    const key = JSON.stringify([workspace, entity, filters, enabled]);
    const active = useRef(key); active.current = key;
    const [state, setState] = useState({ key, items: [], loading: enabled });
    const current = state.key === key ? state : { key, items: [], loading: enabled };
    async function load(afterId, signal) {
      setState(old => ({ ...old, key, loading: true, error: '' }));
      try {
        const params = new URLSearchParams({ entity, limit: '50', ...filters, ...(afterId ? { afterId } : {}) });
        const result = await request(`/workspaces/${encodeURIComponent(workspace)}/read?${params}`, null, signal);
        if (active.current === key && !signal?.aborted) setState(old => ({ ...result, key, loading: false, items: afterId ? [...old.items, ...result.items] : result.items }));
      } catch (e) { if (active.current === key && !signal?.aborted) setState(old => ({ ...old, key, loading: false, error: e.message })); }
    }
    useEffect(() => {
      setState({ key, items: [], loading: enabled });
      if (!enabled) return;
      const a = new AbortController(); load(null, a.signal); return () => a.abort();
    }, [key]);
    return { ...current, more: () => { if (!current.loading) load(current.nextCursor); }, retry: () => load(null) };
  }
  function Choice({ label, name, value, onChange, choices, disabled, textOf }) {
    return h('div', { className: 'me-choice' }, field(label,
      h('select', { name, required: true, value, disabled: disabled || choices.loading && !choices.items.length, onChange: e => onChange(e.target.value) },
        h('option', { value: '' }, choices.loading && !choices.items.length ? '正在读取…' : `选择${label}`),
        value && !choices.items.some(row => row.id === value) ? h('option', { value }, value) : null,
        choices.items.map(row => h('option', { key: row.id, value: row.id }, textOf(row)))),
      choices.items.length ? `已读取 ${choices.items.length} 条${choices.hasMore ? '，还有更多记录' : ''}` : choices.loading ? '' : '当前工作区还没有可选记录。'),
      choices.error ? h('p', { role: 'alert', className: 'me-help' }, choices.error, ' ', button('重新读取', choices.retry, { disabled, className: 'me-text-button' })) : null,
      choices.hasMore ? button(choices.loading ? '正在读取…' : '加载更多', choices.more, { disabled: disabled || choices.loading, className: 'me-text-button' }) : null);
  }
  function OrderComposer({ workspace, initialProductId = '', initialBuyerId = '', onSaved, onClose, onBusy, onDirtyChange }) {
    const s = useSubmission(workspace, 'reserve', onSaved, onBusy);
    const [buyerId, setBuyerId] = useState(s.initial?.buyerId || initialBuyerId), [productId, setProductId] = useState(s.initial?.productId || initialProductId);
    const [quantity, setQuantity] = useState(String(s.initial?.quantity || 1)), [holdMinutes, setHoldMinutes] = useState(String(s.initial?.holdMinutes || 60));
    const draftSignature = JSON.stringify([buyerId, productId, quantity, holdMinutes]);
    const initialDraft = useRef(draftSignature);
    useEffect(() => { onDirtyChange?.(draftSignature !== initialDraft.current && !s.pending); return () => onDirtyChange?.(false); }, [draftSignature, !!s.pending]);
    const [quote, setQuote] = useState(null), [quoteError, setQuoteError] = useState(''), [quoteNonce, refreshQuote] = useState(0);
    const buyers = useChoices(workspace, 'buyer'), products = useChoices(workspace, 'product');
    const q = Number(quantity), minutes = Number(holdMinutes), validQuantity = Number.isSafeInteger(q) && q > 0 && q <= 1e9;
    const quoteKey = JSON.stringify([workspace, productId, q, quoteNonce]);
    useEffect(() => {
      setQuote(null); setQuoteError('');
      if (!productId || !validQuantity || s.pending) return;
      const a = new AbortController();
      const timer = setTimeout(() => {
        const params = new URLSearchParams({ entity: 'supply', id: productId, quantity: String(q) });
        request(`/workspaces/${encodeURIComponent(workspace)}/read?${params}`, null, a.signal)
          .then(snapshot => { if (!a.signal.aborted) setQuote({ key: quoteKey, snapshot }); })
          .catch(e => { if (!a.signal.aborted) setQuoteError(e.message); });
      }, 180);
      return () => { clearTimeout(timer); a.abort(); };
    }, [quoteKey, !!s.pending]);
    useEffect(() => { if (s.error?.rejected) refreshQuote(n => n + 1); }, [s.error]);
    const snapshot = quote?.key === quoteKey ? quote.snapshot : null, p = snapshot?.product;
    const total = p?.unitPriceMinor == null ? null : p.unitPriceMinor * q;
    const available = p && p.catalogStatus !== 'unavailable' && p.unitPriceMinor != null && p.available >= q;
    const valid = available && buyerId && validQuantity && Number.isSafeInteger(total) && Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= 10080;
    const locked = s.busy || !!s.pending || s.blocked;
    function submit(e) {
      e.preventDefault(); if (!valid || locked) return;
      s.submit({ productId, buyerId, quantity: q, holdMinutes: minutes, expectedRevision: p.revision,
        ...(p.catalogRevision ? { expectedCatalogRevision: p.catalogRevision } : {}) });
    }
    return h('form', { className: 'me-compose me-order-compose', onSubmit: submit }, h(SubmissionNotice, { submission: s }),
      s.pending?.offerId ? h('p', { className: 'me-help' }, `上次提交包含旧供货名额 ${s.pending.offerId}，核对时保留原请求。`) : null,
      h('div', { className: 'me-detail-grid' }, h('div', null,
        h(Surface, { className: 'me-card' }, h('div', { className: 'me-card-header' }, h('h2', null, '客户与采购商品')),
          h('fieldset', { disabled: locked, className: 'me-card-body me-compose-fields' },
            h(Choice, { label: '客户', name: 'buyerId', value: buyerId, onChange: setBuyerId, choices: buyers, disabled: locked, textOf: r => r.contact ? `${r.name} · ${r.contact}` : r.name }),
            h(Choice, { label: '商品 / SKU', name: 'productId', value: productId, onChange: setProductId, choices: products, disabled: locked, textOf: r => `${r.name} · ${r.skuCode || r.id}` }),
            field('采购数量', h(ERPInput, { name: 'quantity', type: 'number', min: 1, max: 1e9, step: 1, required: true, value: quantity, onChange: e => setQuantity(e.target.value) }), '单价按实际数量读取原产品库的阶梯报价。'))),
        h(Surface, { className: 'me-card' }, h('div', { className: 'me-card-header' }, h('h2', null, '预留条件')),
          h('fieldset', { disabled: locked, className: 'me-card-body me-compose-fields' },
            field('预留时长（分钟）', h(ERPInput, { name: 'holdMinutes', type: 'number', min: 1, max: 10080, step: 1, required: true, value: holdMinutes, onChange: e => setHoldMinutes(e.target.value) }), '到期后释放预留数量。')))),
        h(Surface, { as: 'aside', className: 'me-card', 'aria-label': '订单报价汇总' }, h('div', { className: 'me-card-header' }, h('h2', null, '采购小计'), button(null, () => refreshQuote(n => n + 1), { icon: 'refresh', className: 'me-icon-button', disabled: locked || !productId, 'aria-label': '重新读取报价' })),
          h('div', { className: 'me-card-body' }, s.pending ? h('p', { className: 'me-help' }, '核对上次提交后，以订单回执中的金额和当前状态为准。')
            : quoteError ? h('p', { role: 'alert' }, quoteError) : !snapshot ? h('p', { role: 'status', className: 'me-help' }, !productId ? '选择商品与数量后显示实际报价。' : !validQuantity ? '请填写有效的采购数量。' : '正在读取报价…')
              : h(React.Fragment, null,
                h('p', { className: 'me-section-label' }, p.name), h('div', { className: 'me-quote', 'data-quote-total': Number.isSafeInteger(total) ? total : '' }, Number.isSafeInteger(total) ? money(total, p.currency) : '待确认'),
                h('div', { className: 'me-data-row' }, '单价', h('b', null, price(p))), h('div', { className: 'me-data-row' }, '采购数量', h('b', null, `${q} ${p.unit || '件'}`)),
                h('div', { className: 'me-data-row' }, '当前可分配', h('b', null, p.available)), h('div', { className: 'me-data-row' }, '起订量', h('b', null, p.moq ?? '待确认')),
                p.unitPriceMinor == null ? h('p', { role: 'alert', className: 'me-help' }, '当前数量尚无可用报价。请核对起订量和商品资料。') : null,
                total !== null && !Number.isSafeInteger(total) ? h('p', { role: 'alert', className: 'me-help' }, '商品小计超出支持范围，请减少数量。') : null,
                p.available < q ? h('p', { role: 'alert', className: 'me-help' }, '可供应数量不足，请调整采购数量。') : null,
                h('p', { className: 'me-help' }, `读取于 ${clock(snapshot.asOf)}。提交时会再次校验报价、数量与名额。`)),
            h('p', { className: 'me-help' }, '金额为商品小计，不含运费、税费。创建预留不会收款或发货。')))),
      h('div', { className: 'me-compose-footer' }, button(s.pending ? '稍后核对' : '取消', onClose, { disabled: s.busy }),
        s.pending ? button(s.busy ? '正在核对…' : '重试同一次提交', () => s.submit(), { disabled: s.busy, className: 'me-button-primary' })
          : button('创建预留', undefined, { type: 'submit', disabled: s.blocked || !valid, className: 'me-button-primary' })));
  }

  function CustomerOrders({ workspace, customerId, onOpen }) {
    const orders = useChoices(workspace, 'order', { buyerId: customerId });
    return h(Surface, { className: 'me-card me-customer-orders' },
      h('div', { className: 'me-card-header' }, h('h2', null, '订单'), h('small', null, `已读取 ${orders.items.length} 条`)),
      orders.error ? h('div', { role: 'alert', className: 'me-card-body' }, orders.error, button('重新读取', orders.retry)) : null,
      orders.items.length ? h('div', { className: 'me-table-wrap' }, h(Table.Root, null,
        h(Table.Header, null, h(Table.Row, null, ['订单', '状态', '商品小计'].map(label => h(Table.ColumnHeaderCell, { key: label }, label)))),
        h(Table.Body, null, orders.items.map(order => h(Table.Row, { key: order.id },
          h(Table.Cell, null, button(shortId(order.id), () => onOpen(order), { className: 'me-text-button', 'data-customer-order': order.id })),
          h(Table.Cell, null, badge(order.status)), h(Table.Cell, null, money(order.totalMinor, order.currency)))))))
        : h('p', { className: 'me-card-body' }, orders.loading ? '正在读取订单…' : orders.error ? '订单暂时无法读取。' : '该客户还没有订单。'),
      orders.hasMore ? h('div', { className: 'me-card-body' }, button(orders.loading ? '正在读取…' : '加载更多订单', orders.more, { disabled: orders.loading })) : null);
  }
  // The page map is shared by navigation, command search and capability disclosure.
  const pages = {
    home: ['首页', 'home'], orders: ['订单', 'order'], drafts: ['草稿订单', 'document'], abandoned: ['弃单', 'cart'],
    products: ['商品', 'product'], collections: ['产品系列', 'collection'], inventory: ['库存', 'inventory'], purchase_orders: ['采购订单', 'document'], transfers: ['转移', 'transfer'], gift_cards: ['礼品卡', 'gift'],
    customers: ['客户', 'buyer'], segments: ['客户细分', 'segments'], marketing: ['营销', 'marketing'], campaigns: ['营销活动', 'marketing'], automations: ['自动化', 'automation'],
    discounts: ['折扣', 'discount'], content: ['内容', 'document'], files: ['文件', 'folder'], metaobjects: ['元对象', 'collection'], menus: ['菜单', 'menu'], blog: ['博客文章', 'document'],
    markets: ['市场', 'globe'], analytics: ['分析', 'chart'], reports: ['报告', 'document'], live: ['实时视图', 'activity'], finances: ['财务', 'wallet'],
    online_store: ['在线商店', 'store'], themes: ['主题', 'palette'], store_pages: ['页面', 'document'], preferences: ['商店偏好设置', 'settings'],
    apps: ['应用', 'apps'], settings: ['设置', 'settings'], store_details: ['店铺详情', 'store'], payments: ['支付', 'wallet'], checkout: ['结账', 'cart'],
    shipping: ['发货和配送', 'truck'], taxes: ['税费', 'document'], locations: ['地点', 'pin'], domains: ['域名', 'globe'], notifications: ['通知', 'bell'], users: ['用户和权限', 'buyer'], appearance: ['显示偏好', 'palette'], connections: ['接入状态', 'link'],
  };
  const navGroups = [
    ['home', []], ['orders', ['drafts', 'abandoned']], ['products', ['collections', 'inventory', 'purchase_orders', 'transfers', 'gift_cards']],
    ['customers', ['segments']], ['marketing', ['campaigns', 'automations']], ['discounts', []], ['content', ['files', 'metaobjects', 'menus', 'blog']],
    ['markets', []], ['analytics', ['reports', 'live']], ['finances', []],
  ];
  const settingsPages = ['store_details', 'payments', 'checkout', 'shipping', 'taxes', 'locations', 'domains', 'notifications', 'users', 'appearance', 'connections'];
  const livePages = new Set(['home', 'orders', 'products', 'inventory', 'customers', 'content', 'files', 'settings', 'store_details', 'appearance', 'connections']);
  const resourceColumns = {
    drafts: ['草稿订单', '客户', '状态', '总计'], abandoned: ['结账', '客户', '恢复状态', '总计'], collections: ['标题', '商品条件', '商品数量'],
    purchase_orders: ['采购订单', '供应商', '目的地', '状态'], transfers: ['转移', '发货地', '目的地', '状态'], gift_cards: ['礼品卡', '客户', '状态', '余额'],
    segments: ['细分名称', '客户占比', '上次编辑'], campaigns: ['营销活动', '状态', '渠道', '转化'], automations: ['自动化', '状态', '触发条件'],
    discounts: ['折扣', '状态', '方法', '类型'], metaobjects: ['定义', '条目', '上次更新'], menus: ['菜单', '菜单项'], blog: ['标题', '作者', '可见性'],
    reports: ['报告', '类别', '上次查看'], store_pages: ['标题', '可见性', '上次编辑'], markets: ['市场', '状态', '地区'],
  };
  const connectionInfo = {
    drafts: ['草稿订单服务', '草稿需要支持多商品行、调整价格和转换为正式订单。目前保留的采购预留不会自动转换成草稿。', ['商品行与客户', '报价与折扣', '转换为正式订单']],
    abandoned: ['结账会话', '接入商店结账后，才能查看未完成的结账和恢复情况。', ['结账会话', '客户联系方式', '恢复记录']],
    collections: ['产品系列', '商品主数据已接入；手动系列和自动系列条件尚未保存。', ['手动选择商品', '自动系列条件', '系列发布']],
    purchase_orders: ['采购与收货', '当前没有供应商采购单、收货或采购成本记录。', ['供应商资料', '采购商品', '收货数量']],
    transfers: ['多地点库存', '转移需要发货地点、收货地点及实际库存流水。', ['发货地点', '收货地点', '在途与收货']],
    gift_cards: ['礼品卡服务', '礼品卡的发行、余额和兑换需要独立交易支持。', ['发行与有效期', '余额', '兑换记录']],
    segments: ['客户细分', '客户资料已接入；细分条件和动态人群尚未启用。', ['筛选条件', '动态客户群', '营销授权']],
    marketing: ['营销渠道', '连接实际营销渠道后，才能读取广告支出、营销活动和转化。', ['渠道连接', '活动记录', '归因与转化']],
    campaigns: ['营销渠道', '当前没有已接入的营销活动来源。', ['活动', '渠道', '转化']],
    automations: ['营销自动化', '自动化需要真实触发事件、客户营销授权和发送渠道。', ['触发事件', '发送渠道', '发送结果']],
    discounts: ['折扣引擎', '当前订单尚未支持折扣计算或结账折扣码。', ['折扣码', '自动折扣', '适用条件']],
    metaobjects: ['自定义内容', '文件库已接入；元对象定义和条目服务尚未接入。', ['定义', '条目', '商店引用']],
    menus: ['商店导航', '需要连接商店页面与发布服务，才能保存并发布菜单。', ['菜单项', '页面链接', '发布']],
    blog: ['博客发布', '当前没有博客、文章或公开发布服务。', ['文章内容', '作者与日期', '公开发布']],
    markets: ['市场配置', '市场需要地区、币种、定价和商店销售范围支持。', ['地区与语言', '市场定价', '销售范围']],
    analytics: ['经营分析', '当前订单没有付款、退款或访问记录，无法生成销售额和转化率。', ['访问与转化', '付款与退款', '销售报表']],
    reports: ['报表数据', '接入真实订单付款及访问数据后，才能生成经营报告。', ['销售报告', '客户报告', '库存报告']],
    live: ['访客事件', '当前未采集商店访客、购物车或结账事件。', ['实时访客', '购物车事件', '结账事件']],
    finances: ['支付与结算', '确认预留不代表收款。付款、退款和结算记录尚未接入。', ['付款记录', '退款', '结算']],
    online_store: ['商店发布', '后台商品资料已接入；面向客户的商店、主题和结账尚未部署。', ['商店主题', '页面与域名', '发布与结账']],
    themes: ['主题运行时', '需要商店主题运行时和预览／发布服务。', ['主题库', '主题编辑', '预览与发布']],
    store_pages: ['页面发布', '当前只有内部资料文件，没有公开商店页面服务。', ['页面内容', '可见性', '公开链接']],
    preferences: ['商店发布', '商店搜索摘要、密码保护和访客追踪需要实际商店支持。', ['搜索摘要', '访问保护', '访客追踪']],
    apps: ['商务应用连接', '当前没有已连接的商务应用。DSH 插件由宿主管理。', ['应用授权', '数据连接', '连接状态']],
    payments: ['支付服务', '连接支付服务后，才能收款、退款和核对结算。', ['支付方式', '收款', '退款与结算']],
    checkout: ['结账服务', '当前没有公开结账页面、结账会话或支付接入。', ['客户信息', '配送选择', '付款']],
    shipping: ['配送服务', '当前没有运费计算、包裹或承运商履约记录。', ['配送区域', '运费', '承运商']],
    taxes: ['税费计算', '税费需要根据商家、商品及收货地区计算。当前小计不含税费。', ['税务登记', '适用地区', '税费计算']],
    locations: ['库存地点', '当前可供应分配账本不等于地点现存量。', ['地点', '现存量', '出入库流水']],
    domains: ['域名与站点', '没有公开商店时，无法绑定域名或检查站点证书。', ['域名', 'DNS', '证书']],
    notifications: ['通知渠道', '保存客户和订单不会发送消息。邮件和短信服务尚未接入。', ['邮件', '短信', '发送结果']],
    users: ['经营者权限', '当前访问由 DSH 宿主认证管理；尚无店铺员工角色与细分权限。', ['员工账号', '角色', '操作权限']],
  };
  function readLocation() {
    const query = new URLSearchParams(window.location.search);
    const page = query.get('erp_page');
    return { page: Object.hasOwn(pages, page) ? page : 'home', workspace: query.get('erp_workspace') || '' };
  }
  async function libraryRead(path, signal) {
    const response = await fetch('/workspace-library-api' + path, { credentials: 'same-origin', cache: 'no-store', signal });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error?.message || '资料暂时无法读取，请重试。');
    return result.data;
  }
  function useResource(load, key) {
    const [state, setState] = useState({ loading: true, value: null, error: '' }), [nonce, reload] = useState(0);
    useEffect(() => {
      const a = new AbortController(); setState({ key, loading: true, value: null, error: '' });
      Promise.resolve().then(() => load(a.signal)).then(value => { if (!a.signal.aborted) setState({ key, loading: false, value, error: '' }); })
        .catch(error => { if (!a.signal.aborted) setState({ key, loading: false, value: null, error: error.message }); });
      return () => a.abort();
    }, [key, nonce]);
    return { ...(state.key === key ? state : { loading: true, value: null, error: '' }), reload: () => reload(n => n + 1) };
  }
  function PageHeading({ title, subtitle, actions, crumb, onBack }) {
    return h('div', { className: 'me-heading' }, h('div', { className: 'me-heading-title' },
      onBack ? button(null, onBack, { icon: 'back', className: 'me-icon-button me-back', 'aria-label': '返回' }) : null,
      h('div', null, crumb ? h('p', { className: 'me-crumb' }, crumb) : null, h('h1', { tabIndex: -1 }, title), subtitle ? h('p', null, subtitle) : null)), actions ? h('div', { className: 'me-actions' }, actions) : null);
  }
  function ResourceState({ resource, children }) {
    if (resource.loading) return h('div', { className: 'me-loading', role: 'status', 'aria-label': '正在读取' }, h('div', { className: 'me-skeleton' }), h('div', { className: 'me-skeleton' }), h('div', { className: 'me-skeleton' }));
    if (resource.error) return h('div', { className: 'me-alert me-alert-error', role: 'alert' }, h(Icon, { name: 'info' }), h('span', null, resource.error), button('重新读取', resource.reload));
    return children;
  }
  function csvFile(name, headers, rows) {
    const cell = value => { const raw = String(value ?? ''); return '"' + (/^[\s]*[=+@\-\t\r]/.test(raw) ? "'" + raw : raw).replaceAll('"', '""') + '"'; };
    const blob = new Blob(['\ufeff' + [headers, ...rows].map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function CatalogIndex({ kind, onOpen, onCreate, onInventory }) {
    const files = kind === 'files';
    const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [offset, setOffset] = useState(0), [sort, setSort] = useState('updated'), [selected, setSelected] = useState([]);
    const params = new URLSearchParams({ q: query, status, offset: String(offset), limit: '50', sort });
    const resource = useResource(signal => libraryRead(`/${files ? 'documents' : 'products'}?${params}`, signal), `${kind}:${params}`);
    const rows = resource.value?.items || [];
    const selection = useRef(null);
    useEffect(() => { if (selection.current) selection.current.indeterminate = selected.length > 0 && selected.length < rows.length; }, [selected, resource.value, resource.loading]);
    useEffect(() => { if (resource.value) setSelected(old => old.filter(id => resource.value.items.some(row => row.id === id))); }, [resource.value]);
    useEffect(() => { setSelected([]); }, [kind, query, status, offset, sort]);
    function change(fn, value) { fn(value); setOffset(0); }
    function exportRows() {
      const data = rows.filter(row => selected.includes(row.id));
      csvFile(files ? 'files.csv' : 'products.csv', files ? ['ID', '文件名称', '类型', '状态', '版本'] : ['ID', '商品', '状态', '分类', '变体数量'],
        data.map(row => files ? [row.id, row.title, row.slotLabel, row.status, row.currentVersion] : [row.id, row.name, row.status, row.category, row.skuCount]));
    }
    return h(React.Fragment, null,
      h(PageHeading, { title: files ? '文件' : '商品', subtitle: files ? '管理商品与企业使用的文件。' : '管理商品、变体、图片与商品资料。',
        actions: [!files ? button('查看库存', onInventory, { key: 'inventory', icon: 'inventory' }) : null,
          button(files ? '上传文件' : '添加商品', onCreate, { key: 'create', className: 'me-button-primary', icon: 'plus' })] }),
      h(Surface, { className: 'me-card' },
        h('div', { className: 'me-list-toolbar' }, h('div', { className: 'me-views' }, [['', '全部'], [files ? 'active' : 'draft', files ? '可用' : '草稿'], ['archived', '已归档']].map(([value, label]) => button(label, () => change(setStatus, value), { key: value, 'aria-pressed': status === value }))),
          h('div', { className: 'me-list-controls' }, h('label', { className: 'me-search' }, h(Icon, { name: 'search', size: 16 }), h(ERPInput, { type: 'search', value: query, maxLength: 200, placeholder: files ? '搜索文件' : '搜索所有商品', 'aria-label': files ? '搜索文件' : '搜索所有商品', onChange: e => change(setQuery, e.target.value) }), query ? button(null, e => { change(setQuery, ''); e.currentTarget.closest('label').querySelector('input').focus(); }, { icon: 'close', className: 'me-button-plain me-search-clear', 'aria-label': '清除列表搜索' }) : null),
            h('select', { className: 'me-sort', 'aria-label': '排序', value: sort, onChange: e => change(setSort, e.target.value) }, h('option', { value: 'updated' }, '最近更新'), h('option', { value: 'name_asc' }, '名称 A–Z'), h('option', { value: 'name_desc' }, '名称 Z–A')),
            button(null, resource.reload, { icon: 'refresh', className: `me-icon-button${resource.loading ? ' is-loading' : ''}`, disabled: resource.loading, 'aria-label': '刷新' }))),
        selected.length ? h('div', { className: 'me-selection-bar' }, h('strong', null, `已选择 ${selected.length} 项`), button('导出所选', exportRows, { icon: 'download' }), button('取消选择', () => setSelected([]), { className: 'me-button-plain' })) : null,
        h(ResourceState, { resource }, !rows.length ? h('div', { className: 'me-empty' }, h(EmptyArtwork, { entity: files ? 'document' : 'product' }),
          h('h2', null, query || status ? '没有符合条件的记录' : files ? '让文件井井有条' : '添加你的第一件商品'),
          h('p', null, query || status ? '调整搜索词或筛选条件后重试。' : files ? '上传真实文件，在商品和企业资料中重复使用。' : '从商品名称开始，添加图片、变体和价格。'),
          query || status ? button('清除筛选', () => { setQuery(''); setStatus(''); setOffset(0); }) : button(files ? '上传文件' : '添加商品', onCreate, { className: 'me-button-primary' }))
          : h('div', { className: 'me-table-wrap', tabIndex: 0, role: 'region', 'aria-label': files ? '文件列表' : '商品列表' }, h(Table.Root, null,
            h(Table.Header, null, h(Table.Row, null, h(Table.ColumnHeaderCell, { className: 'me-check-cell' }, h(ERPInput, { ref: selection, type: 'checkbox', 'aria-label': '选择本页全部', checked: rows.length > 0 && selected.length === rows.length, onChange: e => setSelected(e.target.checked ? rows.map(r => r.id) : []) })),
              (files ? ['文件名称', '类型', '状态', '版本', '更新日期'] : ['商品', '状态', '变体', '分类', '更新日期']).map(label => h(Table.ColumnHeaderCell, { key: label, scope: 'col' }, label)))),
            h(Table.Body, null, rows.map(row => h(Table.Row, { key: row.id, 'data-selected': selected.includes(row.id) },
              h(Table.Cell, { className: 'me-check-cell' }, h(ERPInput, { type: 'checkbox', 'aria-label': `选择 ${row.name || row.title}`, checked: selected.includes(row.id), onChange: e => setSelected(old => e.target.checked ? [...old, row.id] : old.filter(id => id !== row.id)) })),
              h(Table.Cell, null, h('div', { className: 'me-product-cell' }, h('div', { className: 'me-thumb' }, row.primaryImageId ? h('img', { src: `/workspace-library-api/products/${encodeURIComponent(row.id)}/images/${encodeURIComponent(row.primaryImageId)}`, alt: '' }) : h(Icon, { name: files ? 'document' : 'product' })),
                button(row.name || row.title, () => onOpen(row.id), { className: 'me-text-button me-record-button', 'data-catalog-record': row.id }))),
              ...(files ? [h(Table.Cell, { key: 'type' }, row.slotLabel), h(Table.Cell, { key: 'status' }, badge(row.status, row.status === 'active' ? '可用' : '已归档')), h(Table.Cell, { key: 'version' }, `v${row.currentVersion}`)]
                : [h(Table.Cell, { key: 'status' }, badge(row.status, row.status === 'draft' ? '草稿' : '已归档')), h(Table.Cell, { key: 'sku' }, `${row.skuCount} 个变体`), h(Table.Cell, { key: 'category' }, row.category || '—')]),
              h(Table.Cell, null, new Date(row.updatedAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })))))))),
        h('div', { className: 'me-list-footer' }, h('span', null, resource.value ? `${resource.value.matched} 项${query || status ? ` · 共 ${resource.value.total} 项` : ''}` : '正在读取…'),
          h('div', { className: 'me-actions' }, button(null, () => setOffset(v => Math.max(0, v - 50)), { icon: 'back', 'aria-label': '上一页', disabled: !offset || resource.loading }),
            h('span', null, `第 ${Math.floor(offset / 50) + 1} 页`), button(null, () => setOffset(resource.value.nextOffset), { icon: 'arrow', 'aria-label': '下一页', disabled: !resource.value?.hasMore || resource.loading })))),
      h('p', { className: 'me-page-note' }, h(Icon, { name: 'info', size: 14 }), files ? '文件保留原始版本。预览和下载使用已登录的访问权限。' : '商品资料使用原产品库；公开商店发布尚未接入。'));
  }
  function HomePage({ workspace, title, navigate, onCreateProduct }) {
    const resource = useResource(async signal => {
      const [catalog, files, ledger] = await Promise.all([libraryRead('/products?limit=1', signal), libraryRead('/documents?limit=1', signal), workspace ? request(`/workspaces/${encodeURIComponent(workspace)}/overview`, null, signal) : Promise.resolve(null)]);
      return { catalog, files, ledger };
    }, workspace);
    const value = resource.value;
    const tasks = value ? [
      ['添加商品', '名称、图片、变体和报价', value.catalog.total > 0, onCreateProduct, 'product'],
      ['整理文件', '规格、产品资料与企业文件', value.files.total > 0, () => navigate('files'), 'document'],
      ['添加客户', '客户资料与关联订单', (value.ledger?.customers || 0) > 0, () => navigate('customers'), 'buyer'],
    ] : [];
    const completed = tasks.filter(task => task[2]).length;
    return h(React.Fragment, null,
      h(PageHeading, { title: '首页', subtitle: title ? `欢迎回到 ${title}` : '从这里开始管理你的业务', actions: h(React.Fragment, null, button('店铺设置', () => navigate('store_details'), { icon: 'settings' }), button('添加商品', onCreateProduct, { icon: 'plus', className: 'me-button-primary' })) }),
      h(ResourceState, { resource }, value ? h(React.Fragment, null,
        h('div', { className: 'me-overview-caption' }, h('h2', null, '业务概览'), h('small', null, value.ledger ? `更新于 ${clock(value.ledger.asOf)}` : '当前资料库')),
        h(Surface, { as: 'div', className: 'me-overview-grid' }, [
          ['商品', value.catalog.total, '产品库中的商品', 'products', 'product'], ['客户', value.ledger?.customers ?? '—', '当前工作区', 'customers', 'buyer'],
          ['订单记录', value.ledger?.orders.total ?? '—', '预留与历史订单', 'orders', 'order'], ['待确认预留', value.ledger?.orders.reserved ?? '—', '尚未到期', 'orders', 'activity'],
        ].map(([label, count, hint, page, icon]) => h('button', { type: 'button', key: label, className: 'me-metric', onClick: () => navigate(page) },
          h('span', null, label, h(Icon, { name: icon, size: 17 })), h('strong', null, count), h('small', null, hint, h(Icon, { name: 'arrow', size: 13 }))))),
        h('div', { className: 'me-home-grid' },
          h(Surface, { className: 'me-card me-setup-card' },
            h('div', { className: 'me-card-body' }, h('div', { className: 'me-setup-heading' }, h('div', null, h('div', { className: 'me-kicker' }, '设置指南'), h('h2', null, '准备好开展业务')), h(Badge, { color: 'gray', variant: 'soft' }, `${completed} / 3`)),
              h('p', { className: 'me-subtle' }, '整理好基础资料，开始管理你的第一笔业务。'), h(Progress, { size: '1', value: completed / 3 * 100, 'aria-label': '资料准备进度', className: 'me-setup-progress' })),
            tasks.map(([label, description, done, action, icon]) => h('button', { key: label, type: 'button', className: 'me-setup-row', onClick: action },
              h('span', { className: `me-step-mark${done ? ' is-done' : ''}` }, h(Icon, { name: done ? 'check' : icon, size: 19 })),
              h('span', null, h('strong', null, label), h('small', null, description)), h(Icon, { name: 'arrow', size: 16 })))),
          h('div', { className: 'me-home-aside' },
            h(Surface, { className: 'me-card' }, h('div', { className: 'me-card-body' }, h('h2', null, '快捷入口'), h('div', { className: 'me-quick-links' }, [['inventory', '库存管理'], ['orders', '跟进订单'], ['store_details', '店铺信息']].map(([page, label]) => button(label, () => navigate(page), { key: page, className: 'me-text-button', icon: pages[page][1] }))))),
            h(Surface, { className: 'me-card me-status-card' }, h('div', { className: 'me-card-body' }, h('div', { className: 'me-status-heading' }, h(Icon, { name: 'link', size: 18 }), h('h2', null, '业务连接')), h('p', { className: 'me-subtle' }, '商品、客户与文件已接入。在线商店、支付和配送尚未连接。'), button('管理连接', () => navigate('connections'), { className: 'me-text-button', icon: 'arrow' }))))),
        h('p', { className: 'me-page-note' }, h(Icon, { name: 'info', size: 14 }), value.ledger ? '订单记录包含采购预留，不代表已付款销售。' : '添加 DSH 工作区后，即可管理客户和订单。')) : null));
  }
  function ConnectionPage({ page, navigate, embedded = false }) {
    const [service, description, parts] = connectionInfo[page] || ['业务服务', '此页面需要连接对应业务服务。', []];
    const columns = resourceColumns[page];
    return h(React.Fragment, null, !embedded ? h(PageHeading, { title: pages[page][0], subtitle: description }) : null,
      h(Surface, { className: 'me-card me-connection-card' },
        columns ? h('div', { className: 'me-table-wrap' }, h(Table.Root, { 'aria-label': `${pages[page][0]}字段` }, h(Table.Header, null, h(Table.Row, null, columns.map(column => h(Table.ColumnHeaderCell, { key: column }, column)))))) : null,
        h('div', { className: 'me-connection-empty' }, h('div', { className: 'me-connection-art', 'aria-hidden': true }, h('span', null, h(Icon, { name: pages[page][1], size: 34 })), h('i', null, h(Icon, { name: 'link', size: 14 }))),
          badge('neutral', '未接入'), h('h2', null, `${service}尚未连接`), h('p', null, description),
          button('查看接入状态', () => navigate('connections'), { className: 'me-button-primary' }))),
      h('div', { className: 'me-capability-grid' }, parts.map((part, index) => h(Surface, { className: 'me-card', key: part }, h('div', { className: 'me-card-body' }, h('span', { className: 'me-capability-number' }, `0${index + 1}`), h('h3', null, part), h('p', { className: 'me-subtle' }, '需要接入对应数据与执行服务。'))))));
  }
  function ContentPage({ navigate }) {
    return h(React.Fragment, null, h(PageHeading, { title: '内容', subtitle: '管理文件以及商店中使用的内容。' }),
      h('div', { className: 'me-content-grid' }, [['files', '商品图片、规格文件与企业资料。', true], ['metaobjects', '可重复使用的结构化内容。', false], ['menus', '商店的导航与页面链接。', false], ['blog', '文章与公开内容。', false]].map(([page, description, ready]) => h('button', { key: page, className: 'me-card me-content-card', onClick: () => navigate(page) }, h('div', { className: 'me-content-icon' }, h(Icon, { name: pages[page][1], size: 30 })), h('div', null, h('h2', null, pages[page][0]), h('p', null, description), badge(ready ? 'linked' : 'neutral', ready ? '已接入' : '未接入')), h(Icon, { name: 'arrow', size: 17 })))));
  }
  function SettingsPage({ page, navigate, appearance, setAppearance, density, setDensity, onDirtyChange, onBusy, onSaved }) {
    const selected = page === 'settings' ? 'store_details' : page;
    return h(React.Fragment, null, h(PageHeading, { title: '设置', subtitle: '管理店铺资料、显示偏好与服务接入。' }),
      h('div', { className: 'me-settings-grid' }, h('nav', { className: 'me-settings-nav', 'aria-label': '设置导航' }, settingsPages.map(id => button(pages[id][0], () => navigate(id), { key: id, icon: pages[id][1], 'aria-current': selected === id ? 'page' : undefined }))),
        h('div', { className: 'me-settings-content' }, h('h2', { className: 'me-settings-title' }, pages[selected][0]),
          selected === 'store_details' ? h('div', { className: 'me-settings-row' }, h('div', null, h('h3', null, '基本信息'), h('p', { className: 'me-subtle' }, '沿用资料库中的企业名称与介绍。')), h(Surface, { className: 'me-card me-card-body' }, h(CompanySettingsSurface, { ui: libraryUI, onDirtyChange, onBusy, onSaved })))
            : selected === 'appearance' ? h('div', { className: 'me-settings-row' }, h('div', null, h('h3', null, '后台显示'), h('p', { className: 'me-subtle' }, '仅保存在当前浏览器，不影响店铺或其他经营者。')),
              h(Surface, { className: 'me-card me-card-body me-preferences' }, field('外观', h('select', { name: 'appearance', value: appearance, onChange: e => setAppearance(e.target.value) }, h('option', { value: 'system' }, '跟随 DSH'), h('option', { value: 'light' }, '浅色'), h('option', { value: 'dark' }, '紫黑'))),
                field('列表密度', h('select', { name: 'density', value: density, onChange: e => setDensity(e.target.value) }, h('option', { value: 'comfortable' }, '标准'), h('option', { value: 'compact' }, '紧凑'))), h('p', { className: 'me-help' }, '选择后即时生效。')))
              : selected === 'connections' ? h(Surface, { className: 'me-card' }, [['商品资料', '已接入', '原产品库、变体、图片与资料', 'products'], ['客户资料', '已接入', '客户信息、备注与订单查看', 'customers'], ['文件', '已接入', '上传、版本、预览与下载', 'files'], ['订单', '部分接入', '已有采购预留；草稿订单、付款和履约尚未实现', 'orders'], ['库存', '部分接入', '现有可供应分配；非地点现存量', 'inventory'], ['支付与结算', '未接入', '当前没有付款或退款记录', 'payments'], ['发货和配送', '未接入', '当前没有包裹和履约记录', 'shipping'], ['在线商店', '未接入', '当前没有公开商店和结账', 'online_store'], ['营销与分析', '未接入', '当前没有渠道和访问统计', 'marketing']].map(([title, status, description, target]) => h('div', { key: title, className: 'me-connection-row' }, h('div', null, h('strong', null, title), h('p', null, description)), badge(status === '已接入' ? 'linked' : 'neutral', status), button('查看', () => navigate(target), { className: 'me-text-button', 'aria-label': `查看${title}` }))))
                : h(ConnectionPage, { page: selected, navigate, embedded: true }))));
  }
  function SearchDialog({ workspace, onClose, onNavigate, onProduct, onFile, onCustomer, onOrder, returnFocus }) {
    const [query, setQuery] = useState(''), [search, setSearch] = useState(''), [activeIndex, setActiveIndex] = useState(0);
    const input = useRef(null), dialog = useRef(null), restore = useRef(true);
    useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 180); return () => clearTimeout(timer); }, [query]);
    useEffect(() => { input.current?.focus(); return () => { setTimeout(() => {
      if (!document.querySelector('.me-command-dialog') && !document.querySelector('.me-discard-dialog')) {
        if (restore.current && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
        else document.querySelector('.me-main h1')?.focus({ preventScroll: true });
      }
    }, 0); }; }, []);
    const resource = useResource(async signal => {
      if (!search) return [];
      const jobs = [libraryRead('/search?' + new URLSearchParams({ q: search, limit: '10' }), signal), ...workspace ? ['buyer', 'order'].map(entity => request(`/workspaces/${encodeURIComponent(workspace)}/read?` + new URLSearchParams({ entity, q: search, limit: '10' }), null, signal)) : []];
      const results = await Promise.allSettled(jobs);
      return results.map(result => result.status === 'fulfilled' ? { data: result.value } : { error: result.reason.message });
    }, `${workspace}:${search}`);
    const waiting = query.trim() !== search || resource.loading;
    const results = waiting ? [] : resource.value || [], failed = results.some(row => row.error);
    const library = results[0]?.data?.hits || [], customers = results[1]?.data?.items || [], orders = results[2]?.data?.items || [];
    const choices = [
      ...Object.entries(pages).filter(([, [title]]) => !query || title.includes(query.trim())).slice(0, query.trim() ? 5 : 9)
        .map(([id, [title, icon]]) => ({ key: id, label: title, type: livePages.has(id) ? '页面' : '未接入', icon, group: '前往', run: () => onNavigate(id) })),
      ...library.map(row => ({ key: row.type + row.id, label: row.title, type: row.type === 'product' ? '商品' : '文件', icon: row.type === 'product' ? 'product' : 'document', group: '商品与文件', run: () => row.type === 'product' ? onProduct(row.id) : onFile(row.id) })),
      ...customers.map(row => ({ key: 'customer' + row.id, label: row.name, type: '客户', icon: 'buyer', group: '当前工作区', run: () => onCustomer(row.id) })),
      ...orders.map(row => ({ key: 'order' + row.id, label: shortId(row.id), type: '订单', icon: 'order', group: '当前工作区', run: () => onOrder(row.id) })),
    ];
    const signature = choices.map(row => row.key).join('|');
    useEffect(() => { setActiveIndex(0); }, [query, signature]);
    const active = choices.length ? Math.min(activeIndex, choices.length - 1) : -1;
    function choose(index) { if (!choices[index]) return; restore.current = false; onClose(); choices[index].run(); }
    function keys(e) {
      if (e.nativeEvent?.isComposing || e.isComposing) return;
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') {
        const nodes = [...dialog.current.querySelectorAll('button:not(:disabled):not([tabindex="-1"]),input')], first = nodes[0], last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
      if (e.target === input.current && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && choices.length) {
        e.preventDefault(); const next = (active + (e.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
        setActiveIndex(next); document.getElementById(`me-search-option-${next}`)?.scrollIntoView?.({ block: 'nearest' });
      }
      if (e.target === input.current && e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(active); }
    }
    return h('div', { className: 'me-modal-backdrop', onClick: e => { if (e.target === e.currentTarget) onClose(); } },
      h('section', { ref: dialog, className: 'me-command-dialog', role: 'dialog', 'aria-modal': true, 'aria-label': '搜索后台', onKeyDown: keys },
        h('div', { className: 'me-command-input' }, h(Icon, { name: 'search' }), h(ERPInput, { ref: input, type: 'search', role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': true, 'aria-controls': 'me-search-options', 'aria-activedescendant': active >= 0 ? `me-search-option-${active}` : undefined,
          placeholder: '搜索商品、文件、客户或订单', maxLength: 200, value: query, onChange: e => setQuery(e.target.value), 'aria-label': '搜索后台' }),
          query ? button(null, () => { setQuery(''); input.current.focus(); }, { icon: 'close', className: 'me-icon-button me-button-plain', 'aria-label': '清除搜索' }) : null,
          button('Esc', onClose, { className: 'me-button-plain', 'aria-label': '关闭搜索' })),
        h('div', { className: 'me-command-results' },
          h('div', { id: 'me-search-options', role: 'listbox', 'aria-label': '搜索结果', 'aria-busy': waiting }, choices.map((row, index) => h(React.Fragment, { key: row.key },
            index === 0 || choices[index - 1].group !== row.group ? h('div', { className: 'me-command-label', role: 'presentation' }, row.group) : null,
            h('button', { type: 'button', id: `me-search-option-${index}`, role: 'option', 'aria-selected': active === index, tabIndex: -1, 'data-search-result': true, className: 'me-search-result',
              onMouseDown: e => e.preventDefault(), onMouseMove: () => setActiveIndex(index), onClick: () => choose(index) },
              h('span', { className: 'me-result-icon' }, h(Icon, { name: row.icon })), h('span', null, row.label), h('small', null, row.type), h(Icon, { name: 'arrow', size: 14 }))))),
          waiting && query.trim() ? h('p', { className: 'me-command-label', role: 'status' }, '正在搜索…') : null,
          failed ? h('div', { role: 'alert', className: 'me-command-error' }, h('span', null, '部分来源读取失败，请重试。'), button('重新搜索', resource.reload, { className: 'me-text-button' })) : null,
          query.trim() && !waiting && !choices.length && !failed ? h('div', { className: 'me-command-empty', role: 'status' }, h(Icon, { name: 'search', size: 28 }), h('strong', null, '没有找到匹配结果'), h('p', null, '试试商品名称、客户邮箱或订单编号。')) : null),
        h('footer', null, h('span', null, h('kbd', null, '↑'), ' ', h('kbd', null, '↓'), ' 选择 · ', h('kbd', null, '↵'), ' 打开'), h('span', null, '每个来源最多 10 项；客户与订单限当前工作区。'))));
  }

  function AssistantPanel({ module, context, blocked, onStart, onClose }) {
    const defaults = assistants[module], key = `agentive:assistant:${module}`;
    const [initial] = useState(() => { try { return JSON.parse(window.localStorage.getItem(key)) || {}; } catch { return {}; } });
    const [goal, setGoal] = useState(typeof initial.goal === 'string' && initial.goal.trim() ? initial.goal : defaults.goal), [instructions, setInstructions] = useState(typeof initial.instructions === 'string' ? initial.instructions : '');
    const [task, setTask] = useState(''), [settings, setSettings] = useState(false), [message, setMessage] = useState(''), [starting, setStarting] = useState(false);
    async function start() {
      if (blocked || starting || !task.trim() || !context.workspaceId) return;
      setStarting(true); setMessage('');
      try { await onStart(context.workspaceId, assistantPrompt({ module, context, goal, instructions, task })); }
      catch (e) { setMessage(e.message); } finally { setStarting(false); }
    }
    function save() { try { window.localStorage.setItem(key, JSON.stringify({goal,instructions})); setMessage('助理配置已保存在当前浏览器。'); setSettings(false); } catch { setMessage('浏览器无法保存配置，请保留当前内容。'); } }
    return h('aside', { className: 'me-assistant', 'aria-label': defaults.name },
      h('div', { className: 'me-assistant-head' }, h('div', null, h('small', null, 'ASSISTANT'), h('h2', null, defaults.name)), button(null, onClose, {icon:'close',className:'me-icon-button me-button-plain','aria-label':'关闭助理'})),
      h('div', {className:'me-assistant-body'},
        h('div',{className:'me-assistant-context'},h(Icon,{name:pages[module][1],size:18}),h('div',null,h('strong',null,context.recordId ? '已选中记录' : pages[module][0]),h('small',null,context.recordId || '当前模块 · 使用真实工作区数据'))),
        button(settings ? '返回任务' : '编辑助理',()=>setSettings(!settings),{icon:'settings',className:'me-text-button'}),
        settings ? h(React.Fragment,null,field('助理职责',h(TextArea,{value:goal,maxLength:2000,onChange:e=>setGoal(e.target.value),rows:3})),field('工作指令',h(TextArea,{value:instructions,maxLength:8000,onChange:e=>setInstructions(e.target.value),rows:7,placeholder:'例如：先列出缺失信息；使用中文；保留原始来源。'})),h('p',{className:'me-help'},'当前可编辑职责和工作指令。实际工具及权限由 DSH 会话提供。'),button('保存助理配置',save,{className:'me-button-primary',disabled:!goal.trim()}))
        : h(React.Fragment,null,h('p',{className:'me-subtle'},goal),field('需要我帮你做什么？',h(TextArea,{value:task,maxLength:12000,onChange:e=>setTask(e.target.value),rows:7,placeholder:module==='products'?'检查当前商品资料，列出缺失项和需要核实的信息。':'描述本次任务…'})),
          blocked ? h('p',{role:'status',className:'me-help'},'请先保存或放弃页面中未保存的更改，再启动助理。') : null,
          !context.workspaceId ? h('p',{className:'me-help'},'请先选择工作区。') : null,
          button(starting?'正在打开…':'进入助理会话',start,{icon:'arrow',className:'me-button-primary',disabled:starting||blocked||!task.trim()||!context.workspaceId||!onStart}),
          h('p',{className:'me-help'},'在 DSH 原生对话中发送任务并查看执行过程。返回模块时重新读取实际结果。')),
        message ? h('p',{role:'status',className:'me-help'},message):null));
  }
  function Panel({ toggleHostSidebar, onStartAssistant }) {
    const [assistantOpen, setAssistantOpen] = useState(false);
    const [section, setSection] = useState(() => readLocation().page), [searchOpen, setSearchOpen] = useState(false), [expanded, setExpanded] = useState({});
    const [fileView, setFileView] = useState(null), searchReturnFocus = useRef(null);
    function closeMenu() { setMenuOpen(false); document.querySelector('.me-mobile-menu')?.focus({ preventScroll: true }); }
    function openSearch() { if (busy || discardRequest.current) return; searchReturnFocus.current = document.activeElement; setSearchOpen(true); }
    const preference = (key, fallback) => { try { return window.localStorage.getItem('erp-admin:' + key) || fallback; } catch { return fallback; } };
    const [appearance, changeAppearance] = useState(() => { const v = preference('appearance', 'dark'); return ['system', 'light', 'dark'].includes(v) ? v : 'dark'; });
    const [density, changeDensity] = useState(() => preference('density', 'comfortable') === 'compact' ? 'compact' : 'comfortable');
    const [workspaces, setWorkspaces] = useState([]), [workspace, setWorkspace] = useState(''), [workspaceReady, setWorkspaceReady] = useState(false);
    const [entity, setEntity] = useState(() => ({ orders: 'order', customers: 'buyer', inventory: 'product' }[readLocation().page] || 'product')), [data, setData] = useState(null), [detail, setDetail] = useState(null);
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [nonce, refresh] = useState(0);
    const [binding, setBinding] = useState(false), [catalog, setCatalog] = useState([]), [sourceId, setSourceId] = useState(''), [skuId, setSkuId] = useState(''), [stock, setStock] = useState('0');
    const [menuOpen, setMenuOpen] = useState(false);
    const [composer, setComposer] = useState(null), [orderToOpen, setOrderToOpen] = useState(null);
    const [editor, setEditor] = useState(null), [editorDirty, setEditorDirty] = useState(false), [filter, setFilter] = useState('all'), [sort, setSort] = useState('default');
    const [cursor, setCursor] = useState(''), [notice, setNotice] = useState(''), [query, setQuery] = useState('');
    const [discard, setDiscard] = useState(null), discardRequest = useRef(null);
    function confirmDiscard() {
      // Only one pending navigation can own the user's answer.
      if (discardRequest.current) return Promise.resolve(false);
      return new Promise(resolve => {
        const request = { resolve, returnFocus: document.activeElement };
        discardRequest.current = request; setDiscard(request);
      });
    }
    function resolveDiscard(confirmed) {
      const request = discardRequest.current;
      if (!request) return;
      discardRequest.current = null; setDiscard(null); request.resolve(confirmed);
    }
    useEffect(() => () => { discardRequest.current?.resolve(false); discardRequest.current = null; }, []);
    const editorUI = { ...libraryUI, confirmDiscard };
    const active = useRef(''), pending = useRef(null), detailRequest = useRef(0);
    active.current = workspace + '/' + entity + '/' + section;
    useEffect(() => {
      const a = new AbortController();
      request('/workspaces', null, a.signal).then(r => { setWorkspaces(r.items); setWorkspace(r.items.find(w => w.id === readLocation().workspace)?.id ?? r.items[0]?.id ?? ''); })
        .catch(e => { if (!a.signal.aborted) setError(e.message); }).finally(() => { if (!a.signal.aborted) setWorkspaceReady(true); });
      return () => a.abort();
    }, []);
    useEffect(() => {
      detailRequest.current++; setDetail(null); setBinding(false); setData(null); setBusy(false);
      if (!workspace || !['orders', 'customers', 'inventory'].includes(section)) return;
      const a = new AbortController(), key = workspace + '/' + entity + '/' + section; setError('');
      request(`/workspaces/${encodeURIComponent(workspace)}/read?${new URLSearchParams({ entity, limit: '50', ...(cursor ? { afterId: cursor } : {}), ...(['buyer', 'order'].includes(entity) && query ? { q: query } : {}) })}`, null, a.signal)
        .then(r => { if (!a.signal.aborted && active.current === key) setData(r); }).catch(e => { if (!a.signal.aborted) setError(e.message); });
      return () => a.abort();
    }, [workspace, entity, section, cursor, nonce, entity === 'product' ? '' : query]);
    useEffect(() => { if (workspace && orderToOpen && ['buyer', 'order'].includes(entity)) { setOrderToOpen(null); select({ id: orderToOpen }); } }, [workspace, entity, section, orderToOpen]);
    async function reload() {
      setError('');
      try {
        const r = await request('/workspaces'); setWorkspaces(r.items); setWorkspaceReady(true);
        setWorkspace(current => r.items.some(w => w.id === current) ? current : r.items[0]?.id ?? ''); refresh(n => n + 1);
      } catch (e) { setError(e.message); }
    }
    async function command(body) {
      const key = active.current, fingerprint = JSON.stringify([workspace, body]);
      const id = pending.current?.fingerprint === fingerprint ? pending.current.id : crypto.randomUUID();
      pending.current = { fingerprint, id }; setBusy(true); setError('');
      try {
        const result = await request(`/workspaces/${encodeURIComponent(workspace)}/command`, { ...body, requestId: id });
        pending.current = null;
        if (active.current === key) { setEditorDirty(false); refresh(n => n + 1); setNotice('已保存'); }
        return result;
      } catch (e) { if (active.current === key) setError(e.message); }
      finally { if (active.current === key) setBusy(false); }
    }
    async function select(row) {
      const key = active.current, sequence = ++detailRequest.current; setError(''); setNotice('');
      try {
        const result = await request(`/workspaces/${encodeURIComponent(workspace)}/read?${new URLSearchParams({ entity, id: row.id })}`);
        if (active.current === key && sequence === detailRequest.current) { setDetail(result); setBinding(false); setStock(String(result.stockTotal ?? 0)); }
      } catch (e) { if (active.current === key && sequence === detailRequest.current) setError(e.message); }
    }
    async function startBinding() {
      const key = active.current; setError(''); setNotice('');
      try { const r = await request('/catalog'); if (active.current !== key) return; setCatalog(r.items); setSourceId(''); setSkuId(''); setStock('0'); setBinding(true); setDetail(null); }
      catch (e) { if (active.current === key) setError(e.message); }
    }
    function bind(e) {
      e.preventDefault(); if (!selected || !skuId) return;
      const fingerprint = JSON.stringify([workspace, sourceId, skuId, stock]);
      const ledgerId = pending.current?.bindingFingerprint === fingerprint ? pending.current.ledgerId : crypto.randomUUID();
      const body = { action: 'link_sku', id: ledgerId, catalogProductId: sourceId, skuId, catalogRevision: selected.revision, stockTotal: Number(stock) };
      command(body); pending.current = { ...pending.current, bindingFingerprint: fingerprint, ledgerId };
    }
    const leaveEditor = async () => !busy && (!editorDirty || await confirmDiscard());
    function writeLocation(page, workspaceId = workspace, replace = false) {
      const url = new URL(window.location.href); url.searchParams.set('erp_page', page);
      if (workspaceId) url.searchParams.set('erp_workspace', workspaceId); else url.searchParams.delete('erp_workspace');
      window.history[replace ? 'replaceState' : 'pushState'](window.history.state, '', url);
    }
    function resetView() {
      setComposer(null); setMenuOpen(false); setEditor(null); setFileView(null); setEditorDirty(false); setFilter('all'); setSort('default');
      detailRequest.current++; setCursor(''); setQuery(''); setDetail(null); setBinding(false); setNotice(''); setError(''); setOrderToOpen(null);
    }
    async function navigate(next, history = true) {
      if (busy || !Object.hasOwn(pages, next) || !await leaveEditor()) return false;
      resetView(); setSection(next); setEntity({ orders: 'order', customers: 'buyer', inventory: 'product' }[next] || 'product');
      if (history) writeLocation(next); return true;
    }
    async function changeWorkspace(id) {
      if (busy || !await leaveEditor()) return; resetView(); setWorkspace(id); writeLocation(section, id);
    }
    const openEditor = async productId => { if (!await navigate('products')) return; setEditor({ productId }); };
    const closeEditor = async () => { if (await leaveEditor()) { setEditor(null); setEditorDirty(false); refresh(n => n + 1); } };
    const openFile = async id => { if (!await navigate('files')) return; setFileView({ id, creating: !id }); };
    const selectEntity = next => navigate({ product: 'inventory', buyer: 'customers', order: 'orders' }[next]);
    const openRecord = async (page, id) => { if (await navigate(page)) setOrderToOpen(id); };
    function savePreference(key, value, setter) {
      setter(value); try { window.localStorage.setItem('erp-admin:' + key, value); setNotice('显示偏好已保存'); }
      catch { setError('显示已更新，但浏览器无法保存偏好。'); }
    }
    useEffect(() => {
      const key = event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (searchOpen) setSearchOpen(false); else openSearch(); } };
      const pop = async () => {
        const location = readLocation();
        // Keep the address aligned with the visible form while confirmation is pending.
        writeLocation(section, workspace, true);
        if (!await navigate(location.page, false)) return;
        const nextWorkspace = workspaces.some(w => w.id === location.workspace) ? location.workspace : workspace;
        setWorkspace(nextWorkspace); writeLocation(location.page, nextWorkspace, true);
      };
      const warn = event => { if (editorDirty) { event.preventDefault(); event.returnValue = ''; } };
      window.addEventListener('keydown', key); window.addEventListener('popstate', pop); window.addEventListener('beforeunload', warn);
      return () => { window.removeEventListener('keydown', key); window.removeEventListener('popstate', pop); window.removeEventListener('beforeunload', warn); };
    }, [section, workspace, busy, editorDirty, workspaces, searchOpen]);
    useEffect(() => { const main = document.querySelector('.me-main'); if (main) main.scrollTop = 0; main?.querySelector('h1')?.focus({ preventScroll: true }); }, [section]);
    useEffect(() => {
      const root = document.querySelector('.me'), resize = () => {
        if (root?.clientWidth > 900) { setMenuOpen(false); if (document.activeElement?.classList.contains('me-drawer-close')) document.querySelector('.me-global-search')?.focus(); }
      };
      const observer = window.ResizeObserver ? new window.ResizeObserver(resize) : null;
      if (root) observer?.observe(root); window.addEventListener('resize', resize);
      return () => { observer?.disconnect(); window.removeEventListener('resize', resize); };
    }, []);
    useEffect(() => { if (menuOpen) document.querySelector('.me-nav .me-drawer-close')?.focus(); }, [menuOpen]);
    useEffect(() => {
      if (!notice) return; const timer = setTimeout(() => setNotice(''), 6000); return () => clearTimeout(timer);
    }, [notice]);
    const selected = catalog.find(p => p.id === sourceId), items = data?.items ?? [];
    const matching = entity !== 'product' ? items : items.filter(row => [row.name, row.id, row.skuCode, row.contact, row.email, row.phone, row.buyerId].some(v => String(v ?? '').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
    const views = entity === 'product' ? [['all', '全部'], ['available', '可供货'], ['quote', '待询价'], ['unavailable', '来源异常']]
      : entity === 'order' ? [['all', '全部'], ['reserved', '已预留'], ['confirmed', '已确认'], ['cancelled', '已取消'], ['expired', '已到期']] : [['all', '全部']];
    const filtered = matching.filter(row => filter === 'all' || (entity === 'product'
      ? filter === 'available' ? row.available > 0 && row.catalogStatus !== 'unavailable' : filter === 'quote' ? row.quoteStatus === 'required' : row.catalogStatus === 'unavailable'
      : row.status === filter));
    if (sort !== 'default') filtered.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, 'zh-CN') * (sort === 'asc' ? 1 : -1));
    const recordName = row => row.name || (entity === 'order' ? shortId(row.id) : row.id);
    const title = composer ? composer.kind === 'buyer' ? composer.customer ? '编辑客户' : '添加客户' : '创建订单预留' : editor ? editor.productId ? '编辑商品' : '添加商品' : detail ? recordName(detail) : labels[entity];
    const columns = { product: ['商品 / SKU', '状态', '可分配数量', '参考单价', '起订量'], buyer: ['客户', '邮箱', '电话'], order: ['订单编号', '状态', '数量', '商品小计', '创建时间'] }[entity];
    const emptyTitle = { product: '还没有关联的库存分配', buyer: '还没有客户记录', order: '订单会从这里开始' }[entity];
    const emptyDescription = { product: '关联已有商品的 SKU，查看并维护当前可供应数量。', buyer: '添加客户名称与联系方式，为采购预留准备好客户资料。', order: '选择客户和商品，按实际报价创建预留，再跟进确认或取消。' }[entity];
    async function beginComposer(kind, prefill = {}) {
      if (!await leaveEditor()) return;
      setEditor(null); setEditorDirty(false); setDetail(null); setBinding(false); setNotice(''); setError('');
      const page = kind === 'buyer' ? 'customers' : 'orders'; setSection(page); writeLocation(page);
      setEntity(kind === 'buyer' ? 'buyer' : 'order'); setComposer({ kind, ...prefill });
    }
    function created(receipt) {
      setComposer(null); setDetail(receipt.current); setData(null);
      setEditorDirty(false); setNotice(receipt.entity === 'buyer' ? '客户已保存。' : `订单 ${shortId(receipt.id)} · ${states[receipt.current.status] || receipt.current.status}${receipt.replayed ? '（已核对上次提交）' : ''}`);
    }
    const detailField = (label, value) => h('div', { key: label }, h('dt', null, label), h('dd', null, value ?? '待补充'));
    function renderEmpty() {
      if (!workspaceReady || workspace && !data && !error) return h('div', { className: 'me-loading', role: 'status', 'aria-label': '正在读取记录' }, h('p', null, `正在读取${labels[entity]}…`), ...[1, 2, 3].map(i => h('div', { key: i, className: 'me-skeleton', 'aria-hidden': true })));
      if (error && !data) return h('div', { className: 'me-empty' }, h('div', { className: 'me-empty-icon' }, h(Icon, { name: 'info', size: 24 })), h('h2', null, '暂时无法读取记录'), h('p', null, '请重试，或检查当前工作区是否可用。'), button('重新读取', reload, { icon: 'refresh' }));
      if (query.trim() || filter !== 'all') return h('div', { className: 'me-empty' }, h('div', { className: 'me-empty-icon' }, h(Icon, { name: 'search', size: 24 })), h('h2', null, '本页没有匹配的记录'), h('p', null, entity === 'product' ? '试试其他名称或状态。搜索与筛选仅作用于当前页。' : '搜索覆盖当前工作区；状态筛选仅作用于当前结果页。'), button('清除筛选', () => { setQuery(''); setFilter('all'); }));
      return h('div', { className: 'me-empty' }, h(EmptyArtwork, { entity }), h('h2', null, emptyTitle), h('p', null, emptyDescription),
        entity === 'product' ? button('关联已有 SKU', startBinding, { icon: 'link', disabled: !workspace || busy }) : null);
    }
    function renderRows() {
      return filtered.map(row => {
        const firstImage = row.images?.find(i => i.isPrimary) ?? row.images?.[0];
        const first = h(Table.Cell, null, h('div', { className: 'me-product-cell' }, h('div', { className: 'me-thumb' }, firstImage ? h('img', { src: imageUrl(row, firstImage), alt: '' }) : h(Icon, { name: entity, size: 21 })),
          h('div', null, button(recordName(row), () => select(row), { className: 'me-text-button me-record-button', title: row.id, 'data-record-id': row.id }),
            h('div', { className: 'me-row-sub' }, row.skuCode || (entity === 'order' ? `客户 ${row.buyerId}` : row.legacyContact || '')))));
        const cell = (content, className) => h(Table.Cell, { className }, content);
        return h(Table.Row, { key: row.id }, first,
          ...(entity === 'product' ? [cell(badge(row.catalogStatus)), cell(h('span', { className: 'me-number' }, row.available, h('small', null, ` ${row.unit || '件'}`))), cell(h('div', null, price(row), row.quoteStatus !== 'required' && row.quoteQuantity ? h('div', { className: 'me-row-sub' }, `数量 ${row.quoteQuantity} 起`) : null), 'me-number'), cell(row.moq ?? '待确认', 'me-number')]
            : entity === 'buyer' ? [cell(row.email || '—'), cell(row.phone || '—')]
              : [cell(badge(row.status)), cell(row.quantity, 'me-number'), cell(money(row.totalMinor, row.currency), 'me-number'), cell(new Date(row.createdAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }), 'me-number')]));
      });
    }
    function renderProductDetail() {
      return h('div', { className: 'me-detail-grid' }, h('div', null,
        h(Surface, { className: 'me-card' }, h('div', { className: 'me-card-header' }, h('h2', null, '商品信息'), detail.catalogProductId ? button('编辑商品、图片与资料', () => openEditor(detail.catalogProductId), { className: 'me-text-button' }) : null),
          h('div', { className: 'me-card-body' }, h('p', { className: 'me-detail-description' }, detail.description || '尚未填写商品说明。'),
            h('dl', { className: 'me-definition' }, detailField('SKU 编号', detail.skuCode || detail.id), detailField('商品分类', detail.category || '未分类'), detailField('起订量', detail.moq == null ? '待确认' : `${detail.moq} ${detail.unit || '件'}`), detailField('交期', detail.leadTimeDays == null ? '待确认' : `${detail.leadTimeDays} 天`), ...(detail.specs ?? []).map(s => detailField(s.key, s.value))))),
        h(Surface, { className: 'me-card' }, h('div', { className: 'me-card-header' }, h('h2', null, '图片与资料')),
          h('div', { className: 'me-card-body' }, h('div', { className: 'me-media' }, detail.images?.length ? detail.images.map(img => h('img', { key: img.id, src: imageUrl(detail, img), alt: img.alt || detail.name })) : h('div', { className: 'me-no-media' }, h(Icon, { name: 'product', size: 30 }), h('div', null, h('p', null, '暂无商品图片'), h('small', null, '在商品编辑页添加图片，会同步显示在这里。')))),
            h('div', { className: 'me-related' }, h(Icon, { name: 'document' }), h('span', null, '关联资料'), h('small', null, `${detail.documents?.length ?? 0} 份 · 保留原始版本`))))),
        h('div', null, h(Surface, { className: 'me-card' }, h('div', { className: 'me-card-header' }, h('h2', null, '供应数量')),
          h('div', { className: 'me-card-body' }, h('p', { className: 'me-section-label' }, '当前可分配'), h('div', { className: 'me-stat' }, detail.available, h('small', null, detail.unit || '件')),
            h('div', { className: 'me-data-row' }, '已占用', h('b', null, detail.stockTotal - detail.available)), h('div', { className: 'me-data-row' }, '累计可供应', h('b', null, detail.stockTotal)),
            h('form', { className: 'me-stock-form', onSubmit: e => { e.preventDefault(); command({ action: 'update_stock', id: detail.id, expectedRevision: detail.revision, stockTotal: Number(stock), source: '经营者在 ERP 后台更新可供应数量' }); } },
              field('调整累计可供应数量', h(ERPInput, { type: 'number', min: 0, max: 1e9, step: 1, required: true, value: stock, disabled: busy, onChange: e => setStock(e.target.value) })),
              button(busy ? '正在保存…' : '保存数量', undefined, { type: 'submit', disabled: busy, className: 'me-button-primary' })),
            h('details', { className: 'me-help' }, h('summary', null, '这些数量如何计算？'), h('p', null, '已占用包含已确认订单和未到期预留。累计可供应数量包含这些占用，不等于仓库现存量。')))),
          h(Surface, { className: 'me-card' }, h('div', { className: 'me-card-header' }, h('h2', null, '采购报价')),
            h('div', { className: 'me-card-body' }, h('div', { className: 'me-quote' }, price(detail)), detail.quoteQuantity ? h('small', null, `${detail.quoteStatus === 'required' ? '查询数量' : '适用数量'} ${detail.quoteQuantity} ${detail.unit || '件'}`) : null,
              detail.quoteReason ? h('p', { className: 'me-help' }, '当前数量尚无可用报价，请在商品资料中核对价格及起订量。') : null,
              detail.priceTiers?.length ? h(Table.Root, { className: 'me-tiers' }, h(Table.Header, null, h(Table.Row, null, h(Table.ColumnHeaderCell, null, '数量'), h(Table.ColumnHeaderCell, null, '单价'))), h(Table.Body, null, detail.priceTiers.map(t => h(Table.Row, { key: t.minQuantity }, h(Table.Cell, null, `${t.minQuantity}+`), h(Table.Cell, null, `${t.currency} ${t.unitPrice}`))))) : null,
              h('p', { className: 'me-help' }, '新订单按实际数量取价，已生成订单的价格不受修改影响。')))));
    }
    function renderOtherDetail() {
      if (entity === 'buyer') return h('div', { className: 'me-detail-grid' },
        h('div', null, h(CustomerOrders, { key: `${workspace}:${detail.id}`, workspace, customerId: detail.id,
          onOpen: row => openRecord('orders', row.id) }),
          h(Surface, { className: 'me-card' }, h('div', { className: 'me-card-header' }, h('h2', null, '备注')),
            h('div', { className: 'me-card-body me-terms' }, detail.note || '暂无备注。'))),
        h(Surface, { className: 'me-card' }, h('div', { className: 'me-card-header' }, h('h2', null, '客户信息'),
          button('编辑客户', () => beginComposer('buyer', { customer: detail }), { disabled: busy, className: 'me-text-button' })),
          h('div', { className: 'me-card-body' }, h('dl', { className: 'me-definition' }, detailField('姓名', detail.name),
            detailField('邮箱', detail.email || '未填写'), detailField('电话', detail.phone || '未填写'),
            detail.legacyContact ? detailField('原联系方式', detail.legacyContact) : null))));
      return h('div', { className: 'me-detail-grid' }, h(Surface, { className: 'me-card' }, h('div', { className: 'me-card-header' }, h('h2', null, '订单明细'), badge(detail.status)),
        h('div', { className: 'me-card-body' }, h('dl', { className: 'me-definition' }, detailField('商品编号', detail.productId), detailField('客户编号', detail.buyerId), detail.offerId ? detailField('原供货名额', detail.offerId) : null, detailField('采购数量', detail.quantity), detailField('订单单价', price(detail)), detailField('创建时间', new Date(detail.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })), detailField('预留到期', new Date(detail.expiresAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }))))),
        h(Surface, { className: 'me-card' }, h('div', { className: 'me-card-header' }, h('h2', null, '订单汇总')), h('div', { className: 'me-card-body' }, h('p', { className: 'me-section-label' }, '商品小计'), h('div', { className: 'me-quote' }, money(detail.totalMinor, detail.currency)), h('p', { className: 'me-help' }, '不含运费、税费。付款与发货尚未记录。'),
          detail.status === 'reserved' ? h('div', { className: 'me-detail-actions' }, h('div', { className: 'me-actions' }, button('确认订单', () => command({ action: 'confirm', orderId: detail.id }), { disabled: busy, className: 'me-button-primary' }), button('取消预留', () => command({ action: 'cancel', orderId: detail.id }), { disabled: busy })), h('p', { className: 'me-help' }, '确认后占用供货数量；取消预留会释放数量及名额。')) : null)));
    }
    const showResource = ['inventory', 'orders', 'customers'].includes(section) || editor || composer || detail || binding;
    const module = assistantModule(section);
    const assistantContext = {module,workspaceId:workspace,recordId:editor?.productId || fileView?.id || detail?.id || null, recordType:editor ? 'catalog-product' : fileView ? 'document' : detail ? entity : null,revision:detail?.revision || null};
    const pageTitle = workspaces.find(w => w.id === workspace)?.title || '';
    const savedFile = id => { setFileView({ id, creating: false }); setEditorDirty(false); setNotice('文件已保存'); };
    const closeComposer = async () => { if (await leaveEditor()) { setComposer(null); setEditorDirty(false); refresh(n => n + 1); } };
    const closeFile = async () => { if (await leaveEditor()) { setFileView(null); setEditorDirty(false); refresh(n => n + 1); } };
    const extra = section === 'home' ? h(HomePage, { key: workspace + nonce, workspace, title: pageTitle, navigate, onCreateProduct: () => openEditor(null) })
      : section === 'products' ? h(CatalogIndex, { key: 'products' + nonce, kind: 'products', onCreate: () => openEditor(null), onOpen: openEditor, onInventory: () => navigate('inventory') })
      : section === 'files' ? fileView ? h(React.Fragment, null, h(PageHeading, { title: fileView.creating ? '上传文件' : '文件详情', crumb: '内容 / 文件', onBack: closeFile }), h(FileSurface, { ui: editorUI, key: fileView.id || 'new', documentId: fileView.id, creating: fileView.creating, onClose: closeFile, onSaved: savedFile, onDirtyChange: setEditorDirty, onBusy: setBusy }))
        : h(CatalogIndex, { key: 'files' + nonce, kind: 'files', onCreate: () => openFile(null), onOpen: openFile })
      : section === 'content' ? h(ContentPage, { navigate })
      : section === 'settings' || settingsPages.includes(section) ? h(SettingsPage, { key: section, page: section, navigate, appearance, density,
          setAppearance: value => savePreference('appearance', value, changeAppearance), setDensity: value => savePreference('density', value, changeDensity), onDirtyChange: setEditorDirty, onBusy: setBusy, onSaved: () => setNotice('店铺资料已保存') })
      : h(ConnectionPage, { page: section, navigate });
    const content = h('main', { id: 'me-content', inert: menuOpen ? '' : undefined, className: `me-main${editor ? ' me-main-editor' : ''}` },
        showResource ? h('div', { className: 'me-heading' }, h('div', { className: 'me-heading-title' }, detail || editor || composer ? button(null, () => { if (composer) closeComposer(); else if (editor) closeEditor(); else { detailRequest.current++; setDetail(null); refresh(n => n + 1); } }, { className: 'me-icon-button me-back', icon: 'back', 'aria-label': '返回列表', disabled: busy }) : null,
          h('div', null, h('h1', { tabIndex: -1 }, title), composer ? h('p', null, composer.kind === 'buyer' ? '记录真实客户信息。' : '按实际数量核对报价与供货条件。') : editor ? h('p', null, '商品内容与资料统一保存到产品库。') : detail ? h('p', { className: 'me-reference' }, detail.id) : h('p', null, descriptions[entity]))),
          editor || composer ? null : detail ? entity === 'product' ? h('div', { className: 'me-actions' }, badge(detail.catalogStatus), button('创建订单', () => beginComposer('order', { initialProductId: detail.id }), { disabled: busy || detail.catalogStatus === 'unavailable', className: 'me-button-primary' })) : entity === 'buyer' ? button('创建订单', () => beginComposer('order', { initialBuyerId: detail.id }), { disabled: busy, className: 'me-button-primary' }) : null : entity === 'product' ? h('div', { className: 'me-actions' },
            button('关联已有 SKU', startBinding, { disabled: !workspace || busy, icon: 'link', title: workspace ? '关联产品库中的 SKU' : '请先在左侧 Workspaces 添加工作区' }),
            button('创建商品', () => openEditor(null), { disabled: busy, icon: 'plus', className: 'me-button-primary' })) : ['buyer', 'order'].includes(entity) ? button(entity === 'buyer' ? '添加客户' : '创建订单', () => beginComposer(entity), { disabled: !workspace || busy, icon: 'plus', className: 'me-button-primary' }) : null) : null,
        error ? h('div', { role: 'alert', className: 'me-alert me-alert-error' }, h(Icon, { name: 'info' }), h('p', null, error)) : null,

        showResource && !editor && !workspace && workspaceReady && !error ? h('div', { className: 'me-alert' }, h(Icon, { name: 'folder' }), h('div', null, h('strong', null, '选择工作区，开始管理供货'), h('p', null, '在左侧 Workspaces 添加文件夹，然后刷新列表。你也可以先创建商品，准备好产品资料。'))) : null,
        section === 'inventory' && !editor && !composer ? h('div', { className: 'me-alert' }, h(Icon, { name: 'info', size: 17 }), h('div', null, h('strong', null, '库存服务部分接入'), h('p', null, '当前显示可供应分配，包含已确认订单占用；尚无地点现存量、收货与出库流水。'))) : null,
        !editor && binding ? h(Surface, { as: 'form', className: 'me-card me-binding', onSubmit: bind }, h('div', { className: 'me-card-header' }, h('div', null, h('h2', null, '关联产品库 SKU'), h('p', null, '沿用已有商品资料，为当前工作区分配可供应数量。')),
          button(null, () => setBinding(false), { disabled: busy, icon: 'close', className: 'me-icon-button me-button-plain', 'aria-label': '关闭关联表单' })),
          h('div', { className: 'me-card-body' }, !catalog.length ? h('p', null, '产品库中还没有可关联的商品。请先创建商品和 SKU。') : null,
            h('div', { className: 'me-form-grid' }, field('选择产品', h('select', { required: true, value: sourceId, disabled: busy, onChange: e => { setSourceId(e.target.value); setSkuId(''); } }, h('option', { value: '' }, '选择产品'), catalog.map(p => h('option', { key: p.id, value: p.id }, p.name)))),
              field('选择 SKU', h('select', { required: true, value: skuId, disabled: busy || !sourceId, onChange: e => setSkuId(e.target.value) }, h('option', { value: '' }, '选择 SKU'), (selected?.skus ?? []).map(s => h('option', { key: s.id, value: s.id }, s.code || s.id)))),
              field('累计可供应数量', h(ERPInput, { type: 'number', min: 0, max: 1e9, step: 1, required: true, value: stock, disabled: busy, onChange: e => setStock(e.target.value) }), '仅填写已确认的供应数量。')),
            h('div', { className: 'me-form-footer' }, button('取消', () => setBinding(false), { disabled: busy }), button(busy ? '正在保存…' : '确认关联', undefined, { type: 'submit', disabled: busy || !skuId, className: 'me-button-primary' })))) : null,
        showResource ? (composer ? h(composer.kind === 'buyer' ? CustomerComposer : OrderComposer, { key: `${workspace}:${composer.kind}:${composer.customer?.id || 'new'}`, workspace, ...composer, onSaved: created, onClose: closeComposer, onBusy: setBusy, onDirtyChange: setEditorDirty }) : editor ? h(ProductEditorSurface, { ui: libraryUI, key: editor.productId || 'new', productId: editor.productId, onClose: closeEditor, onDirtyChange: setEditorDirty, onBusy: setBusy, onSaved: () => { setEditor(null); setEditorDirty(false); refresh(n => n + 1); setNotice('商品已保存'); } }) : detail ? entity === 'product' ? renderProductDetail() : renderOtherDetail() : h(Surface, { className: 'me-card' },
          h('div', { className: 'me-list-toolbar' }, h('div', { className: 'me-views', 'aria-label': '筛选本页状态' }, views.map(([key, label]) => button(label, () => setFilter(key), { key, 'aria-pressed': filter === key }))), h('div', { className: 'me-list-controls' },
            h('label', { className: 'me-search' }, h(Icon, { name: 'search', size: 15 }), h(ERPInput, { type: 'search', 'aria-label': '搜索记录', placeholder: entity === 'product' ? '筛选本页 SKU' : `搜索所有${labels[entity]}`, value: query, onChange: e => { setQuery(e.target.value); setCursor(''); } }), query ? button(null, e => { setQuery(''); setCursor(''); e.currentTarget.closest('label').querySelector('input').focus(); }, { icon: 'close', className: 'me-button-plain me-search-clear', 'aria-label': '清除列表搜索' }) : null),
            h('select', { className: 'me-sort', 'aria-label': '本页排序', value: sort, onChange: e => setSort(e.target.value) }, h('option', { value: 'default' }, '默认排序'), h('option', { value: 'asc' }, '名称 A–Z'), h('option', { value: 'desc' }, '名称 Z–A')),
            button(null, reload, { icon: 'refresh', disabled: busy, className: 'me-icon-button', 'aria-label': '刷新列表', title: '刷新列表' }))),
          h('div', { className: 'me-table-wrap' }, h(Table.Root, null, h(Table.Header, null, h(Table.Row, null, columns.map(c => h(Table.ColumnHeaderCell, { key: c, scope: 'col' }, c)))), h(Table.Body, null,
            filtered.length ? renderRows() : h(Table.Row, { className: 'me-empty-row' }, h(Table.Cell, { className: 'me-empty-cell', colSpan: columns.length }, renderEmpty()))))),
          h('div', { className: 'me-list-footer' }, h('span', null, data ? `本页 ${items.length} 条${query ? ` · 匹配 ${filtered.length} 条` : ''}${data.asOf ? ` · 读取于 ${clock(data.asOf)}` : ''}` : '商品资料与交易记录保持关联'),
            h('div', { className: 'me-actions' }, cursor ? button('返回首页', () => { setCursor(''); setQuery(''); }, { disabled: busy }) : null, data?.hasMore ? button('下一页', () => { setCursor(data.nextCursor); }, { disabled: busy, icon: 'arrow' }) : null)))) : extra,
        !composer && !editor && section === 'inventory' ? h('p', { className: 'me-page-note' }, h(Icon, { name: 'link', size: 13 }), '商品、图片与资料在产品库统一维护，订单保留成交时的价格。') : null);
    const navItem = (id, children = []) => {
      const current = section === id || children.includes(section), open = expanded[id] ?? current;
      return h('div', { className: 'me-nav-group', key: id }, h('div', { className: 'me-nav-row', 'data-current': current },
        button(pages[id][0], () => navigate(id), { icon: pages[id][1], disabled: busy, 'aria-current': section === id ? 'page' : undefined, 'data-admin-page': id }),
        children.length ? button(null, () => setExpanded(value => ({ ...value, [id]: !open })), { icon: 'down', className: 'me-nav-expand', 'aria-label': `${open ? '折叠' : '展开'}${pages[id][0]}`, 'aria-expanded': open, 'aria-controls': `me-nav-${id}`, disabled: busy }) : null),
        children.length && open ? h('div', { id: `me-nav-${id}`, className: 'me-nav-children' }, children.map(child => button(pages[child][0], () => navigate(child), { key: child, disabled: busy, 'aria-current': section === child ? 'page' : undefined, 'data-admin-page': child }))) : null);
    };
    return h(ERPTheme, { appearance, accentColor: 'violet', grayColor: 'gray', radius: 'large', scaling: '100%', className: 'me', 'data-appearance': appearance, 'data-density': density, onKeyDown: e => { if (e.key === 'Escape' && menuOpen) { e.stopPropagation(); closeMenu(); } } }, h('style', { 'data-erp-styles': true }, radixStyles + fontStyles + styles),
      h('header', { className: 'me-topbar', inert: searchOpen ? '' : undefined },
        h('div', { className: 'me-brand' }, button(null, () => setMenuOpen(v => !v), { className: 'me-icon-button me-mobile-menu', icon: 'menu', 'aria-label': '经营菜单', 'aria-expanded': menuOpen, 'aria-controls': 'me-business-nav' }), h('span', { className: 'me-brand-mark' }, h(Icon, { name: 'store', size: 18 })), h('span', { className: 'me-brand-name' }, 'Agentive'), h('small', null, 'WORKSPACE')),
        h('button', { className: 'me-global-search', onClick: openSearch, disabled: busy, 'aria-label': '搜索后台', 'aria-haspopup': 'dialog' }, h(Icon, { name: 'search', size: 16 }), h('span', null, '搜索'), h('kbd', null, /Mac|iPhone|iPad/.test(window.navigator.platform) ? '⌘ K' : 'Ctrl K')),
        h('div', { className: 'me-topbar-actions' }, module ? button('助理',()=>setAssistantOpen(v=>!v),{icon:'activity','aria-expanded':assistantOpen,'aria-label':'打开模块助理'}) : null, toggleHostSidebar ? button(null, toggleHostSidebar, { className: 'me-icon-button me-host-toggle', icon: 'back', 'aria-label': '折叠或展开 DSH 导航' }) : null,
          button(null, () => navigate('connections'), { className: 'me-icon-button me-help-toggle', icon: 'info', 'aria-label': '查看接入状态', disabled: busy }),
          h('label', { className: 'me-workspace' }, h('span', { className: 'me-store-avatar', 'aria-hidden': true }, (pageTitle || 'W').slice(0, 1).toUpperCase()), h('select', { 'aria-label': '经营工作区', value: workspace, disabled: busy || !workspaces.length, onChange: e => changeWorkspace(e.target.value) },
            !workspaces.length ? h('option', { value: '' }, workspaceReady ? '未选择工作区' : '正在读取…') : workspaces.map(w => h('option', { key: w.id, value: w.id }, w.title || w.id)))))),
      h('div', { className: `me-shell${menuOpen ? ' me-menu-open' : ''}${assistantOpen && module ? ' me-with-assistant' : ''}`, inert: searchOpen ? '' : undefined },
        menuOpen ? h('button', { className: 'me-nav-scrim', 'aria-label': '关闭经营菜单', onClick: closeMenu, tabIndex: -1 }) : null,
        h('nav', { id: 'me-business-nav', className: 'me-nav', 'aria-label': 'ERP 导航', onKeyDown: e => {
          if (e.key === 'Tab' && menuOpen) { const nodes = [...e.currentTarget.querySelectorAll('button:not(:disabled)')].filter(node => node.getClientRects().length); const first = nodes[0], last = nodes.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }
        } },
          button('关闭菜单', closeMenu, { icon: 'close', className: 'me-drawer-close' }),
          ...navGroups.map(([id, children]) => navItem(id, children)),
          h('div', { className: 'me-nav-divider' }, '销售渠道'), navItem('online_store', ['themes', 'store_pages', 'preferences']),
          h('div', { className: 'me-nav-divider' }, '应用'), navItem('apps'),
          h('div', { className: 'me-nav-bottom' }, button('设置', () => navigate('settings'), { icon: 'settings', disabled: busy, 'data-admin-page': 'settings', 'aria-current': section === 'settings' || settingsPages.includes(section) ? 'page' : undefined }))), content, assistantOpen && module ? h(AssistantPanel,{key:JSON.stringify(assistantContext),module,context:assistantContext,blocked:busy||editorDirty,onStart:onStartAssistant,onClose:()=>setAssistantOpen(false)}) : null),
      notice ? h('div', { role: 'status', className: 'me-toast' }, h(Icon, { name: 'check', size: 17 }), h('span', null, notice), button(null, () => setNotice(''), { icon: 'close', className: 'me-icon-button', 'aria-label': '关闭保存提示' })) : null,
      discard ? h(DiscardDialog, { request: discard, onResolve: resolveDiscard }) : null,
      searchOpen ? h(SearchDialog, { workspace, returnFocus: searchReturnFocus.current, onClose: () => setSearchOpen(false), onNavigate: navigate, onProduct: openEditor, onFile: openFile, onCustomer: id => openRecord('customers', id), onOrder: id => openRecord('orders', id) }) : null);

  }
  function apply(ctx) {
    ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: NS, order: 25, label: () => 'Agentive' }, () => h(Icon, { name: 'product' }))), 'mini-erp: sidebar');
    ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: NS }, () => h(Panel, { toggleHostSidebar: () => ctx.get('layout').toggleSidebar(), onStartAssistant: (workspaceId,prompt) => launchAssistant({sessions:ctx.get('sessions'),conversation:ctx.get('conversation'),uiWorkspace:ctx.get('uiWorkspace')},workspaceId,prompt) }))), 'mini-erp: panel');
  }
export { apply, Panel, pages, csvFile, AssistantPanel };
export const inject = ['slots'];
