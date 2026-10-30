import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { LoaderCircle, RotateCcw, X, AlertCircle, Clock3 } from 'lucide-react';
import { KINDS } from '../model.mjs';
import { KindIcon, familyClass } from '../NodeCard.jsx';
import { draftStatusLabel } from './drafts.mjs';

/** A pending request on the canvas. It is not a business record and is never saved. */
export const DraftCard = memo(function DraftCard({ data }) {
  const { draft } = data;
  const busy = draft.status === 'submitting';
  const failed = draft.status === 'failed' || draft.status === 'expired';
  return (
    <article className={`cn-node cn-draft ${familyClass(draft.kind)} cn-draft-${draft.status}`} aria-label={`待确认：${draft.title}，${draftStatusLabel(draft.status)}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} className="cn-port-quiet" />
      <div className="cn-node-top">
        <span className="cn-node-icon"><KindIcon kind={draft.kind} /></span>
        <span className="cn-node-type">待确认 · {KINDS[draft.kind] || '请求'}</span>
        <button type="button" className="cn-node-menu nodrag nopan" aria-label={`移除待确认项 ${draft.title}`} title="移除" onClick={() => data.onDismiss(draft.id)}><X size={15} /></button>
      </div>
      <h3>{draft.title}</h3>
      <p className="cn-node-summary">
        {failed ? draft.reason : draft.status === 'waiting' ? 'Assistant 已收到请求。请在左侧会话补充资料，保存后这里会变成真实节点。' : '正在把请求交给当前 Assistant…'}
      </p>
      <footer>
        <span className={`cn-status ${failed ? 'cn-tone-red' : 'cn-tone-amber'}`}>
          {busy ? <LoaderCircle size={12} className="cn-spin" aria-hidden="true" /> : failed ? <AlertCircle size={12} aria-hidden="true" /> : <Clock3 size={12} aria-hidden="true" />}
          {draftStatusLabel(draft.status)}
        </span>
        {failed && draft.retryable && <button type="button" className="cn-text-button nodrag nopan" onClick={() => data.onRetry(draft)}><RotateCcw size={12} aria-hidden="true" />重新提交</button>}
      </footer>
      <Handle type="source" position={Position.Right} isConnectable={false} className="cn-port-quiet" />
    </article>
  );
});
