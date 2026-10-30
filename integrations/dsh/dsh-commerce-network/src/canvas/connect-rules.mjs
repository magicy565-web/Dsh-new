// Which connections the canvas may start, and what each one means.
// A drawn line never changes business facts: every rule ends in a confirmed hand-off to the
// native Assistant, which saves a draft that still needs the owner's approval.

const reference = (node) => `「${node.title}」（${node.refId}，${node.kind}）`;

const RULES = Object.freeze([
  {
    id: 'mandate', from: ['factory'], to: ['distributor'], draftKind: 'business_mandate',
    label: '提出业务委托草稿',
    note: '草稿只记录合作范围与商业条款，不会自动授权、发送消息或扣费。',
    prompt: (s, t) => `请为工厂${reference(s)}与海外代理商${reference(t)}提出一份业务委托草稿。先读取当前项目与产品资料，在对话中向我确认销售区域、产品范围和商业条款，再用 commerce_network_propose_business_mandate 保存为待我批准的草稿。`,
  },
  {
    id: 'service', from: ['factory', 'distributor'], to: ['personal_agent'], draftKind: 'service_order',
    label: '规划服务委托',
    note: '委托保持「待授权」，批准前不会运行，也不会占用预算。',
    prompt: (s, t) => `请以${reference(s)}作为委托方，向 Personal AI Worker ${reference(t)}规划一项服务委托。核对该 Worker 已登记的能力，在对话中向我确认任务范围和费用上限，再用 commerce_network_propose_order 保存为待授权草稿。`,
  },
  {
    id: 'followup', from: ['service_order'], to: ['personal_agent'], draftKind: 'service_order',
    when: (s) => s.status === 'accepted', whenNot: '只有已验收的委托才能作为后续委托的前序。',
    label: '基于验收结果提出后续委托',
    note: '新委托会等待前序交付验收后才具备调度条件。',
    prompt: (s, t) => `委托${reference(s)}已验收。请向 Personal AI Worker ${reference(t)}提出一项后续委托，用 commerce_network_propose_order 保存，并把 dependsOn 设为 ["${s.refId}"]。先在对话中向我确认任务范围和费用上限。`,
  },
  {
    id: 'product-channel', from: ['product'], to: ['channel'], draftKind: null,
    label: '把产品加入渠道计划',
    note: '由 Assistant 更新渠道计划，已有的手动布局会保留。',
    prompt: (s, t) => `请把产品${reference(s)}加入销售渠道${reference(t)}的计划。先读取当前网络，用 commerce_network_plan 保存修改并保留已有业务记录与手动布局。`,
  },
  {
    id: 'product-agent', from: ['product'], to: ['worker', 'personal_agent'], draftKind: null,
    label: '交给 Assistant 处理',
    note: '由 Assistant 核对授权范围后给出方案，不会直接分享产品资料。',
    prompt: (s, t) => `请围绕产品${reference(s)}与${reference(t)}给出下一步安排。先读取真实资料；涉及第三方 Agent 时只提出待批准的草稿，不要分享资料或发送消息。`,
  },
  {
    id: 'channel-agent', from: ['channel'], to: ['personal_agent'], draftKind: 'service_order',
    label: '委托 Worker 跟进渠道',
    note: '委托保持「待授权」，批准前不会运行。',
    prompt: (s, t) => `请为销售渠道${reference(s)}向 Personal AI Worker ${reference(t)}规划一项跟进委托，在对话中确认范围与费用上限后，用 commerce_network_propose_order 保存为待授权草稿。`,
  },
]);

export const canStartConnection = (kind) => RULES.some((rule) => rule.from.includes(kind));
export const canReceiveConnection = (kind) => RULES.some((rule) => rule.to.includes(kind));

/** Validate a drag from `source` to `target`. Always explains a refusal. */
export function connectionRule(source, target, edges = []) {
  if (!source || !target) return { ok: false, reason: '请连接到画布上的节点。' };
  if (source.draft || target.draft) return { ok: false, reason: '待确认的草稿还没有成为业务记录。' };
  if (source.id === target.id) return { ok: false, reason: '节点不能连接到自己。' };
  if (edges.some((edge) => (edge.source === source.id && edge.target === target.id) || (edge.source === target.id && edge.target === source.id))) {
    return { ok: false, reason: '这两个节点之间已有业务关系。' };
  }
  const rule = RULES.find((candidate) => candidate.from.includes(source.kind) && candidate.to.includes(target.kind));
  if (!rule) {
    return { ok: false, reason: canStartConnection(source.kind) ? '这类节点之间没有可发起的业务操作。' : '这类节点不能作为连线起点；交易链路由交易系统生成。' };
  }
  if (rule.when && !rule.when(source)) return { ok: false, reason: rule.whenNot };
  return { ok: true, rule };
}

export const connectionPrompt = (rule, source, target) => rule.prompt(source, target);

/** Actions offered when a connection is dropped on empty canvas. */
export function suggestionsFrom(source) {
  const seen = new Set();
  return RULES.filter((rule) => rule.from.includes(source.kind) && (!rule.when || rule.when(source))).flatMap((rule) => {
    if (seen.has(rule.label)) return [];
    seen.add(rule.label);
    return [{
      id: `from:${rule.id}`, label: rule.label, description: rule.note, draftKind: rule.draftKind,
      prompt: `请从${reference(source)}出发，${rule.label}。先读取当前网络；缺少的协作方或 Worker 先在对话中向我确认，再保存为待我批准的草稿。${rule.id === 'followup' ? `新委托的 dependsOn 设为 ["${source.refId}"]。` : ''}`,
    }];
  });
}
