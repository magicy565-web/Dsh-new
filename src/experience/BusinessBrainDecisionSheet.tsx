import { useState } from 'react';
import type { Goal } from '../types';
import type { PulseCard } from './BusinessBrainHome';
import { api } from '../api';
import { Icon } from '../icons';

export function BusinessBrainDecisionSheet({
  card,
  goal,
  conversationId,
  readOnly,
  onClose,
  onStartGoal,
  onOpenGoal,
  onContinueConversation,
  onReviewed
}: {
  card: PulseCard;
  goal?: Goal;
  conversationId?: string;
  readOnly: boolean;
  onClose: () => void;
  onStartGoal: (card: PulseCard) => void;
  onOpenGoal: (goal: Goal) => void;
  onContinueConversation: (conversationId: string) => void;
  onReviewed: () => void;
}) {
  const draft = card.decisionDraft;
  const [interpretation, setInterpretation] = useState<'supported' | 'contradicted' | 'inconclusive'>('inconclusive');
  const [rationale, setRationale] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  if (!draft) return null;

  const persisted = draft.status === 'persisted' && !!card.action.decisionId && Number.isSafeInteger(draft.revision);
  const brokenGoalLink = persisted && !goal;
  const canReview = persisted && !!goal && draft.recommendation.verification.metricId !== 'next-window';

  async function submitReview() {
    if (!draft || !canReview || !conversationId || !card.action.decisionId || !draft.revision || !rationale.trim() || readOnly || reviewing) return;
    setReviewing(true);
    setReviewError(null);
    try {
      await api(
        `/conversations/${encodeURIComponent(conversationId)}/brain/reviews`,
        'POST',
        {
          requestId: crypto.randomUUID(),
          expectedRevision: 0,
          decisionId: card.action.decisionId,
          decisionRevision: draft.revision,
          sourceRefs: draft.sourceRefs,
          metricEvidenceId: draft.recommendation.verification.metricId,
          interpretation,
          rationale: rationale.trim(),
          alternativeExplanations: ['当前复盘未建立独立因果证据；如需因果结论，应进入受审查的实验或归因系统。']
        }
      );
      onReviewed();
    } catch (reason) {
      setReviewError(reason instanceof Error ? reason.message : '结果复盘暂时未完成');
    } finally {
      setReviewing(false);
    }
  }

  return (
    <div className="brain-sheet-layer" role="presentation">
      <button className="brain-sheet-backdrop" aria-label="关闭判断详情" onClick={onClose} />
      <section className="brain-sheet" role="dialog" aria-modal="true" aria-labelledby="brain-sheet-title">
        <div className="brain-sheet-handle" />
        <header className="brain-sheet-header">
          <div>
            <span className="brain-eyebrow">DECISION PREVIEW</span>
            <h2 id="brain-sheet-title">为什么现在值得处理</h2>
          </div>
          <button type="button" className="brain-sheet-close" onClick={onClose} aria-label="关闭"><Icon name="close" size={18} /></button>
        </header>

        <div className="brain-sheet-scroll">
          <div className="brain-decision-problem">
            <span>当前问题</span>
            <strong>{draft.problem}</strong>
          </div>

          <section className="brain-detail-section">
            <div className="brain-detail-heading"><span>我的判断</span><small>{persisted ? '已保存决策' : '预览，不是因果结论'}</small></div>
            <p>{draft.recommendation.rationale}</p>
          </section>

          <section className="brain-detail-section">
            <div className="brain-detail-heading"><span>需要排除的原因</span><small>{draft.hypotheses.length} 个假设</small></div>
            <div className="brain-hypotheses">
              {draft.hypotheses.map((hypothesis, index) => (
                <div className="brain-hypothesis" key={hypothesis.id}>
                  <span>{index + 1}</span>
                  <div><strong>{hypothesis.explanation.split('：')[0]}</strong><p>{hypothesis.explanation.includes('：') ? hypothesis.explanation.slice(hypothesis.explanation.indexOf('：') + 1) : hypothesis.explanation}</p></div>
                </div>
              ))}
            </div>
          </section>

          <section className="brain-detail-section">
            <div className="brain-detail-heading"><span>可选路径</span><small>先不执行外部动作</small></div>
            <div className="brain-options">
              {draft.options.map(option => (
                <div className={`brain-option ${option.id === draft.recommendation.optionId ? 'recommended' : ''}`} key={option.id}>
                  <div><strong>{option.title}</strong>{option.id === draft.recommendation.optionId && <em>建议</em>}</div>
                  <p>{option.description}</p>
                  <small>风险：{option.risk === 'low' ? '低' : option.risk === 'medium' ? '中' : '高'} · {option.capability === 'none' ? '观察' : option.capability === 'analysis' ? '分析' : '内部草稿'}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="brain-detail-section">
            <div className="brain-detail-heading"><span>如何验证</span><small>{draft.recommendation.verification.observationDays} 天观察</small></div>
            <ul className="brain-stop-list">
              {draft.recommendation.verification.stopConditions.map(item => <li key={item}>{item}</li>)}
            </ul>
            <div className="brain-evidence-note"><Icon name="shield" size={15} /><span>{card.evidenceIds.length ? `已绑定 ${card.evidenceIds.length} 个授权数据来源` : '当前没有可展示的授权数据来源'}</span></div>
          </section>

          {canReview && (
            <section className="brain-detail-section brain-review-section">
              <div className="brain-detail-heading"><span>结果复盘</span><small>只记录观察，不自动归因</small></div>
              <p>如果这个目标已经执行过，可以把下一观察窗口的结果记录回来。选择结论时，请按证据判断，不要把相关变化直接当成因果效果。</p>
              <div className="brain-review-choices" role="group" aria-label="复盘结论">
                {([
                  ['inconclusive', '证据不足'],
                  ['supported', '支持判断'],
                  ['contradicted', '与判断相反']
                ] as const).map(([value, label]) => (
                  <button key={value} type="button" className={interpretation === value ? 'selected' : ''} onClick={() => setInterpretation(value)}>{label}</button>
                ))}
              </div>
              <textarea value={rationale} onChange={event => setRationale(event.target.value)} placeholder="写下你为什么这样判断（至少一句）" maxLength={3000} />
              {reviewError && <p className="brain-review-error" role="alert">{reviewError}</p>}
              <button type="button" className="brain-review-submit" disabled={readOnly || reviewing || !rationale.trim()} onClick={() => void submitReview()}>
                {reviewing ? '正在保存复盘…' : '保存这次复盘'}
              </button>
            </section>
          )}
        </div>

        <footer className="brain-sheet-footer">
          <div>
            <span>{goal ? '已有经营目标' : brokenGoalLink ? '原经营目标不可用' : '还没有绑定经营目标'}</span>
            <small>{goal ? goal.title : brokenGoalLink ? '该决策不能绑定到新目标，请先修复原目标的审核关系。' : '开始后会创建一个普通 Goal，不会直接执行外部动作。'}</small>
          </div>
          {conversationId && <button type="button" className="brain-primary-action" onClick={() => { onClose(); onContinueConversation(conversationId); }}>在原会话继续</button>}
          {goal
            ? <button type="button" className="brain-primary-action" onClick={() => { onClose(); onOpenGoal(goal); }}>进入目标<Icon name="chevron" size={15} /></button>
            : brokenGoalLink
              ? <button type="button" className="brain-primary-action" disabled>目标不可用</button>
              : <button type="button" className="brain-primary-action" disabled={readOnly} onClick={() => { onClose(); onStartGoal(card); }}>建立这个目标<Icon name="chevron" size={15} /></button>}
        </footer>
      </section>
    </div>
  );
}
