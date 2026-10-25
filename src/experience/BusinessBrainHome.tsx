import { useEffect, useState } from 'react';
import type { Bootstrap, Goal } from '../types';
import { api, ApiError } from '../api';
import { Icon } from '../icons';
import { BusinessBrainDecisionSheet } from './BusinessBrainDecisionSheet';
import './business-brain-home.css';

export type DecisionDraft = {
  status: string;
  revision?: number;
  goalId: string | null;
  businessGoalVerified: boolean;
  problem: string;
  sourceRefs: Array<{ kind: string; id: string; revision: string; sha256: string; fields: string[] }>;
  hypotheses: Array<{ id: string; explanation: string; supportingEvidence: string[]; contradictingEvidence: string[]; missingEvidence: string[] }>;
  options: Array<{ id: string; title: string; kind: string; capability: string; description: string; evidenceIds: string[]; risk: string; requirements: string[] }>;
  recommendation: {
    optionId: string;
    rationale: string;
    verification: { metricId: string; observationDays: number; stopConditions: string[] };
  };
};

export type PulseCard = {
  id: string;
  priority: number;
  title: string;
  reason: string;
  evidenceIds: string[];
  executable: boolean;
  businessGoalVerified: boolean;
  action: { kind: string; goalId?: string; decisionId?: string };
  decisionDraft?: DecisionDraft;
};

type Brief = {
  cards: PulseCard[];
  coldStart: boolean;
  gaps: string[];
  diagnosisStatus: string;
  unavailableEntries?: boolean;
};

function newestConversation(data: Bootstrap | null) {
  return [...(data?.conversations || [])]
    .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())[0];
}

export function BusinessBrainHome({
  data,
  loading,
  readOnly,
  onStartAnalysis,
  onStartGoal,
  onOpenGoal,
  onContinueConversation,
  onNavigate,
}: {
  data: Bootstrap | null;
  loading: boolean;
  readOnly: boolean;
  onStartAnalysis: (value: string, conversationId?: string) => void;
  onStartGoal: (card: PulseCard, conversationId?: string) => void;
  onOpenGoal: (goal: Goal) => void;
  onContinueConversation: (conversationId: string) => void;
  onNavigate: (page: 'goals' | 'library' | 'activity' | 'chat') => void;
}) {
  const [conversationId, setConversationId] = useState<string | undefined>(() => newestConversation(data)?.id);
  useEffect(() => { if (!conversationId) setConversationId(newestConversation(data)?.id); }, [conversationId, data?.conversations]);
  const conversation = data?.conversations.find(item => item.id === conversationId);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [value, setValue] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<PulseCard | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    setBrief(null); setSelectedCard(null); setError(null);
    if (!conversation?.id) {
      setBrief(null); setChecking(false);
      return;
    }

    let cancelled = false;
    let requestSequence = 0;
    const load = async () => {
      const request = ++requestSequence;
      setChecking(true);
      try {
        const result = await api<{ data?: Brief; status?: string }>(
          `/conversations/${encodeURIComponent(conversation.id)}/brain/brief`
        );
        if (!cancelled && request === requestSequence) {
          if(result.status==='unconfigured'){setBrief(null);setSelectedCard(null);setError('经营大脑尚未配置，请先由原 Workspace Host 绑定已审核的资料与模型接收者。');return;}
          setBrief(result.data || null);
          setError(null);
        }
      } catch (reason) {
        if (!cancelled && request === requestSequence) { setBrief(null); setSelectedCard(null); setError(reason instanceof ApiError && /(?:SOURCE|SCOPE|BINDING|SESSION|REVISION|AUTHORIZATION)/.test(reason.code || '') ? '资料版本或会话授权已变更。请让管理员核对原模型、资料版本与事实键授权；重新选择资料后使用明确授权的新会话，不会自动继承旧授权。' : reason instanceof Error ? reason.message : '经营简报暂时不可用'); }
      } finally {
        if (!cancelled && request === requestSequence) setChecking(false);
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [conversation?.id, readOnly, reloadNonce]);

  function submit(valueToSend: string) {
    const text = valueToSend.trim();
    if (!text || readOnly || checking) return;
    setValue('');
    onStartAnalysis(text, conversationId);
  }

  const cards = brief?.cards || [];
  const activeGoals = [...(data?.goals || [])]
    .filter(goal => !['completed', 'cancelled'].includes(goal.status))
    .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
    .slice(0, 2);

  return (
    <section className="brain-home" aria-label="企业经营大脑">
      <header className="brain-header">
        <div>
          <span className="brain-eyebrow">BUSINESS BRAIN</span>
          <h1>现在最值得做什么？</h1>
          <p>我会先看已经授权的经营事实，再给你下一步。判断与执行分开，外部动作仍然经过现有 Goal、预算和审批。</p>
        </div>
        <button className="brain-menu" type="button" aria-label="打开主对话" onClick={() => onNavigate('chat')}>
          <Icon name="chat" size={18} />
        </button>
      </header>

      <div className="brain-section-label">
        <span>{checking ? '正在刷新经营信号' : '当前最值得关注'}</span>
        <span>{brief?.coldStart ? '首次观察' : brief?.diagnosisStatus === 'measured' ? '实时观察' : ''}</span>
      </div>

      {loading || (checking && !brief) ? (
        <div className="brain-empty" role="status"><strong>正在读取经营事实…</strong><p>只读取已经授权的业务来源，不生成虚构数据。</p></div>
      ) : error ? (
        <div className="brain-empty" role="status"><strong>经营大脑暂时离线</strong><p>{error}</p><button type="button" onClick={() => onNavigate('chat')}>回到主对话</button></div>
      ) : cards.length ? (
        <div className="brain-cards">
          {cards.map(card => {
            const goal = card.action.goalId ? data?.goals.find(item => item.id === card.action.goalId) : undefined;
            const hasGoal = !!goal;
            const brokenGoalLink = !!card.action.goalId && !goal;
            return (
              <article className={`brain-card ${card.priority >= 94 ? 'tone-urgent' : 'tone-focus'}`} key={card.id}>
                <div className="brain-card-top">
                  <span>{card.priority >= 94 ? '需要尽快看' : '建议关注'}</span>
                  <small>{card.evidenceIds.length ? `${card.evidenceIds.length} 个证据来源` : '经营观察'}</small>
                </div>
                <h2>{card.title}</h2>
                <p>{card.reason}</p>
                <div className="brain-card-bottom">
                  <span>{brokenGoalLink ? '原经营目标不可用' : card.businessGoalVerified ? '已绑定经营目标' : hasGoal ? '进入现有目标' : '建立一个可继续执行的目标'}</span>
                  <div className="brain-card-actions">
                    {card.decisionDraft && (
                      <button type="button" className="brain-explain" onClick={() => setSelectedCard(card)}>
                        为什么？
                      </button>
                    )}
                    <button type="button" className="brain-primary" disabled={readOnly || brokenGoalLink} onClick={() => {
                      if (hasGoal && goal) {
                        onOpenGoal(goal);
                        return;
                      }
                      onStartGoal(card, conversationId);
                    }}>
                      {brokenGoalLink ? '目标不可用' : hasGoal ? '进入目标' : '开始处理'}
                      <Icon name="chevron" size={14} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="brain-empty">
          <strong>{brief?.diagnosisStatus === 'no-supported-metrics' ? '还没有可判断的经营信号' : '当前没有高优先级动作'}</strong>
          <p>{brief?.diagnosisStatus === 'no-supported-metrics' ? '先把真实产品、询盘或电商数据接入，经营大脑才会给出基于事实的建议。' : '你可以直接告诉我正在卡住的事情，我会在同一个主对话里继续分析。'}</p>
          <button type="button" onClick={() => submit('请基于当前企业资料和经营数据，判断现在最值得处理的一件事，并先说明证据。')}>让助手判断</button>
        </div>
      )}

      {activeGoals.length > 0 && (
        <section className="brain-goals" aria-label="正在推进">
          <div className="brain-section-label"><span>正在推进</span><button type="button" onClick={() => onNavigate('goals')}>查看全部</button></div>
          <div className="brain-goal-list">
            {activeGoals.map(goal => (
              <button type="button" key={goal.id} onClick={() => onOpenGoal(goal)}>
                <span><strong>{goal.title}</strong><small>{goal.status === 'running' ? '正在推进' : goal.status === 'paused' ? '已暂停' : '待开始'}</small></span>
                <span className="brain-goal-arrow"><Icon name="chevron" size={15} /></span>
              </button>
            ))}
          </div>
        </section>
      )}

      <form className="brain-composer" onSubmit={event => { event.preventDefault(); submit(value); }}>
        <label htmlFor="brain-prompt">直接告诉我现在要解决什么</label>
        <div>
          <input id="brain-prompt" value={value} onChange={event => setValue(event.target.value)} placeholder="例如：最近询盘很多，但没人持续跟进" maxLength={4000} disabled={readOnly} />
          <button type="submit" aria-label="直接发送" disabled={readOnly || !value.trim() || checking}>
            <Icon name="arrow" size={18} />
          </button>
        </div>
      </form>

      {selectedCard?.decisionDraft && (
        <BusinessBrainDecisionSheet
          card={selectedCard}
          goal={selectedCard.action.goalId ? data?.goals.find(item => item.id === selectedCard.action.goalId) : undefined}
          conversationId={conversation?.id}
          readOnly={readOnly}
          onClose={() => setSelectedCard(null)}
          onStartGoal={card => onStartGoal(card, conversationId)}
          onOpenGoal={onOpenGoal}
          onContinueConversation={onContinueConversation}
          onReviewed={() => { setSelectedCard(null); setReloadNonce(value => value + 1); }}
        />
      )}
    </section>
  );
}
