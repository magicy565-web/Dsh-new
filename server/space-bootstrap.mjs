/** Keep private Space state out of the original broad bootstrap projection. */
export function bindSpaceSafeBootstrap(runtime) {
  if (!runtime || typeof runtime.bootstrap !== 'function') throw new TypeError('The original Runtime bootstrap is required.');
  const original = runtime.bootstrap.bind(runtime);
  runtime.bootstrap = function spaceSafeBootstrap() {
    const snapshot = original();
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || typeof snapshot.then === 'function') throw new TypeError('Use the original synchronous bootstrap projection.');
    // Space has dedicated current-member routes. Generic bootstrap/search and
    // downstream consumers of this same Runtime receive no page/grant/receipt.
    const { workspaceSpaces: _privateSpaceState, ...visible } = snapshot;
    return visible;
  };
  return runtime;
}
