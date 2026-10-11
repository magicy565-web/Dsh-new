import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from '../icons';
import { api, ApiError, requestId } from '../api';
import type { Artifact } from '../types';
import type { AssetRef } from './types';

export const pid = encodeURIComponent;
export const stamp = (value: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
export function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="bl-field">{label}{children}</label>; }
export function Notice({ error, retry }: { error: string; retry?: () => void }) { return error ? <div className="bl-error" role="alert"><p>{error}</p>{retry && <button type="button" className="text-button" onClick={retry}>重试读取</button>}</div> : null; }
export function Empty({ title, children }: { title: string; children?: ReactNode }) { return <div className="bl-empty"><span className="ys-empty-glyph" aria-hidden="true"><Icon name="library" size={30}/></span><h3>{title}</h3>{children}</div>; }
export function useRead<T>(path: string | null, reloadKey: number = 0) {
  const [value, setValue] = useState<T | null>(null), [loading, setLoading] = useState(!!path), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  useEffect(() => { let alive = true; setValue(null); setError(''); setLoading(!!path); if (path) void api<T>(path).then(result => { if (alive) setValue(result); }).catch(cause => { if (alive) setError(cause.message); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, [path, refresh, reloadKey]);
  return { value, loading, error, retry: () => setRefresh(n => n + 1) };
}

// A failed connection leaves an unknown commit. Freeze that exact request until
// it succeeds or the server gives a definite rejection; never silently mint a new ID.
export function useWrite() {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState(false), [uncertain, setUncertain] = useState(false);
  const lock = useRef(false), alive = useRef(true), pending = useRef<{ path: string; method: string; body: Record<string, unknown> } | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function write<T>(path: string, method: string, body: Record<string, unknown>, originalRequestId?: string): Promise<T | undefined> {
    if (lock.current) return;
    const attempt = pending.current || { path, method, body: { ...body, requestId: originalRequestId ?? requestId() } };
    pending.current = attempt; lock.current = true; setBusy(true); setError(''); setConflict(false);
    try { const result = await api<T>(attempt.path, attempt.method, attempt.body); pending.current = null; if (alive.current) setUncertain(false); return alive.current ? result : undefined; }
    catch (cause) { if (!alive.current) return; const unknown = cause instanceof ApiError && (cause.status === 0 || cause.code === 'INVALID_RESPONSE'); setUncertain(unknown); if (!unknown) pending.current = null; setConflict(cause instanceof ApiError && cause.code === 'REVISION_CONFLICT'); setError(unknown ? '未收到保存结果，服务器可能已经保存。输入已保留；请重试原请求以确认结果。' : cause instanceof Error ? cause.message : '保存未完成'); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return { busy, error, conflict, uncertain, write, clear: () => { setError(''); setConflict(false); } };
}
export function WriteNotice({ writer, onReload }: { writer: ReturnType<typeof useWrite>; onReload?: () => void }) { return <><Notice error={writer.error} />{writer.conflict && <p className="bl-help">服务端已有新修订，你的输入没有被覆盖。{onReload && <button type="button" className="text-button" onClick={onReload}>放弃本地输入并读取最新版本</button>}</p>}{writer.uncertain && <p className="bl-help">确认结果前暂时锁定编辑。再次点击保存会使用相同请求 ID 和内容。</p>}</>; }
export function useDirty(dirty: boolean, onDirty: (dirty: boolean) => void) { useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]); }
export async function readUpload(file: File): Promise<Record<string, unknown>> {
  if (file.size > 5 * 1024 * 1024) throw new Error('文件超过 5 MiB，请选择更小的文件');
  if (!/\.(txt|md|csv|json|pdf|png|jpe?g|webp)$/i.test(file.name)) throw new Error('支持 TXT、Markdown、CSV、JSON、PDF、PNG、JPEG、WebP');
  const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('文件读取失败')); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(file); });
  return { filename: file.name, title: file.name, base64, metadata: { businessLibrary: { visibility: 'internal' } }, requestId: requestId() };
}
export function assetFrom(artifact: Artifact): AssetRef { return { artifactId: artifact.id, version: artifact.currentVersion, sha256: artifact.sha256 }; }
export function AssetPreview({ asset, alt = '资料图片' }: { asset: AssetRef; alt?: string }) {
  const read = useRead<{ encoding: string; content: string; version: { mimeType: string } }>(`/artifacts/${pid(asset.artifactId)}/content?version=${asset.version}`);
  const result = read.value;
  return <section className="bl-preview">{read.loading ? <p role="status">正在校验并读取文件…</p> : read.error ? <Notice error={read.error} retry={read.retry} /> : result?.encoding === 'utf8' ? <pre>{result.content.slice(0, 100000)}{result.content.length > 100000 ? '\n（预览前 100,000 字符，下载查看完整文件）' : ''}</pre> : result?.version?.mimeType?.startsWith('image/') ? <img src={`data:${result.version.mimeType};base64,${result.content}`} alt={alt} /> : <p className="bl-help">PDF 与其他二进制文件仅支持下载，当前不提供页预览。</p>}<a className="bl-download" href={`/api/artifacts/${pid(asset.artifactId)}/download?version=${asset.version}`} download>下载此版本</a></section>;
}
