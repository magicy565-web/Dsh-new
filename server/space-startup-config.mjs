/** Explicit operator opt-in; never derived from a request, plugin or model. */
export function spaceStartupOptions(environment, accessConfig) {
  const value = environment?.WORKSPACE_SPACE_ENABLED;
  if (value !== undefined && value !== '0' && value !== '1') throw new Error('WORKSPACE_SPACE_ENABLED must be exactly 0 or 1.');
  const enabled = value === '1';
  if (enabled && accessConfig?.mode !== 'enterprise') throw new Error('Space requires the original signed enterprise Host before enablement.');
  return Object.freeze({ enabled });
}
