// Shape-only evidence: no material values, free-form keys or contents in logs.
export function localToolArgumentSummary(name, args, manifest) {
  const fields = (value, allowed) => {
    const object = value !== null && typeof value === 'object' && !Array.isArray(value);
    return { supplied: value !== undefined, object,
      fields: object ? allowed.filter(k => Object.hasOwn(value, k)) : [],
      unknownFieldCount: object ? Object.keys(value).filter(k => !allowed.includes(k)).length : 0,
      nonScalarFieldCount: object ? Object.values(value).filter(v => v !== null && !['string','number'].includes(typeof v)).length : 0,
      emptyFieldCount: object ? Object.values(value).filter(v => v == null || typeof v === 'string' && !v.trim()).length : 0 };
  };
  if (name === 'read') return { selectedInputId: manifest.some(f => f.id === args?.path) };
  if (name === 'write') return { textContent: typeof args?.content === 'string', contentBytes: typeof args?.content === 'string' ? Buffer.byteLength(args.content) : null };
  if (['workspace_factory_rfq_requirements','workspace_factory_match_prepare'].includes(name)) return {
    rfq: fields(args?.rfq, ['product','spec','quantity','target_market','requested_delivery','requirements']),
    ...(name === 'workspace_factory_match_prepare' ? { factoryOffer: fields(args?.factoryOffer, ['product','spec','available_quantity','production_capacity','lead_time','supply_conditions','source']) } : {}) };
  return { objectArguments: args !== null && typeof args === 'object' && !Array.isArray(args) };
}
