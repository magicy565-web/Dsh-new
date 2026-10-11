import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import { isMuseFile, museFileUrl, museMessageFiles } from './museControl';
import type { CloudFile, MuseTask } from './museControl';
import type { Message } from '../types';

function MuseFile({ file }: { file: CloudFile }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const controller = useRef<AbortController>();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  async function download(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (controller.current) return;
    const request = new AbortController(); controller.current = request; setBusy(true); setError('');
    const timeout = window.setTimeout(() => request.abort(), 20000);
    let blobUrl: string | undefined;
    try {
      const response = await fetch(museFileUrl(file)!, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: request.signal });
      if (!response.ok) {
        if (response.status === 401) throw Error('登录已失效，请恢复原登录后重试下载。');
        if (response.status === 403) throw Error('当前账号无权下载此附件。');
        if (response.status === 404) throw Error('此版本附件不可用或不属于当前账号，请核对原订单。');
        throw Error('下载失败，请稍后重试。');
      }
      const bytes = await response.arrayBuffer();
      const sha = await sha256(bytes);
      if (sha !== file.sha256 || response.headers.has('X-Content-SHA256') && response.headers.get('X-Content-SHA256') !== file.sha256) throw Error('附件校验失败，下载内容与原回执不一致。');
      if (!alive.current) return;
      if (request.signal.aborted) throw Error('下载超时，请重试原附件。');
      blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
      const link = document.createElement('a'); link.href = blobUrl; link.download = file.filename || '任务文件';
      document.body.appendChild(link); link.click(); link.remove();
    } catch (cause) {
      if (alive.current) setError(request.signal.aborted ? '下载超时，请重试原附件。' : cause instanceof Error && cause.name !== 'TypeError' ? cause.message : '无法连接下载服务，请重试原附件。');
    } finally {
      clearTimeout(timeout); controller.current = undefined;
      if (blobUrl) { const url = blobUrl; window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
      if (alive.current) setBusy(false);
    }
  }
  return <div><a className="cloud-file" href={museFileUrl(file)!} download aria-disabled={busy} onClick={event => void download(event)}><Icon name="file" size={18}/>{file.filename || '任务文件'}<span>{busy ? '正在校验…' : '下载'}</span></a>{error && <p className="control-input-note" role="alert">{error}</p>}</div>;
}
async function sha256(bytes: BufferSource) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
}
export function MuseFiles({ files, authorized = true, allowedFiles }: { files: unknown; authorized?: boolean; allowedFiles?: unknown }) {
  if (!Array.isArray(files) || files.length > 20) return <p className="control-input-note">文件引用不完整，等待原订单核对。</p>;
  const seen = new Set<string>();
  return <>{files.map((file, index) => {
    if (!isMuseFile(file) || seen.has(file.id)) return <p className="control-input-note" key={index}>文件引用不完整，等待原订单核对。</p>;
    seen.add(file.id);
    const allowed = authorized && (allowedFiles === undefined || Array.isArray(allowedFiles) && allowedFiles.some(ref => isMuseFile(ref) && ref.id === file.id && ref.version === file.version && ref.sha256 === file.sha256 && ref.filename === file.filename));
    return allowed ? <MuseFile key={file.id + ':' + file.sha256} file={file}/> : <p className="control-input-note" key={index}>当前账号未获此附件的下载授权。</p>;
  })}</>;
}
export function MuseMessageFiles({ message, tasks, readOnly }: { message: Message; tasks?: MuseTask[]; readOnly: boolean }) {
  const files = museMessageFiles(message);
  const [checked, setChecked] = useState<{ serialized: string; hash: unknown; valid: boolean }>();
  const receipt = message.museReceipt, hash = message.museReceiptHash;
  const wellFormed = Array.isArray(files);
  // Bootstrap polling recreates object identities. Keep an unchanged receipt
  // mounted while hashing so a slow file download survives routine refreshes.
  const serialized = wellFormed ? JSON.stringify(receipt) : '';
  useEffect(() => {
    let alive = true;
    if (wellFormed) void sha256(new TextEncoder().encode(serialized)).then(actual => {
      if (alive) setChecked({ serialized, hash, valid: actual === hash });
    }).catch(() => { if (alive) setChecked({ serialized, hash, valid: false }); });
    return () => { alive = false; };
  }, [serialized, hash, wellFormed]);
  if (files === undefined) return null;
  if (files === null || checked && checked.serialized === serialized && checked.hash === hash && !checked.valid) return <p className="control-input-note">回执附件信息不完整或校验失败，等待原订单核对。</p>;
  if (!checked || checked.serialized !== serialized || checked.hash !== hash) return <p className="control-input-note" role="status">正在核对回执附件…</p>;
  const original = receipt as Record<string, unknown>;
  const task = tasks?.find(item => item.orderId === message.museOrderId && item.nativeAgentId === message.conversationId && item.receiptHash === hash && item.returnedHash === hash
    && item.workerId === original.workerId && item.requestId === original.requestId && item.taskRef === original.taskRef && item.attemptId === original.attemptId && item.fence === original.fence);
  return <><p className="control-input-note">Muse 回执附件 · 外部成果未经独立核验。</p><MuseFiles files={files} authorized={!readOnly && !!task && Array.isArray(task.receipt?.files)} allowedFiles={task?.receipt?.files}/></>;
}
