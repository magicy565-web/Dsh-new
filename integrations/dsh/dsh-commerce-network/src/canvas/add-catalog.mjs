// What the add menu can start. Nodes are never created blank: each item hands a concrete
// request to the native Assistant (or opens an existing dialog) and leaves a pending draft on the canvas.

export const ADD_GROUPS = Object.freeze(['商品', '协作方', '渠道', '执行', '交易', '交给 Assistant']);

export const ADD_ITEMS = Object.freeze([
  {
    id: 'product', group: '商品', label: '添加产品', description: '把工作区已有的产品资料放进网络。', draftKind: 'product',
    prompt: '请读取当前工作区的产品资料，在对话中向我确认要加入这张网络的产品，再用 commerce_network_plan 保存。',
  },
  {
    id: 'factory', group: '协作方', label: '添加工厂', description: '提供产品与交付能力的一方。', draftKind: 'factory',
    prompt: '我想把一家工厂加入协作网络。请在对话中确认工厂名称、产品范围和可供市场，再用 commerce_network_plan 登记。',
  },
  {
    id: 'distributor', group: '协作方', label: '邀请海外代理商', description: '负责海外销售与客户关系的一方。', draftKind: 'distributor',
    prompt: '我想邀请一位海外代理商加入协作网络。请在对话中确认对方名称、销售区域与合作范围，再用 commerce_network_plan 登记。',
  },
  {
    id: 'agent', group: '协作方', label: '接入 Personal AI Worker', description: '登记独立服务商的 Agent，并创建受限连接凭据。', draftKind: 'personal_agent',
    prompt: '我想把一位 Personal AI Worker 接入当前协作网络。请先读取已登记成员，再引导我提供服务商名称、Agent 名称和服务能力。',
  },
  {
    id: 'channel', group: '渠道', label: '规划销售渠道', description: '为产品和目标市场建立渠道计划。', draftKind: 'channel', needsProject: true,
    needs: [{ kind: 'product', reason: '需要先有产品资料' }],
    prompt: '请为当前网络规划一个销售渠道。先读取产品和已有渠道，在对话中向我确认目标市场、平台和目标，再用 commerce_network_plan 保存。',
  },
  {
    id: 'mandate', group: '执行', label: '提出业务委托', description: '工厂与海外代理商之间的合作范围草稿。', draftKind: 'business_mandate', needsProject: true,
    needs: [{ kind: 'factory', reason: '需要先添加工厂' }, { kind: 'distributor', reason: '需要先邀请海外代理商' }],
    prompt: '请为当前网络提出一份业务委托草稿。先读取已登记的工厂与代理商，在对话中确认双方、销售区域和商业条款，再用 commerce_network_propose_business_mandate 保存为待批准草稿。',
  },
  {
    id: 'order', group: '执行', label: '提出服务委托', description: '向已接入的 Personal AI Worker 提出一项有边界的任务。', draftKind: 'service_order', needsProject: true,
    needs: [{ kind: 'personal_agent', reason: '需要先接入 Personal AI Worker' }, { anyOf: ['factory', 'distributor'], reason: '需要工厂或代理商作为委托方' }],
    prompt: '请为当前网络提出一项服务委托。先读取已登记的委托方和 Worker，在对话中确认任务范围和费用上限，再用 commerce_network_propose_order 保存为待授权草稿。',
  },
  {
    id: 'import-rfq', group: '交易', label: '导入询盘', description: '把买家询盘导入当前项目。', action: 'import-rfq', needsProject: true,
  },
  {
    id: 'review', group: '交给 Assistant', label: '梳理并补全当前网络', description: '让 Assistant 读取网络，指出缺口并给出下一步。', draftKind: null,
    prompt: '请读取当前协作网络，梳理已有的产品、协作方、委托和交付，指出缺失的资料与下一步建议。不要更改授权，缺少的信息在对话中问我。',
  },
]);

const count = (counts, kind) => counts[kind] || 0;

/** Whether an item can start now; a disabled item always carries the reason. */
export function itemAvailability(item, { kindCounts = {}, hasProject = false, pending = false, active = true } = {}) {
  if (!active) return { enabled: false, reason: '请先切换到这个会话的画布。' };
  if (pending && !item.action) return { enabled: false, reason: '上一项请求仍在提交。' };
  if (item.needsProject && !hasProject) return { enabled: false, reason: '请先创建协作项目。' };
  for (const need of item.needs || []) {
    const present = need.anyOf ? need.anyOf.some((kind) => count(kindCounts, kind) > 0) : count(kindCounts, need.kind) > 0;
    if (!present) return { enabled: false, reason: need.reason };
  }
  return { enabled: true, reason: null };
}

export const addItemById = (id) => ADD_ITEMS.find((item) => item.id === id) || null;
