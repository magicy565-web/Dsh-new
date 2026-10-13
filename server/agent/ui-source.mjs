import { createHash } from 'node:crypto';
import { AgentHttpError } from './auth.mjs';
import { isBusinessLibraryArtifact } from '../business-library-policy.mjs';
import { isOriginalMuseArtifact } from '../muse-owner-policy.mjs';

const canonical = value => value === undefined ? 'null' : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const fail = (status, code, message) => { throw new AgentHttpError(status, message, { code }); };

/** Original Store admission and every Pi dispatch share this pure deny-only gate. */
export function assertAgentUiPublicSource(state, source) {
  const artifact = state.artifacts.find(item => item.id === source.artifactId);
  if (!artifact) fail(409, 'AGENT_SOURCE_STALE', '所选公开材料不存在。');
  const privateArtifact = item => isBusinessLibraryArtifact(state, item) || isOriginalMuseArtifact(state, item) || item.workerOwner || item.sourceConversationId || item.sourceRunId || item.sourceGoalId || Object.keys(item.metadata || {}).length;
  if (privateArtifact(artifact)) fail(403, 'AGENT_PRIVATE_SOURCE_REJECTED', '企业库、原 Muse/Agent 私有回执及有关联的文件不能发送给模型。请另行提供公开规格。');
  const version = artifact.versions.find(item => item.version === source.version);
  if (!version || version.sha256 !== source.sha256) fail(409, 'AGENT_SOURCE_STALE', '所选文件的确切版本或 SHA 已变化；不能静默替换为最新版本。');
  if (!['text/plain', 'text/markdown', 'text/csv', 'application/json'].includes(version.mimeType)) fail(400, 'AGENT_SOURCE_TYPE_UNSUPPORTED', '仅支持公开 UTF-8 TXT、Markdown、CSV、JSON；不解析图片或 PDF。');
  if (version.size > 12_000) fail(413, 'AGENT_SOURCE_TOO_LARGE', '公开规格最多 12000 UTF-8 字节，不能静默截断。');
  if (state.artifacts.some(item => item.id !== artifact.id && privateArtifact(item) && item.versions.some(row => row.sha256 === source.sha256)) || state.workspaceAgentTasks?.tasks.some(task => task.deliverables.some(file => file.sha256 === source.sha256)))
    fail(403, 'AGENT_PRIVATE_COPY_REJECTED', '公开文件不能是内部材料或原 Agent 回执的重新上传副本。');
  return { artifact, version };
}

export function assertAgentUiApprovalSource(state, task) {
  if (!task?.uiApproval) return;
  const { version, confirmed, approvedAt, previewHash, ...snapshot } = task.uiApproval;
  if (version !== 1 || confirmed !== true || snapshot.oneTime !== true || snapshot.futureAccess !== false || !approvedAt || hash(snapshot) !== previewHash ||
    task.subject === undefined || task.requestKey !== snapshot.requestKey || task.title !== snapshot.title || task.type !== snapshot.type || hash(task.input) !== hash(snapshot.executionInput) || hash(task.preset) !== hash(snapshot.presetSnapshot) ||
    createHash('sha256').update(snapshot.source?.content || '').digest('hex') !== snapshot.source?.sha256)
    fail(409, 'AGENT_UI_APPROVAL_CHANGED', '原一次性许可、确切来源或任务输入已变化。');
  assertAgentUiPublicSource(state, snapshot.source);
}
