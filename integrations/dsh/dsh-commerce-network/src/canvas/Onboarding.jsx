import React from 'react';
import { ArrowRight, ArrowUpRight, Plus, X } from 'lucide-react';

const START = '请基于当前工作区已有的产品资料，为我建立一个海外销售协作网络。先读取真实资料；缺少目标市场或参与方信息时，在当前对话中询问我，再保存业务计划。';
const WORKER = '我想把自己的 Personal AI Worker 注册到当前协作网络。请先读取已登记成员和项目，并引导我提供服务商名称、Agent 名称和服务能力。';
const AGENT = '我想建立工厂与海外代理商的协作关系。请读取当前资料，并在对话中确认双方名称、销售区域与合作范围。';

/** Shown over the empty canvas. The grid underneath stays usable; closing the card leaves a hint on the add button. */
export function Onboarding({ hasProject, pending, onAsk, onDismiss }) {
  return (
    <section className="cv-onboarding" aria-label="开始搭建协作网络">
      <button type="button" className="cn-icon-button cv-onboarding-close" aria-label="关闭引导" onClick={onDismiss}><X size={15} /></button>
      <span className="cn-eyebrow">YOUR COMMERCE NETWORK</span>
      <h2>{hasProject ? '让这个项目开始协作' : '把海外销售，连接成一张网络'}</h2>
      <p>在对话里说出目标，Assistant 会把产品、工厂、代理商与 Personal AI Worker 整理成可持续协作的业务网络。节点只来自真实记录。</p>
      <button type="button" className="cn-button cn-primary" disabled={pending} onClick={() => onAsk(null, START)}><Plus size={15} />从产品资料开始<ArrowRight size={15} /></button>
      <div>
        <button type="button" disabled={pending} onClick={() => onAsk(null, WORKER)}>接入我的 AI Worker<ArrowUpRight size={13} /></button>
        <button type="button" disabled={pending} onClick={() => onAsk(null, AGENT)}>邀请海外销售代理<ArrowUpRight size={13} /></button>
      </div>
      <small>业务资料由你提供 · 所有执行保留授权与交付记录</small>
    </section>
  );
}
