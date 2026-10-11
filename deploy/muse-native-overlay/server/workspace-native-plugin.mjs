/** Cordis plugin entry for the reviewed DeepSeek Harness 0.2.0-rc.2 installation. */
import { defineTool, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools';
import { createWorkspacePlugin } from './workspace-plugin.mjs';
import { createNativeToolInstaller } from './workspace-native-tools.mjs';
import { openWorkspacePluginService } from './workspace-plugin-service.mjs';
import { createNativeDotBinding } from './workspace-dot-host.mjs';
import { pluginFields, pluginFail } from './workspace-plugin-config.mjs';
import { inspectReviewedDotHistory, resumeReviewedDotHistory } from './workspace-dot-history-review.mjs';

export { name, inject, configurationSchema } from './workspace-plugin.mjs';

/** Attach Workspace to existing native services; disabled configuration opens no business storage. */
export const apply = createWorkspaceNativePlugin().apply;

/** Bind trusted native readers without putting functions or identity assertions in tool input.
 * @param options - Host-owned result readers for the reviewed original Muse instances.
 * @returns Native plugin using the existing Workspace business service and scoped Tools.
 */
export function createWorkspaceNativePlugin({ nativeResults = [], dot } = {}) {
  const nativeInstaller = createNativeToolInstaller({ defineTool, validateJsonSchemaValue });
  const bindings = new Map();
  let service;
  const plugin = createWorkspacePlugin({
    installAgentTools({ ctx, nativeAgentId, tools }) {
      if (dot?.configuration?.enabled !== true) return nativeInstaller({ ctx, nativeAgentId, tools });
      const actor = dot.operators?.find(o => o.nativeAgentId === nativeAgentId);
      if (!actor) throw Error('Every dot-enabled native Agent needs its reviewed ownership binding.');
      const binding = createNativeDotBinding({ ctx, service, actor, authorizePublicTask: dot.authorizePublicTask });
      const remove = nativeInstaller({ ctx, nativeAgentId, tools: [...tools, ...binding.tools] });
      bindings.set(nativeAgentId, binding);
      return () => { if (bindings.get(nativeAgentId) === binding) bindings.delete(nativeAgentId); remove(); };
    },
    async openService(options) {
      service = await openWorkspacePluginService({ ...options, nativeResults,
        dotConfiguration: dot?.configuration, dotOwnerSubject: dot?.ownerSubject, dotTransport: dot?.transport });
      return service;
    },
  });
  return { ...plugin, ...(dot?.configuration?.enabled === true ? { inject: [...plugin.inject, 'goals', 'sessions'] } : {}), async apply(ctx, config) {
    if (dot?.configuration?.enabled === true) dot = { ...dot, operators: config.operators };
    const attached = await plugin.apply(ctx, config);
    if (attached.service) ctx.provide('workspaceBusiness', attached.service);
    if (attached.service?.dot.enabled) {
      ctx.provide('workspaceDotHost', Object.freeze({
        // Private Host reviews may refresh scope handles without resuming any
        // personal Worker connection, editing Goals or changing OAuth bindings.
        refreshReviewedTools: review => attached.refreshTools(review),
        async inspectReviewedHistory(review) {
          const { historyHash, summary } = await inspectReviewedDotHistory({ ctx, service: attached.service, operators: config.operators,
            ownerSubject: dot.ownerSubject, authorizePublicTask: dot.authorizePublicTask, review });
          return { historyHash, summary };
        },
        resumeReviewedHistory(review) {
          return resumeReviewedDotHistory({ ctx, service: attached.service, operators: config.operators,
            ownerSubject: dot.ownerSubject, authorizePublicTask: dot.authorizePublicTask, review });
        },
        async resumeEmptyMount(review) {
          // Operator recovery only. Never reachable by browser or model Tools.
          pluginFields(review, ['expectedEpoch', 'configurationHash', 'requestId', 'connectionId', 'authorizationEpoch']);
          const current = attached.service.status(), actor = config.operators.find(o => o.subject === dot.ownerSubject);
          if (current.phase !== 'paused' || current.epoch !== review.expectedEpoch || current.configurationHash !== review.configurationHash
            || current.unfinishedDelegations || current.reconciliationRequired) pluginFail('WORKSPACE_DOT_EMPTY_REVIEW', 'Review the exact paused original mount without any unfinished assignments.');
          for (const owner of config.operators) {
            const agent = ctx.agents.get(owner.nativeAgentId);
            if (!agent || ctx.goals.get(agent) || (await attached.service.bindDotTasks(owner).view()).length) pluginFail('WORKSPACE_DOT_EMPTY_REVIEW', 'An original Goal or task exists; empty-mount recovery cannot settle or replace it.');
          }
          const view = await attached.service.bindActor(actor).view(), connection = view.worker?.connection;
          if (view.delegations.length || !connection || connection.id !== review.connectionId || connection.authorizationEpoch !== review.authorizationEpoch
            || connection.drainingAt || connection.revokedAt) pluginFail('WORKSPACE_DOT_EMPTY_REVIEW', 'Review the exact existing connection, without past or unfinished work.');
          await attached.service.resume({ expectedEpoch: review.expectedEpoch, configurationHash: review.configurationHash, requestId: review.requestId + '-scope' });
          const resumed = (await attached.service.bindActor(actor).resumeConnection({ connectionId: review.connectionId, requestId: review.requestId + '-connection' })).worker.connection;
          return { lifecycle: attached.service.status(), connection: resumed };
        },
        submitQuestion(actor, body) {
          const binding = bindings.get(actor.nativeAgentId);
          if (!config.operators.some(o => o.subject === actor.subject && o.nativeAgentId === actor.nativeAgentId) || !binding) throw Error('The authenticated user has no original native Session binding.');
          return binding.submitQuestion(body);
        },
        acceptResult(actor, body) {
          const binding = bindings.get(actor.nativeAgentId);
          if (!config.operators.some(o => o.subject === actor.subject && o.nativeAgentId === actor.nativeAgentId) || !binding) throw Error('The authenticated user has no original native Session binding.');
          return binding.acceptResult(body);
        },
        cancelTask(actor, body) {
          const binding = bindings.get(actor.nativeAgentId);
          if (!config.operators.some(o => o.subject === actor.subject && o.nativeAgentId === actor.nativeAgentId) || !binding) throw Error('The authenticated user has no original native Session binding.');
          return binding.cancelTask(body);
        },
        closeResult(actor, body) {
          const binding = bindings.get(actor.nativeAgentId);
          if (!config.operators.some(o => o.subject === actor.subject && o.nativeAgentId === actor.nativeAgentId) || !binding) throw Error('The authenticated user has no original native Session binding.');
          return binding.closeResult(body);
        },
        async reviewBindings(review) {
          const current = await attached.service.dot.reviewBindings(review);
          await attached.refreshTools({ expectedEpoch: current.epoch, configurationHash: current.configurationHash });
          return current;
        },
      }));
      await ctx.effect(async () => {
        await attached.service.dot.start();
        let active = true, pending;
        const tick = () => {
          if (!active || pending) return;
          pending = (async () => {
            for (const binding of bindings.values()) {
              if (!active) break;
              try { await binding.reconcile(); } catch { /* Preserve original tasks for explicit reconciliation. */ }
            }
          })().finally(() => { pending = undefined; });
        };
        const timer = setInterval(tick, 1200); timer.unref(); tick();
        return async () => { active = false; clearInterval(timer); await pending; };
      }, 'workspace-dot: return original results before detaching business authority');
    }
    // Cordis accepts a disposer or void, never the Host-neutral attachment object.
  } };
}
