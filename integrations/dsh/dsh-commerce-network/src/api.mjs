export const API_ROOT = '/commerce-network-api';
const LIMIT = 4 * 1024 * 1024;
export class ApiError extends Error {
  constructor(message, code, status) { super(message); this.name='ApiError'; this.code=code; this.status=status; }
}
export function requestId() { return `canvas:${globalThis.crypto.randomUUID()}`; }
export async function callApi(path, {signal, body} = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    method: body ? 'POST' : 'GET', credentials:'same-origin', cache:'no-store', signal,
    headers: body ? {'Content-Type':'application/json','X-Commerce-Client':'native-canvas'} : {'Accept':'application/json'},
    ...(body ? {body:JSON.stringify(body)} : {}),
  });
  const raw = await response.text();
  if (raw.length > LIMIT) throw new ApiError('返回的业务数据过大，请缩小项目范围。','RESPONSE_TOO_LARGE',response.status);
  let value;
  try { value=JSON.parse(raw); } catch { throw new ApiError('服务未返回有效数据，请检查插件连接。','INVALID_RESPONSE',response.status); }
  if (!response.ok || value?.ok===false) {
    const code=value?.error?.code || value?.code || `HTTP_${response.status}`;
    throw new ApiError(value?.error?.message || value?.message || '操作未完成，请重新读取最新状态。',code,response.status);
  }
  return value;
}
export function unwrap(value) { return value?.data ?? value?.state ?? value; }
export function stateFrom(value) { const data=unwrap(value); return data?.state ?? data; }
export function errorText(error) {
  if(error?.status===409 || /REVISION|CONFLICT/.test(error?.code??'')) return '数据已被更新。请刷新后重新核对；你的修改尚未覆盖服务端。';
  if(error?.status===401 || error?.status===403) return '当前会话无法访问此工作区。请在已授权的原生会话中打开画布。';
  if(error?.name==='AbortError') return '请求已中断，请核对最新业务状态。';
  return error?.message || '连接暂时不可用。请稍后重试。';
}
export function safeUrl(value) {
  if(typeof value!=='string')return null;
  try { const u=new URL(value,globalThis.location?.origin||'https://localhost');return ['http:','https:'].includes(u.protocol)?u.href:null; } catch { return null; }
}
