import { Modal } from '../Modal';
import { Notice, useRead } from '../library/common';
import type { Bootstrap } from '../types';
import type { Session } from '../api';
import type { useConversationRuntime } from './useConversationRuntime';

export const MEDUSA_ADMIN_URL = 'https://medusa.cnsubscribe.xyz/dashboard/';
type CatalogStatus = { medusa: { configured: boolean; connection: string; mode: string; reason: string | null } };
type RuntimeRead = ReturnType<typeof useConversationRuntime>;

export function PluginStatusDialog({ data, session, runtime, snapshotStale, onClose }: {
  data: Bootstrap | null; session: Session; runtime: RuntimeRead; snapshotStale: boolean; onClose: () => void;
}) {
  const allowed = session.user?.role === 'admin' || session.user?.role === 'operator';
  const medusa = useRead<CatalogStatus>(allowed ? '/medusa/catalog/status' : null);
  const validMedusa = typeof medusa.value?.medusa?.configured === 'boolean';
  const connectors = data?.capabilities?.connectors;
  return <Modal title="插件与连接" onClose={onClose} className="harness-plugins">
    <h2>插件与连接</h2>
    <p className="harness-muted">配置状态来自当前服务；已配置仍需实际调用与授权验证。</p>
    {snapshotStale && <p className="harness-muted" role="status">工作空间状态已失效，下方连接器仅为上次快照。</p>}
    <section className="harness-connection" aria-label="聊天运行时状态">
      <div><h3>聊天运行时</h3><span className="harness-state">{runtime.status === 'loading' ? '读取中' : runtime.status === 'unavailable' || !data || snapshotStale ? '状态不可用' : data.runtime.configured ? '已配置 · 在线待验证' : '未配置'}</span></div>
      <p>{runtime.value ? `${runtime.value.engine.toUpperCase()} · ${runtime.value.engineScope}` : runtime.status === 'legacy' ? '当前服务未提供业务会话运行时接口，沿用原聊天接口。' : '等待原服务的运行时响应。'}</p>
      <Notice error={runtime.error} retry={runtime.retry}/>
    </section>
    <section className="harness-connection" aria-label="OMP 插件清单状态">
      <div><h3>OMP 插件清单</h3><span className="harness-state">状态不可用</span></div>
      <p>当前服务尚未提供完整插件状态，请由管理员核对。工具包可发现、连接器已配置，均不表示业务插件已可执行。</p>
    </section>
    <section className="harness-connection" aria-label="Medusa 连接状态">
      <div><h3>Medusa</h3><span className="harness-state">{medusa.loading ? '读取中' : !allowed || medusa.error || !validMedusa ? '状态不可用' : medusa.value!.medusa.configured ? '已配置 · 在线待验证' : '未配置'}</span></div>
      <p>{!allowed ? '当前账号无权读取连接配置。' : validMedusa && medusa.value!.medusa.configured ? '原连接仅用于内部产品草稿；不代表已发布或有库存。' : '配置或在线状态尚未得到确认。'}</p>
      <Notice error={medusa.error} retry={medusa.retry}/>
      <a className="harness-admin-link" href={MEDUSA_ADMIN_URL} target="_blank" rel="noopener noreferrer">打开官方 Medusa Admin ↗</a>
      <small>独立登录；此链接不表示 Workspace 已连接该服务。</small>
    </section>
    <section className="harness-connection" aria-label="原连接器配置">
      <h3>原连接器配置</h3>
      {connectors?.length ? connectors.map(connector => <article className="harness-connector" key={connector.id}>
        <div><strong>{connector.name}</strong><span className="harness-state">{snapshotStale ? '上次快照 · 当前未确认' : !connector.enabled ? '不可用 · 已禁用' : connector.status === 'ready' && connector.adapterConfigured && connector.credentialConfigured ? '已配置 · 在线待验证' : '未配置或不可用'}</span></div>
        <p>{connector.description || '使用原连接器授权与审批。'}</p>
      </article>) : <p>{connectors ? '尚无已登记连接器。' : '当前快照没有提供连接器状态。'}</p>}
    </section>
    <p className="harness-muted">长期目标尚未完成验证，当前测试版优先开放聊天与资料管理。</p>
    <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>返回工作台</button></div>
  </Modal>;
}

