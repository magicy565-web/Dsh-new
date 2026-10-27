import { getCanvasNodeContext } from './graph.mjs';
const ACTIONS = Object.freeze({
  inspect:'核对这张卡片的原始数据、出处、最近更新时间和缺失信息。不要修改业务状态。',
  improve:'评估这张卡片的下一步可行行动；优先复用现有项目资料，缺少证据时明确标为待确认。',
  followup:'针对这张卡片生成下一轮可执行的客户/渠道跟进建议；对外发送前必须经过授权。',
  verify:'重新核查关联渠道是否真实连接、任务是否确实执行、是否有可验证的业务结果。',
  revise:'根据当前对话对这张卡片关联的业务计划进行增量修改，保留其他节点和所有手动布局。',
  stop:'核对真实任务状态并提出暂停方案；若有正在运行的外部任务，必须等待真实停止回执。',
});
export function buildAgentCanvasInstruction(graph, nodeId, action='inspect', extra='') {
  const context = getCanvasNodeContext(graph,nodeId);
  if (!Object.hasOwn(ACTIONS, action)) throw new TypeError('Unknown action');
  if (typeof extra !== 'string' || extra.length > 2000) throw new TypeError('Invalid request text');
  return [
    `当前 Channel Atlas 画布上下文：项目 ${context.projectId}；节点 ${context.nodeId}（${context.kind}，业务引用 ${context.refId}）；工作区 revision ${context.workspaceRevision ?? '未知'}。`,
    ...(graph.commerceNetwork ? ['该节点可能属于跨组织商业网络；所有身份、授权、委托及回执须由服务端按权限重新核验，画布连线不等于合同或执行许可。'] : []),
    `我的要求：${ACTIONS[action]}`,
    ...(extra.trim()? [`补充说明：${extra.trim()}`]:[]),
    '请先通过 Workspace 的授权工具读取最新事实并检查 revision，必要的修改请通过原生业务命令原子提交；不要根据这段文本假定有渠道账号、成交、付款或 Worker 执行成功。',
  ].join('\n');
}
