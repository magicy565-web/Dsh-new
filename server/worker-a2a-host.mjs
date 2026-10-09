import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createA2AWorkerAdapter } from './worker-a2a-adapter.mjs';

// Production inputs come solely from reviewed host configuration, never HTTP.
// SDK and outbound network remain disabled unless all reviews/pins validate.
const id = x => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(x);
const sha = value => createHash('sha256').update(value).digest('hex');
const object = x => x && typeof x === 'object' && !Array.isArray(x);
const fields = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const error = message => Object.assign(new Error(message), { code: 'WORKER_A2A_SETUP' });
const SERVICE_IDS = new Set(['buyer-discovery', 'channel-validation', 'sales-assets']);

async function readPinnedJson(filename, expectedDigest, label) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename) ||
      typeof expectedDigest !== 'string' || !/^[0-9a-f]{64}$/.test(expectedDigest)) {
    throw error(label + ': absolute filename and lower-case SHA-256 pin required.');
  }
  const canonical = path.resolve(filename);
  const info = await fs.lstat(canonical);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 ||
      (info.mode & 0o077) || info.size > 128 * 1024 || info.size === 0 ||
      (await fs.realpath(canonical)) !== canonical) {
    throw error(label + ': only private, regular, single-link, pinned files are allowed.');
  }
  const bytes = await fs.readFile(canonical);
  if (sha(bytes) !== expectedDigest) throw error(label + ': SHA-256 pin differs from reviewed file.');
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw error(label + ': invalid JSON.'); }
}

function checkInterfaceOrigin(card, endpoint) {
  if (!fields(card, ['name','description','supportedInterfaces','provider','version','capabilities','securitySchemes','securityRequirements','defaultInputModes','defaultOutputModes','skills','documentationUrl','signatures','iconUrl'])) throw error('Agent Card: unexpected fields.');
  if (typeof card.name !== 'string' || !Array.isArray(card.supportedInterfaces) || card.supportedInterfaces.length !== 1)
    throw error('Agent Card: exactly one reviewed A2A interface is required.');
  let target, actual;
  try { target = new URL(endpoint); actual = new URL(card.supportedInterfaces[0]?.url); }
  catch { throw error('Agent Card: invalid endpoint URL.'); }
  if (target.protocol !== 'https:' || target.username || target.password || target.hash || target.search ||
      target.hostname === 'localhost' || target.hostname.endsWith('.local') ||
      /^[\d.]+$/.test(target.hostname) || target.hostname.includes(':')) throw error('Agent Card: public HTTPS required.');
  const iface = card.supportedInterfaces[0];
  if (iface.protocolBinding !== 'JSONRPC' || !String(iface.protocolVersion || '').startsWith('1.') ||
      actual.toString() !== target.toString()) throw error('Agent Card: exact reviewed interface mismatch.');
}

// Official SDK v1 (JSON-RPC) owns transport/protocol; no fork, no fallback.
// A signed-off reference is not *proof* of an actual enforceable hard cap:
// operators must verify the partner-side account and egress policy externally.
export async function loadReviewedA2AWorkers({
  environment = process.env,
  sdkLoader = () => import('@a2a-js/sdk/client'),
} = {}) {
  const file = environment.WORKSPACE_A2A_REGISTRY_FILE;
  if (!file) return { adapters: {}, status: { configured: false, connections: 0 }, close: async () => {} };
  const config = await readPinnedJson(file, environment.WORKSPACE_A2A_REGISTRY_SHA256, 'worker registry');
  if (!fields(config, ['version','workers']) || config.version !== 1 ||
      !Array.isArray(config.workers) || config.workers.length < 1 || config.workers.length > 8)
    throw error('worker registry: unsupported schema or size.');
  const entries = [], ids = new Set();
  for (const worker of config.workers) {
    if (!fields(worker, ['id','name','serviceIds','endpoint','agentCardFile','agentCardSha256','tokenEnv','enabled','review']) ||
        !id(worker.id) || ids.has(worker.id) || typeof worker.name !== 'string' || !worker.name.trim() || worker.name.length > 120 ||
        !Array.isArray(worker.serviceIds) || worker.serviceIds.length < 1 || worker.serviceIds.length > 3 ||
        !worker.serviceIds.every(s => SERVICE_IDS.has(s)) || new Set(worker.serviceIds).size !== worker.serviceIds.length ||
        typeof worker.enabled !== 'boolean' || typeof worker.endpoint !== 'string')
      throw error('worker registry: invalid worker identity, allowlist or enablement.');
    ids.add(worker.id);
    if (!worker.enabled) continue; // never read disabled credentials or import SDK
    if (!fields(worker.review, ['partnerVerifiedRef','budgetHardCapVerifiedRef','reviewedBy']) ||
        ![worker.review.partnerVerifiedRef, worker.review.budgetHardCapVerifiedRef, worker.review.reviewedBy]
          .every(value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{6,128}$/.test(value)))
      throw error('worker registry: independently reviewed partner and hard-cap references required.');
    if (!/^WORKSPACE_WORKER_[A-Z0-9_]{3,100}$/.test(worker.tokenEnv || ''))
      throw error('worker registry: dedicated worker credential environment reference required.');
    const token = environment[worker.tokenEnv];
    if (typeof token !== 'string' || token.length < 12 || /[\r\n]/.test(token))
      throw error('worker registry: server-side credential is unavailable.');
    const card = await readPinnedJson(worker.agentCardFile, worker.agentCardSha256, 'Agent Card');
    checkInterfaceOrigin(card, worker.endpoint);
    entries.push({ worker, card, token });
  }
  if (!entries.length) return { adapters: {}, status: { configured: true, connections: 0 }, close: async () => {} };
  const sdk = await sdkLoader();
  if (typeof sdk?.ClientFactory !== 'function' || !sdk.ClientFactoryOptions?.default?.transports?.length)
    throw error('Official A2A SDK ClientFactory/transport defaults missing. Install reviewed SDK in host.');
  const adapters = {};
  for (const { worker, card, token } of entries) {
    const factory = new sdk.ClientFactory({ ...sdk.ClientFactoryOptions.default, clientConfig: { polling: true } });
    const client = await factory.createFromAgentCard(card);
    if (!client || ['sendMessage','getTask','cancelTask'].some(k => typeof client[k] !== 'function'))
      throw error('Official A2A SDK could not create a valid task client.');
    const auth = () => ({ serviceParameters: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(20_000) });
    const scopedClient = {
      sendMessage: request => client.sendMessage(request, auth()),
      getTask: request => client.getTask(request, auth()),
      cancelTask: request => client.cancelTask(request, auth()),
    };
    adapters[worker.id] = createA2AWorkerAdapter({
      client: scopedClient, displayName: worker.name, services: worker.serviceIds,
      verifiedPartner: true, verifiedHardBudget: true,
    });
  }
  return {
    adapters,
    status: { configured: true, connections: Object.keys(adapters).length },
    // Local shutdown never claims to have stopped an external task.
    async close() {},
  };
}
