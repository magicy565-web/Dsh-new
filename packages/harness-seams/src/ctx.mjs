// Internal kernel-context helpers shared by the three seam providers.
//
// The harness kernel is a Cordis 4 application. In cordis@4.0.0-rc.11 a plain
// `ctx.storage = value` throws "cannot set property without provide" inside a
// plugin fiber, and a service provided by a sibling plugin is only readable
// through the context when the reading fiber injects it. The providers must be
// mountable both by the real kernel (Cordis) and directly in plain-object unit
// tests, so service publication/readback is centralised here.

/** Read a service from a kernel context, tolerating absent/not-injected ones. */
export function serviceFromContext(ctx, name) {
  if (!ctx || typeof ctx !== 'object') return undefined;
  try {
    const value = ctx[name];
    if (value !== undefined) return value;
  } catch {
    // Cordis throws for a property that is neither declared nor injected; fall
    // through to the reflection service, which can see sibling provisions.
  }
  try {
    const reflected = ctx.reflect?.get?.(name, false);
    if (reflected !== undefined) return reflected;
  } catch {
    // No reflection service (plain test context) or the service is absent.
  }
  return undefined;
}

/**
 * Publish `value` as service `name` on the context.
 * @returns {{provided: boolean, dispose: () => Promise<void>}}
 */
export function provideService(ctx, name, value) {
  if (!ctx || typeof ctx !== 'object') throw new TypeError(`Cannot provide "${name}" on a non-object context.`);
  if (typeof ctx.provide === 'function') {
    // Returns a callable AsyncDisposable: invoking it tears the provision down.
    const disposable = ctx.provide(name, value);
    return {
      provided: true,
      dispose: async () => {
        if (typeof disposable === 'function') await disposable();
      },
    };
  }
  ctx[name] = value;
  return {
    provided: true,
    dispose: async () => {
      try {
        delete ctx[name];
      } catch {
        // A frozen/readonly plain context keeps the value; nothing to release.
      }
    },
  };
}

/** Normalise an actor (`{subject, role?, workspaceId?}`) into a detached copy. */
export function normalizeActor(actor) {
  if (!actor || typeof actor !== 'object' || Array.isArray(actor)) return null;
  if (typeof actor.subject !== 'string' || !actor.subject.trim()) return null;
  return {
    subject: actor.subject,
    role: typeof actor.role === 'string' && actor.role ? actor.role : null,
    workspaceId: typeof actor.workspaceId === 'string' && actor.workspaceId ? actor.workspaceId : null,
  };
}
