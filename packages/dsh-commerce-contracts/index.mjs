export * from "./validation.mjs";
import { BusinessError, isBusinessError, fail, id } from "./validation.mjs";
// These are internal server capabilities, never serialized or accepted from JSON.
// DSH owns authentication; every operation rechecks current native membership.
export function createAccess(registry) {
  let closed = false;
  const scopes = new WeakSet();
  const locate = (sessionId) => {
    if (closed) fail("UNAVAILABLE", "Plugin unloaded", 503);
    id(sessionId, "sessionId");
    const rows = registry
      .list()
      .filter((w) => w.sessionIds.includes(sessionId));
    if (rows.length !== 1)
      fail(
        "SESSION_REQUIRED",
        "A uniquely bound native session is required",
        403,
      );
    return rows[0].id;
  };
  const create = (sessionId, kind, execution, guard) => {
    const workspaceId = locate(sessionId);
    const s = {
      workspaceId,
      sessionId,
      kind,
      actor: kind === "owner" ? `owner:${sessionId}` : `agent:${sessionId}`,
      callId: kind === "tool" ? id(execution?.callId, "callId") : null,
      signal: execution?.signal,
      check() {
        guard?.();
        execution?.signal?.throwIfAborted();
        if (!scopes.has(s) || locate(sessionId) !== workspaceId)
          fail("SCOPE_CHANGED", "Native workspace changed", 403);
      },
    };
    scopes.add(s);
    s.check();
    return Object.freeze(s);
  };
  return {
    owner: (sessionId, guard) => create(sessionId, "owner", undefined, guard),
    tool: (execution) =>
      create(execution?.agent?.session?.id, "tool", execution),
    close: () => {
      closed = true;
    },
  };
}
export function checkScope(scope, registry, owner = false) {
  if (typeof scope?.check !== "function")
    fail("IDENTITY_REQUIRED", "Internal native scope required", 403);
  scope.check();
  if (
    !registry
      .list()
      .some(
        (w) =>
          w.id === scope.workspaceId && w.sessionIds.includes(scope.sessionId),
      )
  )
    fail("SCOPE_CHANGED", "Session no longer belongs to workspace", 403);
  if (owner && scope.kind !== "owner")
    fail(
      "OWNER_REQUIRED",
      "Only the authenticated owner may approve this operation",
      403,
    );
}
export async function jsonBody(req, max = 256 * 1024) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? ""))
    fail("CONTENT_TYPE", "JSON required", 415);
  let n = 0;
  const chunks = [];
  for await (const chunk of req) {
    n += chunk.length;
    if (n > max) fail("BODY_TOO_LARGE", "Request too large", 413);
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail("INPUT", "Invalid JSON", 400);
  }
  return body;
}
export function sameOrigin(req) {
  let origin;
  try {
    origin = new URL(req.headers.origin);
  } catch {
    fail("ORIGIN_DENIED", "Same-origin browser required", 403);
  }
  const protocol = req.socket?.encrypted ? "https:" : "http:";
  if (
    origin.protocol !== protocol ||
    origin.host !== req.headers.host ||
    (req.headers["sec-fetch-site"] &&
      !["same-origin", "none"].includes(req.headers["sec-fetch-site"]))
  )
    fail("ORIGIN_DENIED", "Same-origin browser required", 403);
}
export const respond = (res, status, body) => {
  if (!res.destroyed) {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.end(JSON.stringify(body));
  }
};
export function ownerHttp(prefix, service, { authorize } = {}) {
  return async (req, res) => {
    try {
      let rejected = 401;
      try {
        if (authorize) rejected = await authorize({ headers: req.headers });
      } catch {
        /* deny */
      }
      if (rejected)
        fail("UNAUTHORIZED", "Authenticated DSH Connection required", 401);
      const url = new URL(req.url, "http://localhost");
      if (!url.pathname.startsWith(prefix + "/"))
        fail("NOT_FOUND", "Unknown endpoint", 404);
      const action = url.pathname.slice(prefix.length + 1);
      let body;
      if (req.method === "GET") body = Object.fromEntries(url.searchParams);
      else if (req.method === "POST") {
        sameOrigin(req);
        body = await jsonBody(
          req,
          action === "upload-evidence" ? 384 * 1024 : 256 * 1024,
        );
      } else fail("METHOD", "Unsupported method", 405);
      // authorize is rechecked before and after an asynchronous operation.
      const recheck = async () => {
        if (await authorize({ headers: req.headers }))
          fail("UNAUTHORIZED", "Connection revoked", 401);
      };
      recheck.sync = () => {
        const rejection = authorize({ headers: req.headers });
        if (rejection?.then)
          fail(
            "AUTH_INTERFACE_UNSUPPORTED",
            "Native synchronous Connection authorization is required",
            503,
          );
        if (rejection) fail("UNAUTHORIZED", "Connection revoked", 401);
      };
      await recheck();
      const data = await service.http(req.method, action, body, recheck);
      await recheck();
      respond(res, 200, { ok: true, data });
    } catch (e) {
      respond(res, isBusinessError(e) ? e.status : 500, {
        ok: false,
        error: {
          code: isBusinessError(e) ? e.code : "INTERNAL",
          message: isBusinessError(e)
            ? e.message
            : "Operation failed; inspect current records before retrying",
        },
      });
    }
  };
}
export const schema = (properties) => ({
  type: "object",
  additionalProperties: false,
  properties,
});
export const identifier = { type: "string", minLength: 1, maxLength: 128 };
export function register(ctx, name, description, parameters, execute) {
  ctx.effect(
    () =>
      ctx.tools.register({
        name,
        description,
        parameters,
        execute,
        output: {
          schema: { type: "object" },
          render: (_, value) => [{ type: "text", text: JSON.stringify(value) }],
        },
      }),
    name,
  );
}
