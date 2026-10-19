export type PluginPackage = {
  id: string; name: string; title: string; version: string; description: string;
  packageSha256: string; fileCount: number; byteCount: number; selectedIn: string[];
  extensions: string[]; skills: string[];
  backend: { ownership: string; selected: boolean | null; verifiedOnline: boolean };
  lifecycle: { selection: boolean; hotUnload: boolean; physicalRemoval: string };
};
export type PluginRelease = {
  id: string; pluginId: string; name: string; version: string; publisher: string;
  description: string; license: string; fingerprint: string; status: string;
  importedBy: string; reviewedBy: string | null; reviewNote: string;
  createdAt: string; updatedAt: string; runtimeVerified: boolean; enterpriseDataAuthorized: boolean;
};
export type PluginIntent = {
  id: string; requestId: string; subject: string; action: string; pluginId: string;
  configuration: string; packageSha256: string; status: string; createdAt: string;
  executed: boolean; dataDeleted: boolean;
};
export type PluginLibraryView = {
  schemaVersion: 1; workspaceId: string; revision: number; mode: 'inventory-only' | 'review-and-request';
  inventory: { schemaVersion: 1; snapshotSha256: string; profiles: { configuration: string; sha256: string; selected: string[] }[]; packages: PluginPackage[]; onlineVerified: boolean; codeExecuted: boolean };
  releases: PluginRelease[]; releaseCount: number; intents: PluginIntent[]; publisherCount: number;
  capabilities: { publicationReview: boolean; changeRequests: boolean; appliesChanges: boolean; isolatedExecution: boolean; enterpriseDataGrants: boolean };
  notice: string;
};
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 2048): value is string => typeof value === 'string' && value.length <= max;
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 100 && value.every(item => text(item, 512));
const booleans = (value: unknown, keys: string[]) => record(value) && keys.every(key => typeof value[key] === 'boolean');
const profile = (value: unknown) => record(value) && text(value.configuration, 100) && digest(value.sha256) && strings(value.selected);
const plugin = (value: unknown) => record(value) && ['id', 'name', 'title', 'version', 'description'].every(key => text(value[key]))
  && digest(value.packageSha256) && integer(value.fileCount) && integer(value.byteCount)
  && strings(value.selectedIn) && strings(value.extensions) && strings(value.skills)
  && record(value.backend) && text(value.backend.ownership) && (value.backend.selected === null || typeof value.backend.selected === 'boolean') && typeof value.backend.verifiedOnline === 'boolean'
  && booleans(value.lifecycle, ['selection', 'hotUnload']) && record(value.lifecycle) && text(value.lifecycle.physicalRemoval);
const release = (value: unknown) => record(value) && ['id', 'pluginId', 'name', 'version', 'publisher', 'description', 'license', 'status', 'importedBy', 'reviewNote', 'createdAt', 'updatedAt'].every(key => text(value[key]))
  && typeof value.id === 'string' && /^[a-f0-9-]{36}$/.test(value.id) && digest(value.fingerprint)
  && (value.reviewedBy === null || text(value.reviewedBy, 128)) && booleans(value, ['runtimeVerified', 'enterpriseDataAuthorized']);
const intent = (value: unknown) => record(value) && ['id', 'requestId', 'subject', 'action', 'pluginId', 'configuration', 'status', 'createdAt'].every(key => text(value[key]))
  && digest(value.packageSha256) && booleans(value, ['executed', 'dataDeleted']);
export function parsePluginLibraryView(value: unknown, workspaceId: string): PluginLibraryView {
  if (!record(value) || value.schemaVersion !== 1 || value.workspaceId !== workspaceId || !integer(value.revision)
    || !['inventory-only', 'review-and-request'].includes(String(value.mode)) || !text(value.notice, 4096)
    || !record(value.inventory) || value.inventory.schemaVersion !== 1 || !digest(value.inventory.snapshotSha256)
    || !Array.isArray(value.inventory.profiles) || value.inventory.profiles.length > 32 || !value.inventory.profiles.every(profile)
    || !Array.isArray(value.inventory.packages) || value.inventory.packages.length > 100 || !value.inventory.packages.every(plugin)
    || !booleans(value.inventory, ['onlineVerified', 'codeExecuted'])
    || !Array.isArray(value.releases) || value.releases.length > 200 || !value.releases.every(release)
    || !Array.isArray(value.intents) || value.intents.length > 100 || !value.intents.every(intent)
    || !integer(value.publisherCount) || !integer(value.releaseCount)
    || !booleans(value.capabilities, ['publicationReview', 'changeRequests', 'appliesChanges', 'isolatedExecution', 'enterpriseDataGrants']))
    throw new Error('插件服务返回了不完整、跨工作空间或不支持的响应，操作已停止。');
  return value as unknown as PluginLibraryView;
}
export function parsePluginReceipt(value: unknown): { schemaVersion: 1; revision: number } {
  if (!record(value) || value.schemaVersion !== 1 || !integer(value.revision)) throw new Error('未收到可确认的原请求回执。');
  return { schemaVersion: 1, revision: value.revision };
}
export const pluginStatusText: Record<string, string> = {
  submitted: '待独立审核', approved: '审核通过 · 未发布', rejected: '已拒绝', published: '清单已发布', suspended: '已下架', 'trust-unavailable': '发布者信任失效',
  'awaiting-verified-executor': '待停机处理', applying: '处理中 · 需核对', 'selection-applied': '工具配置已写入 · 重启生效', 'not-applied': '已核对 · 未应用',
};
