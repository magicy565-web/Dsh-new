const SUPPLY_FIELDS = ['packaging', 'samplePolicy', 'paymentTerms', 'shippingTerms', 'capacityNote'];

// Shared original Product Library rule. Public references cannot assert
// enterprise supply; ordinary products must include each required field.
export function productSupplyMissing(product) {
  if (product?.source?.kind === 'public_reference') return false;
  const supply = product?.supply || {};
  return SUPPLY_FIELDS.some(key => typeof supply[key] !== 'string' || !supply[key].trim());
}
