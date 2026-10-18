import { createMuseOwnerPolicy } from './muse-owner-policy.mjs';
import { createAgentService } from './agent/service.mjs';
import { createLibraryModelRead } from './library-model-read.mjs';
import { createPiBusinessAgentAdapter } from './pi-business-agent.mjs';
import { disabledAgentUiStatus } from './agent/ui.mjs';
import { createAgentOwnerPolicy } from './agent/privacy.mjs';
import { createBraveResearchAdapter } from './agent/research.mjs';
import { openWechatIngress } from './wechat-ingress.mjs';
import { createMuseDraftService } from './muse-draft-service.mjs';
import { createSupplierService, supplierServiceHttp } from './supplier-service.mjs';
import { SupplierServiceError } from './supplier-profile.mjs';
import { createSupplierMonitoring } from './supplier-monitoring.mjs';
import { createMarketValidationMonitor } from './market-validation-monitor.mjs';
import { marketValidationMonitorHttp } from './market-validation-monitor-http.mjs';
import { createMarketValidationLaunchReader } from './market-validation-launch-reader.mjs';
import { createNativeSubscriptionFacility, loadSupplierNotificationOptions } from './native-subscription-facility.mjs';
import { createGa4ProductTrafficAdapter } from './product-traffic-ga4.mjs';
import { loadSupplierTrafficOptions } from './product-traffic-config.mjs';
import { createSupplierNotificationHost, SUPPLIER_MONITOR_NOTIFICATION_ADAPTER } from './supplier-notification-host.mjs';
import { createShopifyPublicationAdapter, SUPPLIER_SHOPIFY_ADAPTER } from './shopify-publication.mjs';
import { createSupplierPublication, supplierPublicationHttp } from './supplier-publication.mjs';
import { createSupplierWorkerMcpExtension } from './supplier-mcp.mjs';
import { supplierOwnerMcpHttp } from './supplier-owner-mcp.mjs';
import { MuseDraftError } from './muse-draft.mjs';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readLocalVerification, operationalDiagnostics } from './diagnostics.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { openStore, openPrivateFile } from './store.mjs';
import { readRecoveryStatus } from './recovery-status.mjs';
import { createPiProvider } from './pi-provider.mjs';
import { loadPiProviderConfig } from './pi-provider-config.mjs';
import { createPiMuseBinding } from './pi-muse-binding.mjs';
import { ApiError, createRuntime } from './runtime.mjs';
import { createArtifactService } from './artifacts.mjs';
import { createGoalBrainHost } from './goal-brain-host.mjs';
import { composeBusinessBrainSourceAdapters, createBusinessBrainSourceAdapter } from './business-brain-source-adapter.mjs';
import { createSupplierCommerceBrainSourceAdapter } from './goal-brain-supplier-source.mjs';
import { handleGoalBrainHttp } from './goal-brain-http.mjs';
import { BrainError } from '../plugins/workspace-goal-intelligence/src/contracts.mjs';
import { isBrainArtifact } from './brain-artifact-policy.mjs';
import { createBusinessLibraryService } from './business-library.mjs';
import { createShopifyClient } from './shopify.mjs';
import { createCommerceService } from './commerce.mjs';
import { createSupplyNetworkService } from './supply-network.mjs';
import { supplyHttp } from './supply-http.mjs';
import {createEnterpriseDisclosurePolicy} from './enterprise-disclosure-policy.mjs';
import {createEnterpriseMemoryLedger} from './enterprise-memory-ledger.mjs';
import {createOpenFgaClient} from './enterprise-openfga.mjs';
import { libraryHttp } from './library-http.mjs';
import { backendPluginSelection, backendPluginsFromEnvironment, mountMedusaBackend } from './workspace-backend-plugins.mjs';
import { createSourcingMcpAuth, handleSourcingMcpHttp } from './sourcing-mcp.mjs';
import { createRunOutputService } from './run-output.mjs';
import { createWorkspaceLibraryAdapter, WORKSPACE_LIBRARY_ADAPTER } from './workspace-library.mjs';
import { createCapabilityService, CapabilityError } from './capabilities.mjs';
import { createWorkerServiceDesk, WorkerDeskError } from './worker-desk.mjs';
import { createWorkerOpportunityService, WorkerOpportunityError } from './worker-opportunities.mjs';
import { createCloudExpertService, CloudExpertError } from './cloud-experts.mjs';
import { loadReviewedA2AWorkers } from './worker-a2a-host.mjs';
import { createDotWorkerBridge, createDotWorkerAuth, DotWorkerError } from './dot-worker-bridge.mjs';
import { handleDotMcpHttp } from './dot-mcp-server.mjs';
import { MuseWorkerError } from './muse-worker-api.mjs';
import { createMuseWorkerHost } from './muse-worker-host.mjs';
import { AccessError, validateAccessConfig, createAccessControl, accessConfigFromEnvironment } from './access.mjs';

function decodeApiId(value) {
  try { return decodeURIComponent(value); } catch { throw new ApiError(400, 'INVALID_PATH', 'Invalid API identifier encoding.'); }
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json' };
async function respond(res, status, body) {
  if (res.filterWorkspaceResponse && status < 400) body = res.filterWorkspaceResponse(body);
  if (body === undefined) throw new ApiError(404, 'NOT_FOUND', 'The requested record is outside this reviewed binding.');
  await res.accessFinish?.(status);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(JSON.stringify(body));
}
async function readBody(req, maximum = 100_000) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new ApiError(415, 'JSON_REQUIRED', 'Send application/json.');
  if (Number(req.headers['content-length']) > maximum) throw new ApiError(413, 'BODY_TOO_LARGE', `Request body must be smaller than ${maximum} bytes.`);
  let length = 0;
  const chunks = [];
  for await (const chunk of req) { length += chunk.length; if (length > maximum) throw new ApiError(413, 'BODY_TOO_LARGE', `Request body must be smaller than ${maximum} bytes.`); chunks.push(chunk); }
  let body;
  try { req.bodyBytes = Buffer.concat(chunks); body = JSON.parse(req.bodyBytes.toString('utf8')); } catch { throw new ApiError(400, 'INVALID_JSON', 'The request must contain valid JSON.'); }
  if (body === null || Array.isArray(body) || typeof body !== 'object') throw new ApiError(400, 'INVALID_JSON', 'The request body must be a JSON object.');
  return body;
}
async function staticResponse(req, res, pathname, staticDirectory) {
  const base = path.resolve(staticDirectory);
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { throw new ApiError(400, 'INVALID_PATH', 'Invalid URL path.'); }
  if (decoded.includes('\0') || decoded.includes('\\')) throw new ApiError(400, 'INVALID_PATH', 'Invalid URL path.');
  let filename = path.resolve(base, `.${decoded}`);
  if (filename !== base && !filename.startsWith(`${base}${path.sep}`)) throw new ApiError(403, 'INVALID_PATH', 'Invalid URL path.');
  try { if (!(await fs.stat(filename)).isFile()) throw new Error('Not a file'); }
  catch {
    if (path.extname(decoded)) throw new ApiError(404, 'NOT_FOUND', 'File not found.');
    filename = path.join(base, 'index.html');
  }
  let data;
  try { const realBase = await fs.realpath(base); const realFile = await fs.realpath(filename); if (!realFile.startsWith(`${realBase}${path.sep}`)) throw new ApiError(403, 'INVALID_PATH', 'Static files must stay inside the frontend directory.'); data = await fs.readFile(realFile); } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(404, 'FRONTEND_NOT_BUILT', 'The frontend is not built. Use the development frontend or run npm run build first.'); }
  await res.accessFinish?.(200);
  res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': path.extname(filename) === '.html' ? 'no-cache' : 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer' });
  res.end(req.method === 'HEAD' ? undefined : data);
}

export async function createApp({ dataDirectory = path.join(root, '.data'), provider = createPiProvider(), staticDirectory = path.join(root, 'dist'), goalTimeoutMs, maxConcurrentRuns, maxQueuedRuns, connectorAdapters = {}, workerAdapters = {}, dotWorkerConfig = null, museWorkerConfig = null, museOriginalBinding = null, schedulerIntervalMs = 1000, capabilityEnvironment = process.env, shopifyFetch = fetch, medusaFetch = fetch, backendPlugins = { disabled: [] }, supplierTrafficAdapter = null, supplierTrafficOptions = null, supplierOwnerMcpBinding = null, supplierNotificationOptions = {}, sourcingMcpConfig = null, agentConfig = null, libraryModelReadPolicy = null, businessAgentOptions = null, enterpriseDisclosureOptions = null, goalBrainOptions = null, marketValidationOptions = {}, allowedOrigins = [], access: accessOptions = {}, accessClock = Date.now } = {}) {
  const instanceId = randomUUID(), startedAt = new Date().toISOString();
  const localVerification = await readLocalVerification();
  const accessConfig = validateAccessConfig(accessOptions, allowedOrigins);
  const businessAgent = businessAgentOptions && createPiBusinessAgentAdapter({ provider, options: businessAgentOptions });
  if (businessAgent) provider = businessAgent.provider;
  if (!Number.isInteger(schedulerIntervalMs) || schedulerIntervalMs < 50 || schedulerIntervalMs > 60000) throw new Error('schedulerIntervalMs must be 50–60000.');
  const backendSelection = backendPluginSelection(backendPlugins);
  const store = await openStore(dataDirectory);
  let medusaModule;
  let runtime, artifacts, capabilities, access, recovery, goalBrain, workerDesk, workerOpportunities, cloudExperts, dotBridge, dotAuth, museBridge, museHost, businessLibrary, libraryModelRead, enterpriseDisclosure, enterpriseMemory, shopify, commerce, supply, sourcingMcpAuth, piMuse, museDrafts, supplierService, supplierMonitoring, marketValidationMonitoring, publicationAdapter, supplierPublication, supplierNotifications, builtinAgent, medusaCatalog;
  try {
    if (businessAgent && Object.values(store.read().workspaceThreadHarness || {}).some(value => Array.isArray(value) && value.length))
      throw new Error('Existing alpha ThreadHarness records are retained. Review their archive/migration before enabling this adapter; no second executor or automatic state synchronization will adopt them.');
    await provider.initialize?.({ store });
    recovery = await readRecoveryStatus(store.directory, provider.kind);
    access = await createAccessControl({ config: accessConfig, dataDirectory: store.directory, now: accessClock });
    artifacts = await createArtifactService({ store, directory: path.join(dataDirectory, 'artifacts') });
    businessLibrary = createBusinessLibraryService({ store, artifacts, clock: accessClock });
    if (enterpriseDisclosureOptions?.openfga && accessConfig.mode !== 'enterprise') throw Error('OpenFGA disclosure requires enterprise access mode.');
    enterpriseDisclosure=createEnterpriseDisclosurePolicy({store,library:businessLibrary,artifacts,
      fga:enterpriseDisclosureOptions?.openfga?createOpenFgaClient(enterpriseDisclosureOptions.openfga):null,
      workspaceId:accessConfig.workspaceId||'local',resolveResource:({resourceId,forGrant})=>enterpriseMemory?.resolveResource({resourceId,forGrant}),clock:accessClock});
    enterpriseMemory=createEnterpriseMemoryLedger({store,library:businessLibrary,disclosure:enterpriseDisclosure,workspaceId:accessConfig.workspaceId||'local',clock:accessClock});
    medusaModule = await mountMedusaBackend(backendSelection, {ApiError,library:businessLibrary,workspaceId:accessConfig.workspaceId||'local',environment:capabilityEnvironment,fetchImpl:medusaFetch});
    medusaCatalog = medusaModule?.service;
    libraryModelRead = createLibraryModelRead({ library: businessLibrary, artifacts, access, policy: libraryModelReadPolicy, clock: accessClock });
    dotAuth = dotWorkerConfig && createDotWorkerAuth({ tokenDigest: dotWorkerConfig.tokenDigest });
    if (dotWorkerConfig?.enabled === true && !dotAuth)
      throw new TypeError('A reviewed dot Worker cannot be enabled without a pinned plugin bearer token.');
    dotBridge = dotWorkerConfig ? createDotWorkerBridge({
      store, artifacts, workerId: dotWorkerConfig.workerId || 'chatgpt-dot-xy',
      ownerId: dotWorkerConfig.ownerId || 'xy',
      enabled: dotWorkerConfig.enabled === true,
      externalBudgetVerified: dotWorkerConfig.externalBudgetVerified === true,
      scopeReviewed: dotWorkerConfig.scopeReviewed === true,
    }) : null;
    if (dotBridge && Object.hasOwn(workerAdapters, dotWorkerConfig.workerId || 'chatgpt-dot-xy'))
      throw new TypeError('A Dot Worker ID cannot overwrite another reviewed execution adapter.');
    if (museOriginalBinding) {
      piMuse = await createPiMuseBinding({ store, artifacts, config: museWorkerConfig, binding: museOriginalBinding, dotWorkerConfig, readBody, respond });
    }
    if (museWorkerConfig && !museOriginalBinding) {
      museHost = createMuseWorkerHost({ store, artifacts, config: museWorkerConfig,
        workerAdapters, dotWorkerConfig, readBody, respond });
      museBridge = museHost.bridge;
    }
    workerDesk = createWorkerServiceDesk({ store,
      adapters: {
        ...workerAdapters,
        ...(dotBridge ? { [dotWorkerConfig.workerId || 'chatgpt-dot-xy']: dotBridge.adapter } : {}),
        ...(museHost ? { [museHost.workerId]: museHost.adapter } : {}),
      },
      artifacts });
    workerOpportunities = createWorkerOpportunityService({ store });
    cloudExperts = createCloudExpertService({ store, workerCatalog: () => workerDesk.catalog(), workerDesk });
    await workerDesk.recoverInterrupted();
    if (Object.hasOwn(connectorAdapters, SUPPLIER_SHOPIFY_ADAPTER) || Object.hasOwn(connectorAdapters, SUPPLIER_MONITOR_NOTIFICATION_ADAPTER)) throw new TypeError('The original supplier Shopify adapter ID cannot be overwritten.');
    if (!Object.keys(supplierNotificationOptions).length && capabilityEnvironment.WORKSPACE_SUPPLIER_NOTIFICATION_CONFIG_FILE) supplierNotificationOptions = await loadSupplierNotificationOptions(capabilityEnvironment.WORKSPACE_SUPPLIER_NOTIFICATION_CONFIG_FILE);
    const nativeSubscriptions = createNativeSubscriptionFacility({ access, clock: accessClock });
    supplierNotificationOptions = { ...supplierNotificationOptions, nativeFacility: nativeSubscriptions, resolveRecipient: supplierNotificationOptions.resolveRecipient || nativeSubscriptions.resolveRecipient, confirmSubscription: supplierNotificationOptions.confirmSubscription || nativeSubscriptions.confirmSubscription };
    supplierNotifications = createSupplierNotificationHost({ store, getCapabilities: () => capabilities, getSupplier: () => supplierService, options: supplierNotificationOptions, clock: accessClock, currentRole: subject => accessConfig.mode === 'enterprise' ? accessConfig.members.get(subject) : subject === 'local-operator' ? 'admin' : null });
    publicationAdapter = createShopifyPublicationAdapter({ store, environment: capabilityEnvironment, fetchImpl: shopifyFetch, clock: accessClock,
      readImage: (scope, ref) => supplierService.forActor({ subject: scope.subject, workspaceId: scope.workspaceId, role: scope.actorRole }).readImage(scope.conversationId, scope.serviceId, ref) });
    capabilities = await createCapabilityService({ store, clock: accessClock, adapters: { ...connectorAdapters, [SUPPLIER_SHOPIFY_ADAPTER]: publicationAdapter, [SUPPLIER_MONITOR_NOTIFICATION_ADAPTER]: supplierNotifications.adapter, [WORKSPACE_LIBRARY_ADAPTER]: createWorkspaceLibraryAdapter({ artifacts, store }) }, environment: capabilityEnvironment, executionContext: { kind: provider.kind || 'deepseek-api', model: provider.model || null, permissionFingerprint: provider.permissionFingerprint || null }, dispatchGoal: async args => store.read().goals.find(goal => goal.id === args.goalId)?.serviceTask?.kind === 'supplier-monitor' ? supplierMonitoring.dispatch(args) : store.read().goals.find(goal => goal.id === args.goalId)?.serviceTask?.kind === 'market-validation-monitor' ? marketValidationMonitoring.dispatch(args) : runtime.updateGoal(args.goalId, { action: 'resume', queued: true, requestId: args.requestId }, { expectedGoalDefinitionHash: args.expectedGoalDefinitionHash, scheduleClaim: args.scheduleClaim }) });
    runtime = await createRuntime({ store, provider, goalTimeoutMs, maxConcurrentRuns, maxQueuedRuns, artifacts, capabilities, saveOutput: createRunOutputService({ store, artifacts }), autoStart: false, validateMemory: content => capabilities.assertSafeMemory(content) });
    museDrafts = piMuse ? createMuseDraftService({ store, runtime, piMuse, artifacts, provider }) : null;
    shopify = createShopifyClient({ environment: capabilityEnvironment, fetchImpl: shopifyFetch, clock: accessClock });
    if (!supplierTrafficAdapter && supplierTrafficOptions === null && capabilityEnvironment.WORKSPACE_SUPPLIER_TRAFFIC_CONFIG_FILE) supplierTrafficOptions = await loadSupplierTrafficOptions(capabilityEnvironment.WORKSPACE_SUPPLIER_TRAFFIC_CONFIG_FILE, { clock: accessClock, workspaceId: accessConfig.workspaceId || 'local' });
    const sharedProductTrafficAdapter = supplierTrafficAdapter || (supplierTrafficOptions ? createGa4ProductTrafficAdapter({ ...supplierTrafficOptions, clock: accessClock }) : null);
    supplierMonitoring = await createSupplierMonitoring({ store, runtime, capabilities, shopify, clock: accessClock, notifications: supplierNotifications, authorizeOwner: (_state, monitor) => accessConfig.mode === 'enterprise' ? ['admin', 'operator'].includes(accessConfig.members.get(monitor.subject)) : monitor.subject === 'local-operator', trafficAdapter: sharedProductTrafficAdapter });
    if (!marketValidationOptions || Object.keys(marketValidationOptions).some(key => !['resolveLaunchReceipt', 'outcomeAdapter', 'trafficAdapter'].includes(key))) throw new TypeError('Use only the original Host receipt reader and reviewed data adapters.');
    marketValidationMonitoring = await createMarketValidationMonitor({ store, runtime, capabilities, shopify, clock: accessClock, trafficAdapter: sharedProductTrafficAdapter?.contractVersion === 2 ? sharedProductTrafficAdapter : null, ...marketValidationOptions,
      resolveLaunchReceipt: createMarketValidationLaunchReader({ store, artifacts, resolveLaunchReceipt: marketValidationOptions.resolveLaunchReceipt }),
      authorizeOwner: (_state, actor) => actor.workspaceId === (accessConfig.workspaceId || 'local') && (accessConfig.mode === 'enterprise'
        ? ['admin', 'operator'].includes(accessConfig.members.get(actor.subject)) && (!actor.sessionId || access.nativeSessionById(actor.sessionId)?.subject === actor.subject)
        : actor.subject === 'local-operator') });
    supplierService = createSupplierService({ store, runtime, provider, businessLibrary, artifacts, shopify, capabilities, clock: accessClock, monitoring: supplierMonitoring, notifications: supplierNotifications, publicationStatus: () => supplierPublication?.status(), ownerMcpConfigured: accessConfig.mode === 'enterprise' && typeof supplierOwnerMcpBinding?.readReviewedScope === 'function', ownerSessionMcpAvailable: accessConfig.mode === 'enterprise',
      readMuseImage: async (actor, cid, ref) => { if (!piMuse || piMuse.snapshot(actor).conversationId !== cid) throw new SupplierServiceError(404, 'SUPPLIER_IMAGE_UNAVAILABLE', 'Use the original reviewed Muse owner and Session.'); piMuse.forActor(actor); const file = await piMuse.native.bindSession(piMuse.actor).download({ artifactId: ref.artifactId, version: ref.version, sha256: ref.sha256 }); return { ...file, version: { sha256: file.sha256 } }; } });
    if (goalBrainOptions !== null) {
      if (!goalBrainOptions || Object.keys(goalBrainOptions).some(k => !['originalReceiver', 'reviewedGoals', 'sourceAdapter'].includes(k)))
        throw new TypeError('Goal Brain may only use an original trusted model receiver and reviewed, pinned native Goals.');
      const primarySourceAdapter = goalBrainOptions.sourceAdapter || createBusinessBrainSourceAdapter({ store, workspaceId: accessConfig.workspaceId || 'local', clock: accessClock });
      const supplierSourceAdapter = createSupplierCommerceBrainSourceAdapter({ supplierService });
      const sourceAdapter = composeBusinessBrainSourceAdapters({
        primary: primarySourceAdapter,
        extras: [{ prefix: 'supplier:', adapter: supplierSourceAdapter }]
      });
      goalBrain = createGoalBrainHost({ store, artifacts, access, libraryModelRead, ...goalBrainOptions, sourceAdapter, clock: accessClock });
    }
    supplierPublication = await createSupplierPublication({ store, capabilities, shopify, adapter: publicationAdapter, clock: accessClock });
    await supplierNotifications.initialize();
    commerce = createCommerceService({ store, runtime, shopify, workerDesk, workerCatalog: () => workerDesk.catalog(), museConnection: () => museBridge?.info(), clock: accessClock });
    supply = createSupplyNetworkService({ store, clock: accessClock, workspaceId: accessConfig.workspaceId || 'local',
      merchantMember: subject => accessConfig.mode === 'enterprise' ? ['admin', 'operator'].includes(accessConfig.members.get(subject)) : subject === 'local-operator' });
    const workerDigests = [dotWorkerConfig?.tokenDigest, museWorkerConfig?.tokenDigest].filter(Boolean);
    const sourcingDigests = [sourcingMcpConfig?.tokenDigest, ...(sourcingMcpConfig?.principals || []).map(row => row.tokenDigest)].filter(Boolean);
    if (sourcingMcpConfig?.enabled && sourcingDigests.some(value => workerDigests.includes(value)))
      throw new TypeError('Sourcing MCP may not reuse a Dot or Muse Worker credential.');
    if ((sourcingMcpConfig?.principals || []).some(row => row.workspaceId !== (accessConfig.workspaceId || 'local') ||
      (accessConfig.mode === 'enterprise' ? accessConfig.members.has(row.subject) : row.subject === 'local-operator')))
      throw new TypeError('External procurement buyers require this workspace and a distinct subject from enterprise members.');
    sourcingMcpAuth = createSourcingMcpAuth(sourcingMcpConfig || {});
    const agentEnvironment = agentConfig?.env || capabilityEnvironment;
    if (agentConfig !== false && (agentConfig || agentEnvironment.WS_AGENT_ENABLED === '1' || agentEnvironment.WS_AGENT_UI_ENABLED === '1' || agentEnvironment.WS_AGENT_PRINCIPALS)) {
      const projectionDirectory = path.resolve(dataDirectory, 'agent');
      if ([agentEnvironment.WS_AGENT_DATA, agentConfig?.dataDir].filter(Boolean).some(directory => path.resolve(directory) !== projectionDirectory))
        throw new Error('Agent projection must remain under the original Workspace data root.');
      // Prevent a Dot/Muse/sourcing Worker credential from becoming an
      // enterprise Agent submit credential through accidental digest reuse.
      builtinAgent = await createAgentService({ env: agentEnvironment, ...(agentConfig || {}), dataDir: projectionDirectory,
        workspaceStore: store, runtime, provider, access, artifacts, instanceId,
        reservedTokenDigests: [...workerDigests, ...sourcingDigests] });
    }
    if (businessAgent) {
      if (!builtinAgent && !businessAgentOptions.engineAdapter) throw new Error('The business conversation adapter requires the original configured Agent member service.');
      businessAgent.attach({ store, runtime, access, instanceId, libraryModelRead, artifacts, marketValidationMonitoring, capabilities, accessClock, supplierService, supplierPublication, shopify, goalBrain, medusaCatalog, sessionReadonlyClient: builtinAgent?.sessionReadonlyClient });
    }
  } catch (error) { await medusaModule?.close(); await marketValidationMonitoring?.close(); await supplierMonitoring?.close(); await builtinAgent?.close(); await provider.close?.(); await piMuse?.close(); await museHost?.close(); await artifacts?.close?.(); await capabilities?.close?.(); await access?.close(); await store.close(); throw error; }
  const musePrivacy = piMuse || createMuseOwnerPolicy({ read: () => store.read(), error: (status, code, message) => new ApiError(status, code, message) });
  const agentPrivacy = createAgentOwnerPolicy({ read: () => store.read(), error: (status, code, message) => new ApiError(status, code, message) });
  const supplierMcpExtension = bridge => createSupplierWorkerMcpExtension({ bridge, service: supplierService, store, workspaceId: accessConfig.workspaceId || 'local', memberRole: subject => accessConfig.mode === 'enterprise' ? accessConfig.members.get(subject) : subject === 'local-operator' ? 'admin' : null });
  const supplierMcpEnabled = capabilityEnvironment.WORKSPACE_SUPPLIER_MCP_ENABLED === 'true';
  async function draftHttp(req, res, pathname, context, body) {
    const match = pathname.match(/^\/api\/conversations\/([^/]+)\/muse-drafts(?:\/([^/]+)(?:\/(messages|prepare|reject))?)?$/);
    if (!match) return false;
    if (!museDrafts) throw new MuseDraftError(409, 'MW_ORIGINAL_BINDING_REQUIRED', 'Restore the exact original Muse owner/conversation binding; no substitute model was started.');
    piMuse.forActor(context);
    const conversationId = decodeApiId(match[1]), draftId = match[2] ? decodeApiId(match[2]) : null;
    if (conversationId !== piMuse.actor.nativeAgentId) throw new MuseDraftError(403, 'MUSE_OWNER_REQUIRED', 'Use the exact original Muse conversation.');
    if (req.method === 'GET' && !match[3]) await respond(res, 200, draftId ? { draft: museDrafts.get(conversationId, draftId) } : { drafts: museDrafts.list(conversationId) });
    else if (req.method === 'POST' && (!draftId || match[3] === 'messages')) await respond(res, 202, await museDrafts.request(conversationId, body, draftId));
    else if (req.method === 'POST' && ['prepare', 'reject'].includes(match[3])) await respond(res, 200, await museDrafts[match[3]](conversationId, draftId, body));
    else throw new MuseDraftError(405, 'METHOD_NOT_ALLOWED', 'Use the exact draft read, clarification, preparation or rejection operation.');
    return true;
  }
  const streams = new Set();
  let scheduler;
  const schedulerState = { state: 'stopped', automaticTimer: false, intervalMs: schedulerIntervalMs, lastStartedAt: null, lastCompletedAt: null, lastError: null };
  let ticking = false;
  const capabilitySnapshot = () => { const snapshot = capabilities.bootstrap(); snapshot.scheduler = { ...snapshot.scheduler, automaticTimer: schedulerState.automaticTimer }; return snapshot; };
  const diagnostics = () => operationalDiagnostics({ instanceId, startedAt, runtime: runtime.status(), storage: store.diagnostics(), capabilities: capabilitySnapshot(), scheduler: schedulerState, recovery, access: access.health(), localVerification });
  async function schedulerTick() {
    if (ticking || !schedulerState.automaticTimer) return;
    ticking = true; schedulerState.lastStartedAt = new Date().toISOString();
    try {
      await capabilities.tick();
      schedulerState.lastCompletedAt = new Date().toISOString(); schedulerState.lastError = null;
      if (schedulerState.automaticTimer) schedulerState.state = 'healthy';
    } catch {
      schedulerState.lastError = { code: 'SCHEDULER_TICK_FAILED', message: 'The scheduler could not complete a local tick. Inspect storage and service state before retrying work.' };
      if (schedulerState.automaticTimer) schedulerState.state = 'degraded';
    } finally { ticking = false; }
  }
  async function streamChanges(req, res, context) {
    const rawCursor = req.headers['last-event-id'] || new URL(req.url, 'http://localhost').searchParams.get('after');
    if (rawCursor && !/^\d{1,16}$/.test(rawCursor)) throw new ApiError(400, 'INVALID_CURSOR', 'Event cursor must be a non-negative sequence.');
    await res.accessFinish?.(200);
    const accessWatch = access.watchStream(context, () => res.end());
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
    const send = event => { if (!accessWatch.valid()) { res.end(); return; } if (res.writableLength > 128_000) { res.destroy(); return; } res.write(`id: ${event.sequence}\nevent: change\ndata: ${JSON.stringify({ sequence: event.sequence, updatedAt: event.updatedAt, bootstrap: '/api/bootstrap' })}\n\n`); };
    // This is a state-invalidation stream, not a replay of private native payloads.
    const unsubscribe = store.subscribe(send);
    const current = store.read().meta;
    send(current);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000); heartbeat.unref();
    streams.add(res);
    res.on('close', () => { accessWatch.stop(); unsubscribe(); clearInterval(heartbeat); streams.delete(res); });
  }
  const server = http.createServer(async (req, res) => {
    try {
      // The optional Agent API is a thin adapter over the original Workspace/Pi services.
      if (builtinAgent && await builtinAgent.handle(req, res)) return;
      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname.replace(/\/$/, '') || '/';
      const method = req.method;
      // Independent read-only supply connector for the private pilot. It never
      // shares Dot/Muse credentials or permits public RFQ mutations.
      if (pathname === '/mcp/sourcing') {
        const actor = sourcingMcpAuth(req);
        return await handleSourcingMcpHttp(req, res, { supply, readBody, actor });
      }
      // Muse is a separate, authenticated REST API; it does not share the Dot
      // worker credential, task queue or MCP plugin protocol.
      if (pathname === '/api/muse-worker' || pathname.startsWith('/api/muse-worker/')) {
        if (pathname === '/api/muse-worker/mcp') { if (!supplierMcpEnabled || !piMuse) throw new ApiError(404, 'MW_ORIGINAL_BINDING_REQUIRED', 'Enable only the exact existing reviewed Muse owner Host supplier MCP facet.'); await piMuse.native.supplierMcp(req, res, supplierMcpExtension); return; }
        if (piMuse) { await piMuse.workerHttp(req, res, pathname); return; }
        if (!museHost) throw new ApiError(404, 'MW_GATEWAY_UNAVAILABLE', 'Muse REST gateway is not configured on this host.');
        await museHost.handle(req, res, pathname);
        return;
      }
      // Real MCP Streamable HTTP endpoint for ChatGPT plugins. The REST
      // bridge below is deliberately NOT an MCP server. Both transports
      // require the same reviewed private dot credential.
      if (pathname === '/mcp' || pathname === '/api/dot-worker/mcp') {
        if (!dotBridge || !dotAuth) throw new ApiError(404, 'DOT_BRIDGE_UNAVAILABLE', 'The private dot MCP gateway is not installed on this host.');
        dotAuth(req);
        return await handleDotMcpHttp(req, res, { bridge: dotBridge, readBody, extension: supplierMcpEnabled ? supplierMcpExtension(dotBridge) : null });
      }
      // Personal ChatGPT dots are pull-based tool users, NOT public A2A
      // endpoints. A dedicated server-side bearer credential isolates the
      // dot's narrow public-data API from the enterprise browser session.
      if (pathname.startsWith('/api/dot-worker/')) {
        if (!dotBridge || !dotAuth) throw new ApiError(404, 'DOT_BRIDGE_UNAVAILABLE', 'The Dot plugin gateway is disabled on this server.');
        dotAuth(req);
        const base = '/api/dot-worker/v1';
        if (pathname === base+'/identity' && method === 'GET') {
          await dotBridge.recordSeen();
          return await respond(res, 200, dotBridge.identity());
        }
        if (pathname === base+'/inbox' && method === 'GET') {
          await dotBridge.recordSeen();
          return await respond(res, 200, dotBridge.inbox());
        }
        const event = pathname.match(/^\/api\/dot-worker\/v1\/tasks\/([^/]+)\/events\/([^/]+)\/ack$/);
        if (event && method === 'POST')
          return await respond(res, 200, await dotBridge.ackEvent({taskRef:event[1],eventId:event[2]}));
        const match = pathname.match(/^\/api\/dot-worker\/v1\/tasks\/([^/]+)(?:\/(claim|status|heartbeat|upload-file|submit-result|report-blocked|confirm-stop))?$/);
        if (match) {
          const [, taskRef, op] = match;
          if (method === 'GET' && !op) return await respond(res, 200, dotBridge.readTask(taskRef));
          if (method === 'GET' && op === 'status') return await respond(res, 200, dotBridge.status(taskRef));
          if (method === 'POST') {
            const data = await readBody(req, op === 'upload-file' ? 1_600_000 : 30_000);
            const payload = { ...data, taskRef };
            if (op === 'claim') return await respond(res, 200, await dotBridge.claimTask(payload));
            if (op === 'heartbeat') return await respond(res, 200, await dotBridge.heartbeat(payload));
            if (op === 'upload-file') return await respond(res, 201, await dotBridge.uploadFile(payload));
            if (op === 'submit-result') return await respond(res, 200, await dotBridge.submitResult(payload));
            if (op === 'report-blocked') return await respond(res, 200, await dotBridge.reportBlocked(payload));
            if (op === 'confirm-stop') return await respond(res, 200, await dotBridge.confirmStop(payload));
          }
        }
        throw new ApiError(404, 'DOT_ROUTE_NOT_FOUND', 'Only the reviewed dot Worker task methods are accepted.');
      }
      const context = await access.begin(req, res, pathname);
      musePrivacy.guardHttp(pathname, context);
      agentPrivacy.guardHttp(pathname, context);
      res.filterWorkspaceResponse = body => agentPrivacy.filterResponse(musePrivacy.filterResponse(body, context), context);
      try {
        if (req.method === 'GET' && await handleGoalBrainHttp({ pathname, method: req.method, context, host: goalBrain, resolveReadSession: businessAgent?.brainReadSession, res, respond })) return;
      } catch (error) {
        if (error instanceof BrainError) throw new ApiError(
          /(?:STALE|CHANGED|CONFLICT)/.test(error.code) ? 409 : 403,
          error.code, 'The original reviewed business context or Session is unavailable.');
        throw error;
      }
      if (businessAgent && await businessAgent.handle({ req, res, pathname, context, respond, readBody: async request => {
        const body = await readBody(request);
        access.verifyBody(context, request.bodyBytes || Buffer.alloc(0));
        musePrivacy.guardHttp(pathname, context, body); agentPrivacy.guardHttp(pathname, context, body);
        return body;
      } })) return;
      if (await libraryModelRead.handle({ req, res, pathname, query: url.searchParams, context, respond })) return;
      if (builtinAgent && await builtinAgent.handleUi(req, res, context)) return;
      if (await supplierOwnerMcpHttp({ req, res, pathname, context, access, readBody, guardBody: body => musePrivacy.guardHttp(pathname, context, body), filterResult: value => musePrivacy.filterResponse(value, context), service: supplierService, publication: supplierPublication, artifacts, store, binding: supplierOwnerMcpBinding, clock: accessClock })) return;
      if (!pathname.startsWith('/api/')) {
        if (method !== 'GET' && method !== 'HEAD') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
        return await staticResponse(req, res, pathname, staticDirectory);
      }
      if (method === 'GET') {
        if (medusaModule && await medusaModule.handle({req,res,pathname,context,respond})) return;
        if (await marketValidationMonitorHttp({ service: marketValidationMonitoring, req, res, pathname, context, respond })) return;
        if (!builtinAgent && pathname === '/api/agent-ui/v1/status') return await respond(res, 200, disabledAgentUiStatus());
        if (await supplierPublicationHttp({ publication: supplierPublication, service: supplierService, access, req, res, pathname, context, respond })) return;
        if (await supplierServiceHttp({ service: supplierService, access, req, res, pathname, context, respond })) return;
        if (await draftHttp(req, res, pathname, context)) return;
        if (piMuse && await piMuse.businessHttp({ req, res, pathname, context, query: url.searchParams })) return;
        const goalCommerce = pathname.match(/^\/api\/goals\/([^/]+)\/commerce-context$/);
        if (goalCommerce) return await respond(res, 200, commerce.forGoal(goalCommerce[1]));
        const supplyRead = await supplyHttp({ supply, method, pathname, query: Object.fromEntries(url.searchParams), actor: context });
        if (supplyRead) return await respond(res, supplyRead.status, supplyRead.body);
        if (pathname === '/api/commerce-status') return await respond(res, 200, commerce.status());
        if (pathname === '/api/commerce-projects') return await respond(res, 200, commerce.list());
        const commerceRead = pathname.match(/^\/api\/commerce-projects\/([^/]+)$/);
        if (commerceRead) return await respond(res, 200, commerce.get(commerceRead[1]));
        if (pathname === '/api/diagnostics') return await respond(res, 200, diagnostics());
        if (pathname === '/api/health') {
          const storage = store.diagnostics(), durable = storage.durability === 'confirmed';
          return await respond(res, 200, { status: durable ? 'ok' : 'degraded', access: access.health(), storage: { ...storage, exclusiveWriter: true, liveWriteProbe: false }, recovery, provider: { configured: !!provider.configured, kind: provider.kind || 'deepseek-api', onlineVerified: false }, readiness: !durable ? 'storage_review_required' : provider.configured ? 'configured-not-online-verified' : 'setup_required' });
        }
        if (pathname === '/api/session') return await respond(res, 200, access.sessionView(context));
        if (pathname === '/api/access/sessions') return await respond(res, 200, access.listSessions());
        if (pathname === '/api/access/audit') return await respond(res, 200, access.listAudit({ after: Number(url.searchParams.get('after') || 0), limit: Number(url.searchParams.get('limit') || 100) }));
        if (pathname === '/api/events') return await streamChanges(req, res, context);
        if (pathname.startsWith('/api/library/') || /^\/api\/conversations\/[^/]+\/library-references$/.test(pathname)) {
          const query = Object.fromEntries(url.searchParams);
          if ([...url.searchParams.keys()].length !== Object.keys(query).length) throw new ApiError(400, 'INVALID_INPUT', 'Duplicate library query parameters are not allowed.');
          const result = await libraryHttp({ library: businessLibrary, disclosure:enterpriseDisclosure,memory:enterpriseMemory, method, pathname, query, actor: context });
          if (result) return await respond(res, result.status, result.body);
        }
        if (pathname === '/api/runs') return await respond(res, 200, runtime.listRuns());
        if (pathname === '/api/artifacts') return await respond(res, 200, { ...artifacts.list(), artifacts: artifacts.list().artifacts.filter(item => !musePrivacy.ownsArtifact(item) && !isBrainArtifact(item)) });
        if (pathname === '/api/cloud-expert-catalog') return await respond(res, 200, cloudExperts.catalog());
        if (pathname === '/api/cloud-experts') return await respond(res, 200, { experts: cloudExperts.experts() });
        if (pathname === '/api/cloud-teams') return await respond(res, 200, { teams: cloudExperts.teams() });
        const oneCloudExpert = pathname.match(/^\/api\/cloud-experts\/([^/]+)$/);
        if (oneCloudExpert) return await respond(res, 200, { expert: cloudExperts.getExpert(oneCloudExpert[1]) });
        const oneCloudTeam = pathname.match(/^\/api\/cloud-teams\/([^/]+)(?:\/(plan))?$/);
        if (oneCloudTeam) return await respond(res, 200, oneCloudTeam[2] ? { plan: cloudExperts.planTeam(oneCloudTeam[1]) } : { team: cloudExperts.getTeam(oneCloudTeam[1]) });
        if (pathname === '/api/muse-worker-connection/tasks') {
          if (context.role !== 'admin') throw new ApiError(403, 'ROLE_REQUIRED', 'Only enterprise administrators can inspect Muse task lease/audit records.');
          return await respond(res, 200, { tasks: museBridge ? museBridge.adminTasks() : [] });
        }
        if (pathname === '/api/muse-worker-connection')
          return await respond(res, 200, museBridge ? museBridge.info() : { installed:false, approved:false, ownerId:null, onlineVerified:false });
        if (pathname === '/api/dot-worker-connection/tasks') {
          if (context.role !== 'admin') throw new ApiError(403, 'ROLE_REQUIRED', 'Only enterprise administrators can inspect Dot lease/audit records.');
          return await respond(res, 200, { tasks: dotBridge ? dotBridge.adminTasks() : [] });
        }
        if (pathname === '/api/dot-worker-connection') return await respond(res, 200, dotBridge ? dotBridge.info() : { installed:false, approved:false, ownerId:'xy', onlineVerified:false });
        if (pathname === '/api/worker-services') return await respond(res, 200, { services: workerDesk.catalog() });
        if (pathname === '/api/worker-orders') return await respond(res, 200, { orders: workerDesk.list().filter(item => !musePrivacy.ownsOrder(item.id)) });
        if (pathname === '/api/worker-opportunities') return await respond(res, 200, { opportunities: workerOpportunities.list() });
        const opportunityRead = pathname.match(/^\/api\/worker-opportunities\/([^/]+)$/);
        if (opportunityRead) return await respond(res, 200, { opportunity: workerOpportunities.get(opportunityRead[1]) });
        const workerOrderRead = pathname.match(/^\/api\/worker-orders\/([^/]+)$/);
        if (workerOrderRead) return await respond(res, 200, { order: workerDesk.get(workerOrderRead[1]) });
        if (pathname === '/api/schedule-runs') return await respond(res, 200, { runs: capabilities.listScheduleRuns() });
        if (pathname === '/api/connector-runs') return await respond(res, 200, { runs: capabilities.listConnectorRuns() });
        if (pathname === '/api/capabilities') return await respond(res, 200, capabilitySnapshot());
        if (pathname === '/api/skills') return await respond(res, 200, { skills: capabilities.listSkills() });
        if (pathname === '/api/connectors') return await respond(res, 200, { connectors: capabilities.listConnectors() });
        if (pathname === '/api/approvals') return await respond(res, 200, { approvals: capabilities.listApprovals() });
        if (pathname === '/api/schedules') return await respond(res, 200, { schedules: capabilities.listSchedules() });
        let resource = pathname.match(/^\/api\/runs\/([^/]+)$/);
        if (resource) return await respond(res, 200, runtime.getRun(resource[1]));
        resource = pathname.match(/^\/api\/artifacts\/([^/]+)(?:\/(content|download))?$/);
        if (resource) {
          if (isBrainArtifact(store.read().artifacts.find(item => item.id === resource[1]))) throw new ApiError(404, 'NOT_FOUND', 'Enterprise brain records are available only through the reviewed business context.');
          if (musePrivacy.ownsArtifact(store.read().artifacts.find(item => item.id === resource[1]))) throw new ApiError(404, 'NOT_FOUND', 'Use the exact original Muse receipt file reference.');
          const version = url.searchParams.has('version') ? Number(url.searchParams.get('version')) : undefined;
          if (resource[2] === 'download') {
            const file = await artifacts.download(resource[1], version === undefined ? {} : { version });
            if (url.searchParams.has('sha256') && url.searchParams.get('sha256') !== file.version.sha256) throw new ApiError(409, 'ARTIFACT_HASH_MISMATCH', 'Use the exact saved file version and SHA reference.');
            await res.accessFinish?.(200);
            res.writeHead(200, { 'Content-Type': file.mimeType, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`, 'Content-Length': file.bytes.length, 'X-Content-SHA256': file.version.sha256, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" }); return res.end(file.bytes);
          }
          return await respond(res, 200, resource[2] === 'content' ? await artifacts.read(resource[1], version === undefined ? {} : { version }) : artifacts.get(resource[1]));
        }
        resource = pathname.match(/^\/api\/(skills|connectors|schedules)\/([^/]+)$/);
        if (resource) return await respond(res, 200, { [{ skills: 'skill', connectors: 'connector', schedules: 'schedule' }[resource[1]]]: capabilities[{ skills: 'getSkill', connectors: 'getConnector', schedules: 'getSchedule' }[resource[1]]](resource[2]) });
        const state = { ...(musePrivacy.filterBootstrap(runtime.bootstrap(), context)), ...(piMuse ? { museBinding: piMuse.snapshot(context) } : {}), capabilities: capabilitySnapshot(), diagnostics: diagnostics() };
        const resources = { '/api/bootstrap': state, '/api/status': runtime.status(), '/api/conversations': { conversations: state.conversations }, '/api/goals': { goals: state.goals }, '/api/activity': { activity: state.activity }, '/api/settings': { settings: state.settings }, '/api/memories': { memories: state.memories } };
        if (pathname === '/api/search') { const query = (url.searchParams.get('q') || '').trim(); if (!query || query.length > 200) throw new ApiError(400, 'INVALID_INPUT', 'Search query must be 1–200 characters.'); const needle = query.toLocaleLowerCase(); const results = ['conversations', 'messages', 'goals', 'memories', 'artifacts'].flatMap(collection => (state[collection] || []).filter(item => [item.title, item.content, item.description, item.filename].some(value => typeof value === 'string' && value.toLocaleLowerCase().includes(needle))).slice(0, 50).map(item => ({ collection, id: item.id, title: item.title || item.filename || item.content?.slice(0, 100), conversationId: item.conversationId || item.sourceConversationId || null }))); return await respond(res, 200, { results: results.slice(0, 100) }); }
        if (resources[pathname]) return await respond(res, 200, resources[pathname]);
        const singular = pathname.match(/^\/api\/(goals|memories)\/([^/]+)$/);
        if (singular) { const item = state[singular[1]].find(item => item.id === singular[2]); if (!item) throw new ApiError(404, 'NOT_FOUND', 'Item not found.'); return await respond(res, 200, { [singular[1] === 'goals' ? 'goal' : 'memory']: item }); }
        const match = pathname.match(/^\/api\/conversations\/([^/]+)(?:\/messages)?$/);
        if (match) {
          const conversationId = decodeApiId(match[1]);
          const item = state.conversations.find(item => item.id === conversationId);
          if (!item) throw new ApiError(404, 'NOT_FOUND', 'Conversation not found.');
          return await respond(res, 200, { conversation: item, messages: state.messages.filter(item => item.conversationId === conversationId) });
        }
        throw new ApiError(404, 'NOT_FOUND', 'API route not found.');
      }
      if (!['POST', 'PATCH', 'DELETE'].includes(method)) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
      const body = method === 'DELETE' ? {} : await readBody(req, /^\/api\/artifacts(?:\/[^/]+)?$/.test(pathname) ? 7_100_000 : 100_000);
      access.verifyBody(context, req.bodyBytes || Buffer.alloc(0));
      musePrivacy.guardHttp(pathname, context, body);
      agentPrivacy.guardHttp(pathname, context, body);
      const museQuarantine=pathname.match(/^\/api\/muse-worker-connection\/tasks\/([^/]+)\/quarantine$/);
      if(method==='POST'&&museQuarantine){
        if(context.role!=='admin')throw new ApiError(403,'ROLE_REQUIRED','Only the original administrator may attest a stopped attempt.');
        if(!museBridge)throw new ApiError(404,'MW_GATEWAY_UNAVAILABLE','Muse bridge is not configured.');
        if(!body||Object.keys(body).some(k=>!['attemptId','fence','stoppedConfirmed','reason'].includes(k)))throw new ApiError(400,'INVALID_INPUT','Use the exact stopped attempt and evidence.');
        return await respond(res,200,await museBridge.quarantineExpired({...body,taskRef:museQuarantine[1],reviewedBy:context.subject}));
      }

      if (medusaModule && await medusaModule.handle({req,res,pathname,context,body,respond})) return;
      try {
        if (await handleGoalBrainHttp({ pathname, method, context, host: goalBrain, resolveReadSession: businessAgent?.brainReadSession, body, res, respond })) return;
      } catch (error) {
        if (error instanceof BrainError) throw new ApiError(
          /(?:STALE|CHANGED|CONFLICT)/.test(error.code) ? 409 : 403,
          error.code, 'The original reviewed business context or Session is unavailable.');
        throw error;
      }
      if (await draftHttp(req, res, pathname, context, body)) return;
      if (await supplierPublicationHttp({ publication: supplierPublication, service: supplierService, access, req, res, pathname, context, body, respond })) return;
      if (await supplierServiceHttp({ service: supplierService, access, req, res, pathname, context, body, respond })) return;
      if (await marketValidationMonitorHttp({ service: marketValidationMonitoring, req, res, pathname, context, body, respond })) return;
      const ownedFileMutation = pathname.match(/^\/api\/artifacts\/([^/]+)$/);
      if (ownedFileMutation && isBrainArtifact(store.read().artifacts.find(item => item.id === ownedFileMutation[1]))) throw new ApiError(404, 'NOT_FOUND', 'Enterprise brain records cannot be changed through generic artifact access.');
      if (ownedFileMutation && musePrivacy.ownsArtifact(store.read().artifacts.find(item => item.id === ownedFileMutation[1]))) throw new ApiError(404, 'NOT_FOUND', 'Original Muse receipt files are immutable and use the original binding.');
      const supplyWrite = await supplyHttp({ supply, method, pathname, body, actor: context });
      if (supplyWrite) return await respond(res, supplyWrite.status, supplyWrite.body);
      if (method === 'POST' && pathname === '/api/supply/shopify/observe') {
        if (context.role !== 'admin') throw new ApiError(403, 'ROLE_REQUIRED', 'Shopify product synchronization requires administrator access.');
        if (Object.keys(body).some(x => !['requestId', 'after'].includes(x)) || typeof body.requestId !== 'string' || body.after !== undefined && (typeof body.after !== 'string' || body.after.length > 2000)) throw new ApiError(400, 'INVALID_INPUT', 'Invalid Shopify catalog synchronization request.');
        const after = body.after || null;
        const previous = supply.commandReceipt('shopify.observe', { requestId: body.requestId, after }, context);
        if (previous) return await respond(res, 200, previous);
        const page = await shopify.readCatalogPage({ after });
        return await respond(res, 200, await supply.recordShopifyObservation(page, context, body.requestId, after));
      }
      if (method === 'POST' && pathname === '/api/commerce-shopify/verify') {
        if (context.role !== 'admin') throw new ApiError(403, 'ROLE_REQUIRED', 'Only administrators may verify a store authorization.');
        if (Object.keys(body).some(key => key !== 'requestId') || body.requestId !== undefined && !/^[a-f0-9-]{36}$/u.test(body.requestId)) throw new ApiError(400, 'INVALID_INPUT', 'Shopify verification accepts only an optional request ID.');
        return await respond(res, 200, { shopify: await shopify.verify() });
      }
      if (method === 'POST' && pathname === '/api/commerce-projects') return await respond(res, 201, await commerce.create(body, context));
      const commerceAction = pathname.match(/^\/api\/commerce-projects\/([^/]+)\/(stage-research|stage-worker-research|sync-orders)$/);
      if (method === 'POST' && commerceAction) return await respond(res, 200, await commerce[{ 'stage-research': 'stageResearch', 'stage-worker-research': 'stageWorkerResearch', 'sync-orders': 'syncOrders' }[commerceAction[2]]](commerceAction[1], body, context));
      const libraryWrite = await libraryHttp({ library: businessLibrary, disclosure:enterpriseDisclosure,memory:enterpriseMemory, method, pathname, body, actor: context });
      if (libraryWrite) return await respond(res, libraryWrite.status, libraryWrite.body);
      if (method === 'POST' && ['/api/session/login', '/api/session/logout'].includes(pathname)) {
        if (Object.keys(body).length) throw new ApiError(400, 'INVALID_INPUT', 'Session actions require an empty JSON object.');
        return await respond(res, 200, await access[pathname.endsWith('/login') ? 'login' : 'logout'](context, res));
      }
      const accessSession = pathname.match(/^\/api\/access\/sessions\/([^/]+)\/revoke$/);
      if (method === 'POST' && accessSession) return await respond(res, 200, await access.revokeSession(context, accessSession[1]));
      if (piMuse && await piMuse.businessHttp({ req, res, pathname, context, body, query: url.searchParams })) return;
      const expertDelegation = pathname.match(/^\/api\/cloud-experts\/([^/]+)\/delegate$/);
      if (method === 'POST' && expertDelegation) return await respond(res, 201, await cloudExperts.delegateExpert(expertDelegation[1], body, context.subject));
      if (method === 'POST' && pathname === '/api/cloud-experts') return await respond(res, 201, await cloudExperts.hire(body, context.subject));
      if (method === 'POST' && pathname === '/api/cloud-teams') return await respond(res, 201, await cloudExperts.formTeam(body, context.subject));
      const teamStage = pathname.match(/^\/api\/cloud-teams\/([^/]+)\/stage$/);
      if (teamStage && method === 'POST') return await respond(res, 201, await cloudExperts.stageTeamWork(teamStage[1], body, context.subject));
      const reconfigureExpert = pathname.match(/^\/api\/cloud-experts\/([^/]+)$/);
      if (method === 'PATCH' && reconfigureExpert) return await respond(res, 200, await cloudExperts.configure(reconfigureExpert[1], body, context.subject));
      const reconfigureTeam = pathname.match(/^\/api\/cloud-teams\/([^/]+)$/);
      if (method === 'PATCH' && reconfigureTeam) return await respond(res, 200, await cloudExperts.configureTeam(reconfigureTeam[1], body, context.subject));
      if (method === 'POST' && pathname === '/api/worker-orders') return await respond(res, 201, await workerDesk.create(body, context.subject));
      const promote = pathname.match(/^\/api\/worker-orders\/([^/]+)\/promote$/);
      if (promote && method === 'POST') {
        if (context.role !== 'admin') throw new ApiError(403, 'ROLE_REQUIRED', 'Only an administrator may import externally sourced prospects.');
        return await respond(res, 200, await workerOpportunities.importFromOrder(promote[1], body, context.subject));
      }
      const prospectReview = pathname.match(/^\/api\/worker-opportunities\/([^/]+)\/review$/);
      if (prospectReview && method === 'POST') {
        if (context.role !== 'admin') throw new ApiError(403, 'ROLE_REQUIRED', 'Only an administrator may qualify an external prospect.');
        return await respond(res, 200, await workerOpportunities.review(prospectReview[1], body, context.subject));
      }
      const workerOperation = pathname.match(/^\/api\/worker-orders\/([^/]+)\/(approve|dispatch|refresh|accept|cancel)$/);
      if (workerOperation && method === 'POST') {
        if (context.role !== 'admin') throw new ApiError(403, 'ROLE_REQUIRED', 'An administrator must authorize third-party work and review delivery.');
        const [, orderId, action] = workerOperation;
        if (action === 'approve') return await respond(res, 200, await workerDesk.approve(orderId, context.subject, body));
        if (action === 'dispatch') return await respond(res, 200, await workerDesk.dispatch(orderId));
        if (action === 'refresh') return await respond(res, 200, await workerDesk.refresh(orderId));
        if (action === 'accept') return await respond(res, 200, await workerDesk.accept(orderId, context.subject, body));
        if (action === 'cancel') return await respond(res, 200, await workerDesk.cancel(orderId));
      }
      if (method === 'POST' && pathname === '/api/artifacts') return await respond(res, 201, await artifacts.create(body));
      if (method === 'POST' && pathname === '/api/skills') return await respond(res, 201, await capabilities.createSkill(body));
      if (method === 'POST' && pathname === '/api/connectors') return await respond(res, 201, await capabilities.createConnector(body));
      if (method === 'POST' && pathname === '/api/approvals') return await respond(res, 201, await capabilities.requestApproval(body));
      if (method === 'POST' && pathname === '/api/schedules') return await respond(res, 201, await capabilities.createSchedule(body));
      let extension = pathname.match(/^\/api\/runs\/([^/]+)\/(action-decision|resume)$/);
      if (extension && method === 'POST') return await respond(res, 200, await runtime[extension[2] === 'action-decision' ? 'resolveRunAction' : 'resumeRun'](extension[1], body));
      extension = pathname.match(/^\/api\/conversations\/([^/]+)\/input-context$/);
      if (extension && method === 'PATCH') return await respond(res, 200, await runtime.updateConversationInputContext(decodeApiId(extension[1]), body));
      extension = pathname.match(/^\/api\/runs\/([^/]+)\/(cancel|retry)$/);
      if (extension && method === 'POST') return await respond(res, extension[2] === 'retry' ? 202 : 200, await runtime[extension[2] === 'cancel' ? 'cancelRun' : 'retryRun'](extension[1], body));
      extension = pathname.match(/^\/api\/artifacts\/([^/]+)$/);
      if (extension && ['PATCH', 'DELETE'].includes(method)) return await respond(res, 200, await artifacts[method === 'PATCH' ? 'update' : 'delete'](extension[1], body));
      extension = pathname.match(/^\/api\/(skills|connectors|schedules)\/([^/]+)$/);
      if (extension && ['PATCH', 'DELETE'].includes(method)) return await respond(res, 200, await capabilities[`${method === 'PATCH' ? 'update' : 'delete'}${{ skills: 'Skill', connectors: 'Connector', schedules: 'Schedule' }[extension[1]]}`](extension[2], body));
      extension = pathname.match(/^\/api\/(connectors|schedules)\/([^/]+)\/approval$/);
      if (extension && method === 'POST') { const scope = extension[1] === 'connectors' ? capabilities.connectorApprovalRequest(extension[2], body) : capabilities.scheduleApprovalRequest(extension[2]); return await respond(res, 201, await capabilities.requestApproval(scope)); }
      extension = pathname.match(/^\/api\/connectors\/([^/]+)\/execute$/);
      if (extension && method === 'POST') return await respond(res, 200, await capabilities.executeConnector(extension[1], body));
      extension = pathname.match(/^\/api\/approvals\/([^/]+)\/decision$/);
      if (extension && method === 'POST') return await respond(res, 200, await capabilities.decideApproval(extension[1], body));
      extension = pathname.match(/^\/api\/schedules\/([^/]+)\/(enable|disable)$/);
      if (extension && method === 'POST') return await respond(res, 200, await capabilities[extension[2] === 'enable' ? 'enableSchedule' : 'disableSchedule'](extension[1], body));
      extension = pathname.match(/^\/api\/conversations\/([^/]+)\/reset-session$/);
      if (extension && method === 'POST') return await respond(res, 200, await runtime.resetSession(decodeApiId(extension[1])));
      if (method === 'POST' && pathname === '/api/conversations') return await respond(res, 201, await runtime.createConversation(body, context));
      if (method === 'POST' && pathname === '/api/goals') return await respond(res, 201, await runtime.createGoal(body, {actor:context}));
      if (method === 'PATCH' && pathname === '/api/settings') return await respond(res, 200, await runtime.updateSettings(body));
      if (method === 'POST' && pathname === '/api/memories') return await respond(res, 201, await runtime.createMemory(body));
      let match = pathname.match(/^\/api\/conversations\/([^/]+)(?:\/(messages|cancel))?$/);
      if (match) {
        const [, encodedId, resource] = match;
        const id = decodeApiId(encodedId);
        if (method === 'POST' && resource === 'messages') {
          if (body.provider === 'muse' && piMuse) { piMuse.forActor(context); if (id !== piMuse.actor.nativeAgentId) throw new ApiError(403, 'MUSE_OWNER_REQUIRED', 'Use the original Muse conversation.'); return await respond(res, 201, await piMuse.forActor(context).prepare(body)); }
          if (body.provider === 'muse') throw new ApiError(409, 'MW_NATIVE_CONVERSATION_REQUIRED', 'Muse requires its original reviewed native Host and conversation binding. No model run was started.');
          if (body.provider !== undefined && !['builtin', 'pi'].includes(body.provider)) throw new ApiError(400, 'PROVIDER_NOT_AVAILABLE', 'Select an available explicitly configured provider.');
          return await respond(res, 202, await runtime.sendMessage(id, body));
        }
        if (method === 'POST' && resource === 'cancel') return await respond(res, 200, await runtime.cancelConversation(id));
        if (method === 'PATCH' && !resource) return await respond(res, 200, await runtime.updateConversation(id, body));
        if (method === 'DELETE' && !resource) return await respond(res, 200, await runtime.deleteConversation(id));
      }
      match = pathname.match(/^\/api\/goals\/([^/]+)$/);
      if (match) {
        if (method === 'PATCH') return await respond(res, 200, await runtime.updateGoal(match[1], body));
        if (method === 'DELETE') return await respond(res, 200, await runtime.deleteGoal(match[1]));
      }
      match = pathname.match(/^\/api\/memories\/([^/]+)$/);
      if (match) {
        if (method === 'PATCH') return await respond(res, 200, await runtime.updateMemory(match[1], body));
        if (method === 'DELETE') return await respond(res, 200, await runtime.deleteMemory(match[1]));
      }
      throw new ApiError(404, 'NOT_FOUND', 'API route not found.');
    } catch (error) {
      const safe = error instanceof ApiError || error instanceof CapabilityError || error instanceof WorkerDeskError || error instanceof WorkerOpportunityError || error instanceof CloudExpertError || error instanceof DotWorkerError || error instanceof MuseWorkerError || error instanceof AccessError || error instanceof MuseDraftError || error instanceof SupplierServiceError;
      try {
        if (!res.accessFinish) await access.recordDenial(error);
        if (!res.headersSent) await respond(res, safe ? error.status : 500, { error: { code: safe ? error.code : 'INTERNAL_ERROR', message: safe ? error.message : 'The server could not complete this action. Please retry.' } });
        else res.end();
      } catch {
        if (!res.headersSent) { res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: { code: 'AUDIT_UNAVAILABLE', message: 'Access audit is unavailable. Ask the operator to inspect the deployment.' } })); }
        else res.end();
      }
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 64;
  let closed = false;
  let closingPromise;
  return {
    server, runtime, store, artifacts, businessLibrary, enterpriseDisclosure,enterpriseMemory, businessAgent, shopify, commerce, supply, capabilities, workerDesk, workerOpportunities, cloudExperts, dotBridge, museBridge, museHost, piMuse, museDrafts, builtinAgent, supplierService, supplierPublication, supplierNotifications, marketValidationMonitoring, access, diagnostics,
    // In-process integration only: no HTTP/model endpoint creates an ERP grant.
    // Reuse this actual instance's current Session client and private identity.
    async freeTradeSessionBinding(identity,options={}) {
      if(!options.policy?.enabled)return null;
      const {createFreeTradeSessionBinding}=await import('./workspace-free-trade-host.mjs');
      return createFreeTradeSessionBinding({...options,identity,access,instanceId,
        sessionClient:builtinAgent.sessionReadonlyClient(identity),clock:accessClock||Date.now});
    },
    async enterpriseContextSessionBinding(identity,options={}) {
      if (!backendSelection.enabled('workspace-enterprise-context')) throw new ApiError(409,'BACKEND_PLUGIN_DISABLED','Enterprise context backend is disabled; retained history requires the original module and authorization.');
      const {createEnterpriseContextSessionBinding}=await import('./workspace-enterprise-context-host.mjs');
      return createEnterpriseContextSessionBinding({...options,identity,access,instanceId,libraryModelRead,artifacts,store,memoryLedger:enterpriseMemory,
        sessionClient:builtinAgent.sessionReadonlyClient(identity),clock:accessClock||Date.now});
    },
    async listen(port = 8787, host = '127.0.0.1') {
      if (closed) throw new Error('The application is closed. Create a new application instance.');
      if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('Only loopback binding is supported. Enterprise access requires a same-host authenticated TLS ingress.');
      await new Promise((resolve, reject) => { const failed = error => reject(error); server.once('error', failed); server.listen(port, host, () => { server.removeListener('error', failed); resolve(); }); });
      runtime.start();
      schedulerState.state = 'starting'; schedulerState.automaticTimer = true;
      scheduler = setInterval(() => { void schedulerTick(); }, schedulerIntervalMs); scheduler.unref();
      return server.address();
    },
    close() {
      if (closingPromise) return closingPromise;
      closed = true;
      closingPromise = (async () => {
        clearInterval(scheduler); schedulerState.automaticTimer = false; schedulerState.state = 'stopped';
        for (const stream of streams) stream.end();
        const stopped = new Promise(resolve => { if (!server.listening) resolve(); else server.close(resolve); });
        server.closeIdleConnections();
        try {
          // Signal both domains before waiting, so a connector cannot delay model cancellation.
          const results = await Promise.allSettled([medusaModule?.close(), builtinAgent?.close(), capabilities.close?.(), runtime.close(), museHost?.close(), piMuse?.close(), supplierMonitoring?.close(), marketValidationMonitoring?.close()]);
          await artifacts.close?.();
          const failure = results.find(result => result.status === 'rejected');
          if (failure) throw failure.reason;
          await access.close();
          await store.close();
        } finally {
          server.closeAllConnections();
          await stopped;
        }
      })();
      return closingPromise;
    },
  };
}

export async function startWorkspaceServer({ reviewedBusiness = null, environment = process.env } = {}) {
  if (reviewedBusiness !== null && environment.WORKSPACE_BUSINESS_REVIEW_FILE) throw Error('Select one original reviewed business configuration source.');
  if (environment.WORKSPACE_BUSINESS_REVIEW_FILE) reviewedBusiness = await (await import('./workspace-omp-host.mjs')).loadReviewedBusinessOptions(environment.WORKSPACE_BUSINESS_REVIEW_FILE, environment);
  // Trusted in-process composition only. HTTP selections remain references,
  // not model/parser/remember authorization; the default startup is unchanged.
  if (reviewedBusiness !== null && (!reviewedBusiness || typeof reviewedBusiness !== 'object'
    || Object.keys(reviewedBusiness).some(key => !['libraryModelReadPolicy','goalBrainOptions','agentConfig','resolveBinding','paidAcceptance','modelBudget','pluginConfiguration'].includes(key))
    || typeof reviewedBusiness.resolveBinding !== 'function' || !reviewedBusiness.libraryModelReadPolicy || !reviewedBusiness.goalBrainOptions))
    throw Error('Use the original reviewed Library/Goal policy and trusted binding resolver.');
  const port = Number(environment.PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  // The key is read only on explicit server startup, never scanned from user files.
  const mode = environment.WORKSPACE_RUNTIME || 'omp';
  if (!['omp', 'pi'].includes(mode)) throw new Error('WORKSPACE_RUNTIME must be omp (default frontend) or pi (explicit fallback).');
  const access = await accessConfigFromEnvironment(environment);
  const dataDirectory = path.resolve(environment.WORKSPACE_DATA_DIR || path.join(root, '.data'));
  const provider = createPiProvider({ ...loadPiProviderConfig(environment), researchAdapter: createBraveResearchAdapter({ environment: environment }) });
  if (reviewedBusiness && (mode !== 'omp' || environment.WORKSPACE_OMP_PROFILE !== 'business')) throw Error('Reviewed business composition requires the explicit business profile.');
  const businessAgentOptions = mode === 'omp' ? (await import('./workspace-omp-host.mjs')).createWorkspaceOmpBusinessOptions({
    environment: environment, baseURL: `http://127.0.0.1:${port}`,
    ...(reviewedBusiness ? { paidAcceptance: reviewedBusiness.paidAcceptance || null, modelBudget: reviewedBusiness.modelBudget || null, pluginConfiguration: reviewedBusiness.pluginConfiguration ?? null, resolveReviewedBusinessBinding: args => reviewedBusiness.resolveBinding({ ...args,
      enterpriseContextSessionBinding: options => app.enterpriseContextSessionBinding(args.actor, options),
      conversationReferences: id => app.businessLibrary.getConversationReferences(id) }) } : {}),
  }) : null;
  // No SDK, credentials, outbound requests or partner registration without a
  // pinned, privately stored deployment catalog. Web clients cannot edit it.
  const reviewedWorkers = await loadReviewedA2AWorkers({ environment: environment });
  // The official dot product has no verified inbound task API. Instead,
  // a reviewed ChatGPT plugin can pull scoped public work from this host.
  if (environment.WORKSPACE_DOT_ENABLED === '1' && !environment.WORKSPACE_DOT_BRIDGE_TOKEN_SHA256)
    throw new Error('WORKSPACE_DOT_ENABLED requires a server-side pinned dot plugin token hash.');
  if (environment.WORKSPACE_MUSE_ENABLED === '1' && !environment.WORKSPACE_MUSE_BRIDGE_TOKEN_SHA256)
    throw new Error('WORKSPACE_MUSE_ENABLED requires a server-side pinned Muse token hash.');
  const museWorkerConfig = environment.WORKSPACE_MUSE_BRIDGE_TOKEN_SHA256 ? {
    workerId: environment.WORKSPACE_MUSE_WORKER_ID || 'muse-personal-owner',
    ownerId: environment.WORKSPACE_MUSE_OWNER_ID || 'personal',
    tokenDigest: environment.WORKSPACE_MUSE_BRIDGE_TOKEN_SHA256,
    enabled: environment.WORKSPACE_MUSE_ENABLED === '1',
    scopeReviewed: environment.WORKSPACE_MUSE_SCOPE_REVIEWED === '1',
    externalBudgetVerified: environment.WORKSPACE_MUSE_EXTERNAL_BUDGET_VERIFIED === '1',
  } : null;
  let museOriginalBinding = null;
  if (environment.WORKSPACE_MUSE_ORIGINAL_BINDING_FILE) {
    const filename = environment.WORKSPACE_MUSE_ORIGINAL_BINDING_FILE;
    if (!path.isAbsolute(filename) || !museWorkerConfig) throw new Error('Original Muse binding requires its existing config and an absolute private file.');
    const handle = await openPrivateFile(filename, 'r');
    try { if ((await handle.stat()).size > 16000) throw new Error('Original Muse binding file is too large.'); museOriginalBinding = JSON.parse(await handle.readFile('utf8')); } finally { await handle.close(); }
  }
  const sourcingMcpConfig = {
    enabled: environment.WORKSPACE_SOURCING_MCP_ENABLED === '1',
    tokenDigest: environment.WORKSPACE_SOURCING_MCP_TOKEN_SHA256 || '',
  };
  if (environment.WORKSPACE_SOURCING_MCP_PRINCIPALS_FILE) {
    const filename = environment.WORKSPACE_SOURCING_MCP_PRINCIPALS_FILE;
    if (!path.isAbsolute(filename)) throw new Error('Procurement principal configuration requires an absolute private path.');
    const handle = await openPrivateFile(filename, 'r');
    try {
      if ((await handle.stat()).size > 64_000) throw new Error('Procurement principal configuration is too large.');
      sourcingMcpConfig.principals = JSON.parse(await handle.readFile('utf8'));
    } finally { await handle.close(); }
  }
  if (sourcingMcpConfig.enabled && sourcingMcpConfig.tokenDigest && [environment.WORKSPACE_DOT_BRIDGE_TOKEN_SHA256, environment.WORKSPACE_MUSE_BRIDGE_TOKEN_SHA256].filter(Boolean).includes(sourcingMcpConfig.tokenDigest))
    throw new Error('Sourcing MCP must use its own independent credential.');
  const dotWorkerConfig = environment.WORKSPACE_DOT_BRIDGE_TOKEN_SHA256 ? {
    workerId: environment.WORKSPACE_DOT_WORKER_ID || 'chatgpt-dot-xy',
    ownerId: environment.WORKSPACE_DOT_OWNER_ID || 'xy',
    tokenDigest: environment.WORKSPACE_DOT_BRIDGE_TOKEN_SHA256,
    enabled: environment.WORKSPACE_DOT_ENABLED === '1',
    scopeReviewed: environment.WORKSPACE_DOT_SCOPE_REVIEWED === '1',
    externalBudgetVerified: environment.WORKSPACE_DOT_EXTERNAL_BUDGET_VERIFIED === '1',
  } : null;
  let app, nativeIngress;
  try {
    app = await createApp({ dataDirectory, provider, access, businessAgentOptions, capabilityEnvironment: environment,
      backendPlugins: backendPluginsFromEnvironment(environment),
      ...(reviewedBusiness ? { libraryModelReadPolicy: reviewedBusiness.libraryModelReadPolicy,
        goalBrainOptions: reviewedBusiness.goalBrainOptions, agentConfig: reviewedBusiness.agentConfig } : {}),
      workerAdapters: reviewedWorkers.adapters,
      dotWorkerConfig, museWorkerConfig, museOriginalBinding, sourcingMcpConfig,
      allowedOrigins: environment.WORKSPACE_DEV_ORIGIN ? [environment.WORKSPACE_DEV_ORIGIN] : [],
      maxConcurrentRuns: 3 });
    await app.listen(port);
    nativeIngress = await openWechatIngress({ app, access, configFile: environment.WORKSPACE_WECHAT_INGRESS_FILE });
  } catch (error) {
    await nativeIngress?.close();
    await Promise.allSettled([app?.close?.(), reviewedWorkers.close()]);
    throw error;
  }
  console.log(`Workspace server: http://127.0.0.1:${port} (${access.mode} access; ${mode}; ${provider.configured ? 'configured; not connection-tested' : 'setup required'})`);
  const stop = () => {
    Promise.resolve(nativeIngress?.close()).then(() => Promise.allSettled([app.close(), reviewedWorkers.close()])).then(results => {
      process.exit(results.every(result => result.status === 'fulfilled') ? 0 : 1);
    });
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
  return { ...app, close: async () => {
    for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, stop);
    await nativeIngress?.close(); await app.close(); await reviewedWorkers.close();
  } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startWorkspaceServer().catch(error => { console.error(error.message); process.exitCode = 1; });
