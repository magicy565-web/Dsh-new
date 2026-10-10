import { Icon } from '../icons';
import { BrandMark } from '../brand/BrandMark';
import type { Bootstrap, Goal, Run } from '../types';
import './focus-v21.css';

const note = (status: string) => ({draft:'等待启动',running:'正在执行',awaiting_approval:'需要批准',review_required:'等待验收',paused:'已暂停',blocked:'遇到阻碍',failed:'需要检查',completed:'已验收',cancelled:'已取消'} as Record<string,string>)[status] || status;

export function HarnessTag({ runtime, onDetails }: { runtime?: Bootstrap['runtime']; onDetails: () => void }) {
  const native = runtime?.kind === 'deepseek-harness';
  const ready = native && runtime?.configured === true;
  return <button type="button" className={`ys21-runtime ${ready?'is-native':''}`} onClick={onDetails} aria-label={ready?'查看原生 Harness 配置信息':'查看 Harness 连接要求'}>
    <span className="ys21-live-dot" aria-hidden="true"/>
    <span>{ready?'Harness 已配置':native?'Harness 未配置':'Harness 未启用'}</span>
    <Icon name="chevron" size={15}/>
  </button>;
}

export function FocusHome({data, loading, draft, onDraft, onNew, onOpen, onGuide, onRuntime}: {
  data: Bootstrap | null; loading: boolean; draft: string; onDraft: (value: string) => void; onNew: (description: string) => void; onOpen: (goal: Goal) => void; onGuide: () => void; onRuntime: () => void;
}) {
  const goals = [...(data?.goals || [])].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  const prioritized = goals.find(g=>['awaiting_approval','review_required'].includes(g.status)) || goals.find(g=>['running','paused','blocked','failed','draft'].includes(g.status)) || goals[0];
  const currentRuns: Run[] = (data?.runs || []).filter(r=>r.goalId===prioritized?.id);
  const latestRun = currentRuns.at(-1);
  return <main className="ys21-home" data-testid="v21-home">
    <div className="ys21-hero"><span className="ys21-hero-mark"><BrandMark bare size={48}/></span><p className="ys21-eyebrow">YUANSHAN / GROWTH WORK</p><h1>想把生意<br/>做到哪里？</h1><p>说出目标。剩下的工作，在一个会话里推进。</p><form className="ys21-entry" onSubmit={e=>{e.preventDefault();if(draft.trim())onNew(draft.trim());}}><textarea value={draft} aria-label="输入业务目标" maxLength={15000} rows={2} placeholder="例如：帮我开发美国客户…" onChange={e=>onDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();e.currentTarget.form?.requestSubmit();}}}/><button type="submit" aria-label="继续创建目标" disabled={!draft.trim()}><Icon name="arrow" size={21}/></button></form><HarnessTag runtime={data?.runtime} onDetails={onRuntime}/></div>
    {prioritized && <section className="ys21-resume" aria-label="继续上次工作"><div className="ys21-resume-head"><span>继续工作</span><span className="ys21-pill">{note(prioritized.status)}</span></div><button type="button" className="ys21-resume-button" onClick={()=>onOpen(prioritized)}><strong>{prioritized.title}</strong><span>{latestRun?.plan?.find(p=>p.status==='running')?.title || (prioritized.status==='draft'?'确认资料后启动':latestRun?.error?.message||'查看最新工作记录')}</span><Icon name="arrow-right" size={21}/></button></section>}
    <section className="ys21-starters" aria-label="常用业务目标"><div className="ys21-small-heading"><span>快速开始</span><button type="button" onClick={onGuide}>查看案例 <Icon name="chevron" size={15}/></button></div><div className="ys21-quick-grid">
      <button type="button" onClick={()=>onNew('帮我开发美国进口商与批发商。先根据已确认的企业产品，找到可核验的客户与采购线索；未经审批不得对外联系。')}><Icon name="people" size={22}/><strong>找海外客户</strong><Icon name="arrow-right" size={16}/></button>
      <button type="button" onClick={()=>onNew('帮我研究适合现有产品的海外销售渠道，比较进入门槛、目标客群、成本及可以验证的市场机会。')}><Icon name="channels" size={22}/><strong>找增长渠道</strong><Icon name="arrow-right" size={16}/></button>
    </div></section>
    {!loading&&!goals.length&&<p className="ys21-hint">先从一个目标开始，企业资料可以随后选择。</p>}
  </main>;
}
