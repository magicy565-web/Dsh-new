// TEST ONLY: preserve npm -> launcher -> original server, access and storage.
// Replace only the existing OMP model-response argument with a finite synthetic
// sequence. Never a production flag, credential source or alternate agent loop.
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
const server = fileURLToPath(new URL('../../server/index.mjs', import.meta.url));
if (process.argv[1] === server) {
  const host = new URL('../../server/workspace-omp-host.mjs', import.meta.url).href;
  registerHooks({ load(url, context, next) {
    const result = next(url, context);
    if (url !== host) return result;
    const source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
    const target = 'engineAdapter: createWorkspaceOmpEngineAdapter({ paths, configuration,';
    if (source.split(target).length !== 2) throw Error('Synthetic startup model seam changed; refuse to launch.');
    const responses = [
      { tool: 'workspace_business_tasks', arguments: { limit: 1 }, expectedToolNames: ['workspace_business_tasks', 'workspace_business_result'] },
      { tool: 'workspace_business_result', arguments: { taskId: 'synthetic-startup-owned' }, expectedContextText: 'synthetic-startup-owned' },
      { text: 'Synthetic startup regression only: synthetic-startup-owned /api/agent/v1/tasks/synthetic-startup-owned. No real enterprise evidence.' },
    ];
    return { ...result, source: source.replace(target, target + ' syntheticResponses: ' + JSON.stringify(responses) + ',') };
  } });
  // The Node host cannot make an accidental external model/connector request.
  // Its official OMP child receives only the finite synthetic sequence above.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw Error('Synthetic startup refuses outbound network.');
    return originalFetch(input, init);
  };
}
