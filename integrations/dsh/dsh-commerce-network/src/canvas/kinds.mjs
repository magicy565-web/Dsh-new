// Single catalogue of node kinds shared by the node card, search, add menu and views.
// Kinds come from the projections; the canvas never invents a kind of its own.

export const NODE_WIDTH = 264;
export const COMPACT_WIDTH = 184;
export const COMPACT_HEIGHT = 56;
export const NODE_HEIGHT_ESTIMATE = 176;
export const GRID = 8;

export const KIND_FAMILY = Object.freeze({
  product: 'product',
  factory: 'factory',
  distributor: 'distributor',
  personal_agent: 'ai',
  worker: 'ai',
  service_order: 'service',
  business_mandate: 'service',
  channel: 'channel',
  market: 'market',
  rfq: 'trade',
  buyer: 'trade',
  quote: 'trade',
  sample: 'trade',
  erp_order: 'trade',
  order: 'trade',
  approval: 'neutral',
  evidence: 'neutral',
});
export const kindFamily = (kind) => KIND_FAMILY[kind] || 'neutral';

// Ports describe where a connection may enter or leave a node of this kind.
const PORTS = Object.freeze({
  product: { in: false, out: true },
  market: { in: true, out: false },
  approval: { in: true, out: false },
  evidence: { in: true, out: false },
});
export const portsOf = (kind) => PORTS[kind] || { in: true, out: true };

export const KIND_GROUPS = Object.freeze([
  { id: 'goods', label: '商品', kinds: ['product'] },
  { id: 'parties', label: '协作方', kinds: ['factory', 'distributor', 'personal_agent'] },
  { id: 'channels', label: '渠道', kinds: ['market', 'channel', 'worker'] },
  { id: 'execution', label: '执行', kinds: ['business_mandate', 'service_order', 'approval', 'evidence'] },
  { id: 'trade', label: '交易', kinds: ['buyer', 'rfq', 'quote', 'sample', 'erp_order', 'order'] },
]);

export const VIEWS = Object.freeze([
  { id: 'all', label: '全局' },
  { id: 'network', label: '商业网络' },
  { id: 'execution', label: '执行流程' },
]);
const VIEW_KINDS = Object.freeze({
  network: new Set(['factory', 'distributor', 'personal_agent', 'service_order', 'business_mandate', 'product', 'market', 'channel', 'buyer']),
  execution: new Set(['personal_agent', 'service_order', 'worker', 'buyer', 'rfq', 'quote', 'order', 'erp_order', 'sample', 'approval', 'evidence']),
});
export const isVisibleInView = (view, kind) => !VIEW_KINDS[view] || VIEW_KINDS[view].has(kind);

const RUNNING = new Set(['running', 'claimed', 'queued', 'stop_requested']);
export const isRunningStatus = (status) => RUNNING.has(status);
