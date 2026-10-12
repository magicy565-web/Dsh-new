import type { Artifact, Message, Run } from '../types';
import { VerifiedFile } from './MuseFiles';

export function ConversationFiles({ message, artifacts, runs, readOnly }: { message: Message; artifacts: Artifact[]; runs: Run[]; readOnly: boolean }) {
  if (!message.artifactId || message.status !== 'complete') return null;
  const reference = message.artifactReference;
  const run = runs.find(value => value.id === message.runId && value.conversationId === message.conversationId);
  const artifact = artifacts.find(value => value.id === message.artifactId && value.sourceRunId === run?.id && value.sourceConversationId === message.conversationId);
  const version = artifact?.versions.find(value => value.version === reference?.version && value.sha256 === reference?.sha256);
  if (readOnly || !reference || reference.id !== artifact?.id || run?.outputArtifactId !== artifact?.id || !version) return <p className="control-input-note">文件版本或访问范围需要核对。</p>;
  const file = { ...reference, filename: version.filename };
  const url = `/api/artifacts/${encodeURIComponent(file.id)}/download?version=${file.version}&sha256=${file.sha256}`;
  return <VerifiedFile file={file} url={url}/>;
}
