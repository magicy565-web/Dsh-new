import { ApiError } from './runtime.mjs';

// Browser/enterprise-session surface only. It does not expose a model tool,
// Worker credential, schedule approval shortcut or caller-authored launch receipt.
export async function marketValidationMonitorHttp({ service, req, res, pathname, context, body, respond }) {
  const create = pathname.match(/^\/api\/conversations\/([^/]+)\/market-validation-monitors$/);
  const task = pathname.match(/^\/api\/goals\/([^/]+)\/market-validation-monitor(?:\/(observe|control))?$/);
  if (!create && !task) return false;
  if (!['admin', 'operator'].includes(context.role)) throw new ApiError(403, 'ROLE_REQUIRED', 'Use the current authorized enterprise member.');
  const scoped = service.forActor(context);
  if (create && req.method === 'GET') { await respond(res, 200, { monitors: scoped.list(create[1]) }); return true; }
  if (task && req.method === 'GET' && !task[2]) { await respond(res, 200, scoped.get(task[1])); return true; }
  if (req.method !== 'POST' || !body) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use the original task observation/control methods.');
  if (create) {
    if (body.confirmed !== true) throw new ApiError(400, 'MONITOR_CONFIRMATION_REQUIRED', 'Confirm creating the original linked observation task.');
    const result = await scoped.create(body, { sourceConversationId: create[1] });
    await respond(res, 201, result); return true;
  }
  if (!task[2]) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use observe or control.');
  if (Object.hasOwn(body, 'goalId')) throw new ApiError(400, 'INVALID_INPUT', 'The original task is selected by its route.');
  await respond(res, 200, await scoped[task[2]]({ ...body, goalId: task[1] })); return true;
}
