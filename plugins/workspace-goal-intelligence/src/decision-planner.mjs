import { safeJson } from './contracts.mjs';

const evidenceFor = signal => signal?.evidenceId ? [signal.evidenceId] : [];
const sourceFor = signal => signal?.sourceRef ? [signal.sourceRef] : [];
const first = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback;

function hypothesesFor(signal, evidenceIds) {
  const byType = {
    'followup-aging': [
      ['h1', '跟进确实出现中断', '当前证据证明有超时未回复询盘，但还不能证明中断的原因。', ['FOLLOWUP_EVENT_DATA']],
      ['h2', '跟进动作发生了，但没有被当前数据源记录', '当前信号可能来自记录缺失；需要对照实际沟通记录。', ['COMMUNICATION_LOG']],
      ['h3', '客户本身暂时不需要继续推进', '超时未回复也可能是客户侧节奏，而不是内部执行问题。', ['CUSTOMER_RESPONSE_CONTEXT']]
    ],
    'inquiry-pipeline': [
      ['h1', '跟进动作尚未发生', '待处理数量是明确观察，但需要核对实际业务动作。', ['FOLLOWUP_EVENT_DATA']],
      ['h2', '跟进已经发生但结果未回写', '当前来源只显示未完成状态，不能排除状态回写延迟。', ['OUTCOME_RECORD']],
      ['h3', '当前询盘结构发生变化', '样本可能包含不同质量的询盘，需补充来源或分群证据。', ['INQUIRY_SEGMENT']]
    ],
    'inquiry-outcome': [
      ['h1', '结果记录不完整', '当前来源明确存在未知结果，但未知不等于丢单。', ['OUTCOME_RECORD']],
      ['h2', '结果存在于其他系统', '当前 Workspace 数据源可能没有覆盖最终成交结果。', ['EXTERNAL_RESULT_SOURCE']],
      ['h3', '当前状态模型不足以表达结果', '需要核对状态定义和业务验收规则。', ['STATUS_DEFINITION']]
    ],
    'product-evidence': [
      ['h1', '产品销售资料确实存在缺口', '当前产品库统计直接观察到缺图、缺 SKU、缺资料或缺供货信息。', []],
      ['h2', '资料已经存在但没有正确关联', '当前指标只统计产品库关联状态，需要核对文件与产品绑定关系。', ['DOCUMENT_LINKAGE']],
      ['h3', '销售渠道要求高于当前资料标准', '即使产品库完整，目标市场仍可能要求额外证据。', ['CHANNEL_REQUIREMENTS']]
    ],
    'commerce-outcome': [
      ['h1', '当前电商结果已被数据源观察到', '订单样本是结果观察，不足以证明某项策略导致了结果。', []],
      ['h2', '结果覆盖仍不完整', '需要核对观察窗口是否覆盖全部相关订单。', ['COVERAGE_CHECK']],
      ['h3', '结果变化来自其他经营因素', '即使订单变化真实，也需要独立证据区分产品、流量、季节等因素。', ['CAUSAL_EVIDENCE']]
    ],
    'commerce-cohort': [
      ['h1', '当前商品队列结果真实存在', '当前来源观察到订单结果，但还不能证明某项经营动作导致了结果。', []],
      ['h2', '队列覆盖不足', '需要核对观察窗口和订单覆盖是否完整。', ['COVERAGE_CHECK']],
      ['h3', '结果由其他经营因素共同造成', '产品、流量、季节或市场变化都可能影响队列结果。', ['CAUSAL_EVIDENCE']]
    ]
  };
  const templates = byType[signal?.type] || [
    ['h1', '当前信号反映真实经营变化', '需要继续用同口径数据验证。', ['COMPARABLE_OBSERVATION']],
    ['h2', '当前信号来自数据完整性问题', '需要核对来源和覆盖范围。', ['SOURCE_COVERAGE']],
    ['h3', '当前信号存在其他业务解释', '目前没有足够证据排除其他解释。', ['ALTERNATIVE_EXPLANATION']]
  ];
  return templates.map(([id, title, explanation, missingEvidence]) => ({
    id,
    explanation: `${title}：${explanation}`,
    supportingEvidence: evidenceIds,
    contradictingEvidence: [],
    missingEvidence
  }));
}

function optionsFor(signal, evidenceIds) {
  const common = [
    {
      id: 'investigate',
      title: '先核对原因',
      kind: 'investigate',
      capability: 'analysis',
      description: '围绕当前信号补齐缺失证据，不直接进行外部业务操作。',
      evidenceIds,
      risk: 'low',
      estimate: null,
      requirements: ['需要可访问的企业业务事实']
    },
    {
      id: 'wait',
      title: '继续观察',
      kind: 'wait',
      capability: 'none',
      description: '保持当前策略，等待下一观察窗口形成可比结果。',
      evidenceIds,
      risk: 'low',
      estimate: null,
      requirements: ['需要声明下一观察窗口']
    }
  ];
  if (signal?.type === 'product-evidence' || signal?.type === 'inquiry-outcome' || signal?.type === 'inquiry-pipeline') {
    common.splice(1, 0, {
      id: 'draft-checklist',
      title: '先整理内部清单',
      kind: 'investigate',
      capability: 'draft',
      description: '只生成内部核对或补件清单，不发送消息、不修改外部系统。',
      evidenceIds,
      risk: 'low',
      estimate: null,
      requirements: ['需要内部资料或记录可访问']
    });
  }
  return common;
}

/**
 * Evidence-first decision drafting. This produces a non-executable proposal.
 * It deliberately does not estimate probability, causal impact, or spend.
 * A model or human can enrich it later, but every proposed action remains
 * behind the existing Goal/approval/Worker gates.
 *
 * A cold-start draft is intentionally allowed. It is a preview for the human
 * home UI; persistence still requires the reviewed Brain context + Goal path.
 */
export function draftDecisionFromDiagnosis({ diagnosis = null, context = null, goalId = null } = {}) {
  const signals = Array.isArray(diagnosis?.signals) ? diagnosis.signals.filter(Boolean) : [];
  const goalIds = Array.isArray(context?.context?.payload?.goalIds) ? context.context.payload.goalIds : [];
  const selectedGoal = typeof goalId === 'string' && goalId.trim() ? goalId : goalIds[0] || null;
  if (!signals.length) return { status: 'needs-evidence', goalId: selectedGoal, reason: '没有足够的经营信号生成决策草案。', options: [] };

  const top = [...signals].sort((a, b) =>
    (b.priority ?? 0) - (a.priority ?? 0)
    || (b.current?.stale ?? 0) - (a.current?.stale ?? 0)
    || (b.current?.pending ?? 0) - (a.current?.pending ?? 0)
    || (b.current?.unknown ?? 0) - (a.current?.unknown ?? 0)
    || String(a.id || '').localeCompare(String(b.id || ''))
  )[0];

  const evidenceIds = evidenceFor(top);
  const sourceRefs = sourceFor(top);
  const options = optionsFor(top, evidenceIds);
  const problemByType = {
    'followup-aging': '有询盘超过企业设定的跟进窗口，值得先核对跟进是否中断。',
    'inquiry-pipeline': '有询盘仍处于待跟进状态，值得先核对下一步动作。',
    'inquiry-outcome': '部分询盘没有明确结果记录，暂不能把它们判断为丢单。',
    'product-evidence': '部分产品销售资料不完整，进入外部销售动作前应先补齐。',
    'commerce-outcome': '已有电商销售结果样本，可以用来做后续目标复盘。',
    'commerce-cohort': '已有商品队列销售结果样本，可以用来做后续目标复盘。'
  };
  const problem = top?.gaps?.includes('NO_COMPARABLE_BASELINE')
    ? '当前经营信号缺少可比基线。'
    : first(top?.summary, problemByType[top?.type] || first(top?.conclusion, '当前存在值得核对的经营信号。'));

  const recommendation = options.find(option => option.id === 'investigate') || options[0];
  const verificationMetricId = top?.evidenceId || 'next-window';

  return safeJson({
    status: 'proposal-only',
    goalId: selectedGoal,
    businessGoalVerified: Boolean(selectedGoal),
    problem,
    sourceRefs,
    hypotheses: hypothesesFor(top, evidenceIds),
    options,
    recommendation: {
      optionId: recommendation.id,
      rationale: selectedGoal
        ? '当前证据足以决定下一步先做什么，但不足以证明因果关系；先补证据，再决定是否执行外部动作。'
        : '当前没有经过审核的经营 Goal，因此只提供决策预览；先建立或选择 Goal，再进入可持续执行链。',
      verification: {
        metricId: verificationMetricId,
        observationDays: top?.type === 'followup-aging' || top?.type === 'inquiry-pipeline' ? 7 : 14,
        stopConditions: ['出现新的可比结果', '证据与当前判断冲突']
      }
    }
  }, 24 * 1024);
}
