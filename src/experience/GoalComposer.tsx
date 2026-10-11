import { useState } from 'react';
import { Icon } from '../icons';
import { Modal } from '../Modal';
import { useDirty, useWrite, WriteNotice } from '../library/common';
import type { Goal } from '../types';

export function GoalComposer({ initial, readOnly, onClose, onCreated, onDirty }: {
  initial: string; readOnly: boolean; onClose: () => void; onCreated: (goal: Goal) => void; onDirty: (dirty: boolean) => void;
}) {
  const [description, setDescription] = useState(initial), [title, setTitle] = useState('');
  const writer = useWrite();
  useDirty(description !== initial || !!title || writer.busy || writer.uncertain, onDirty);
  async function save() {
    if (readOnly || !description.trim()) return;
    const result = await writer.write<{ goal: Goal }>('/goals', 'POST', {
      title: title.trim() || description.trim().replace(/\s+/gu, ' ').slice(0, 35),
      description: description.trim(), maxSteps: 3, maxOutputTokens: 4800,
    });
    if (result) { onDirty(false); onCreated(result.goal); }
  }
  return <Modal title="创建业务目标" onClose={onClose} className="muse-goal-modal">
    <form className="ys21-goal-sheet" onSubmit={e => { e.preventDefault(); void save(); }}>
      <h2>从这个目标开始</h2>
      <label htmlFor="muse-goal-description">你希望达成的结果</label>
      <textarea id="muse-goal-description" value={description} onChange={e => setDescription(e.target.value)} required maxLength={15000} rows={5} disabled={readOnly || writer.busy || writer.uncertain}/>
      <details className="ys21-create-options"><summary>目标名称 <Icon name="chevron" size={16}/></summary><label>名称<input maxLength={160} value={title} onChange={e => setTitle(e.target.value)} disabled={readOnly || writer.busy || writer.uncertain}/></label></details>
      <p className="ys21-safe-line"><Icon name="shield" size={17}/>保存后选择资料并确认启动。外部操作和经营支出需要单独授权。</p>
      <WriteNotice writer={writer}/>
      <button className="ys21-create-submit" type="submit" disabled={readOnly || writer.busy || !description.trim()}>{writer.busy ? '正在保存…' : writer.uncertain ? '重试原保存请求' : '保存目标'}<Icon name="arrow-right" size={18}/></button>
    </form>
  </Modal>;
}
