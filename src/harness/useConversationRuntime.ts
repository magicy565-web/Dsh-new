import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';

export type ConversationRuntime = {
  engine: 'omp' | 'pi';
  engineScope: string;
  frontend: 'original-workspace-conversation-run';
  privateLibrary: string;
  contextReset?: string;
};
export function useConversationRuntime() {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    status: 'loading' | 'business' | 'legacy' | 'unavailable';
    value: ConversationRuntime | null; error: string;
  }>({ status: 'loading', value: null, error: '' });
  useEffect(() => {
    let active = true;
    setState({ status: 'loading', value: null, error: '' });
    void api<ConversationRuntime>('/conversations/runtime').then(value => {
      if (!['omp', 'pi'].includes(value?.engine) || typeof value.engineScope !== 'string'
        || value.frontend !== 'original-workspace-conversation-run' || typeof value.privateLibrary !== 'string')
        throw new ApiError('聊天运行时状态格式无法识别', 200, 'INVALID_RUNTIME_STATUS');
      if (active) setState({ status: 'business', value, error: '' });
    }).catch(cause => {
      // Only the original JSON API's missing-route error permits legacy UI.
      // Proxy HTML, invalid JSON and unrelated 404 responses stay unavailable.
      if (active) setState(cause instanceof ApiError && cause.status === 404 && cause.code === 'NOT_FOUND'
        ? { status: 'legacy', value: null, error: '' }
        : { status: 'unavailable', value: null, error: cause instanceof Error ? cause.message : '无法读取聊天运行时状态' });
    });
    return () => { active = false; };
  }, [revision]);
  return { ...state, retry: () => setRevision(value => value + 1) };
}

