import React from 'react';
import { Activity, Bot, Check, ChevronRight, Clock3, Plus, Users, X } from 'lucide-react';
import { KindIcon, familyClass } from '../NodeCard.jsx';
import { KINDS, eventLabel, timestamp } from '../model.mjs';
import { IconButton } from '../ui.jsx';

export function ActivityDrawer({ state, onClose, onSelect }) {
  const events = [...(state.events || [])].reverse().slice(0, 100);
  return (
    <aside className="cv-drawer" aria-label="协作动态">
      <header><Activity size={16} aria-hidden="true" /><strong>协作动态</strong><span className="cn-mono">{events.length}</span><IconButton label="关闭协作动态" onClick={onClose}><X size={16} /></IconButton></header>
      <div className="cv-drawer-list">
        {events.length ? events.map((event, index) => (
          <button type="button" className="cv-event" key={event.id || index} onClick={() => onSelect(event.entityId || event.orderId || event.agentServiceId)}>
            <span className="cv-event-dot"><Check size={11} aria-hidden="true" /></span>
            <span><b>{eventLabel(event)}</b><small className="cn-mono">{timestamp(event.at || event.createdAt)}{event.actorType ? ` · ${event.actorType === 'worker' ? 'Personal Agent' : '工作区'}` : ''}</small></span>
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        )) : <div className="cv-panel-empty"><Clock3 size={24} aria-hidden="true" /><p>第一条协作记录，将从这里开始。</p></div>}
      </div>
    </aside>
  );
}

export function MembersPanel({ state, onClose, onAsk, onSelect }) {
  const network = state.commerceNetwork || {};
  const parties = (network.parties || []).filter((party) => party.type !== 'provider' && party.type !== 'agent_provider');
  const agents = network.agentServices || [];
  const agentState = (agent) => (agent.status === 'connected' ? '已连接' : agent.status === 'revoked' ? '访问已撤销' : '等待连接');
  return (
    <aside className="cv-side" aria-label="协作成员">
      <header><Users size={16} aria-hidden="true" /><strong>协作成员</strong><IconButton label="关闭协作成员" onClick={onClose}><X size={16} /></IconButton></header>
      <p className="cv-side-intro">连接提供产品、市场关系和专业服务的每一方。</p>
      <div className="cv-member-list">
        {parties.map((party) => (
          <button type="button" key={party.id} onClick={() => onSelect(`${party.type}:${party.id}`)}>
            <span className={`cn-node-icon ${familyClass(party.type)}`}><KindIcon kind={party.type} size={17} /></span>
            <span><b>{party.displayName}</b><small>{KINDS[party.type] || party.type}{party.marketCode ? ` · ${party.marketCode}` : ''}</small></span>
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        ))}
        {agents.map((agent) => (
          <button type="button" key={agent.id} onClick={() => onSelect(`personal_agent:${agent.id}`)}>
            <span className={`cn-node-icon ${familyClass('personal_agent')}`}><Bot size={17} aria-hidden="true" /></span>
            <span><b>{agent.displayName}</b><small>{agentState(agent)} · Personal Agent</small></span>
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        ))}
        {!parties.length && !agents.length && <div className="cv-panel-empty"><Users size={24} aria-hidden="true" /><p>还没有协作成员。</p></div>}
      </div>
      <button type="button" className="cn-button cn-primary" onClick={() => onAsk(null, '为当前项目添加一位协作成员。请在当前对话中确认这是工厂、海外代理商还是 Personal AI Worker 服务商，并收集必要资料后登记。')}><Plus size={15} />通过对话添加成员</button>
    </aside>
  );
}
