/** Production completeness is separate from a valid draft's schema. */
export function productionReadiness(issue) {
  const blockers = [];
  if (issue.composition === 'modules') return { status: 'draft', blockers: ['VISUAL_REVIEW_REQUIRED'] };
  const d = issue.design;
  if (!d) blockers.push('DESIGN_BRIEF_MISSING');
  else {
    if (!issue.title.toLowerCase().includes(d.brand.toLowerCase()) && !issue.cover.headline.toLowerCase().includes(d.brand.toLowerCase())) blockers.push('BRAND_NOT_ON_COVER');
    if (d.imageTreatment === 'text-led' && !d.textLedRequested) blockers.push('TEXT_LED_NOT_REQUESTED');
  }
  if (d?.imageTreatment !== 'text-led' || !d?.textLedRequested) {
    if (!issue.cover.image) blockers.push('COVER_IMAGE_MISSING');
    if (issue.products.some(p => !p.image)) blockers.push('PRODUCT_IMAGES_MISSING');
  }
  blockers.push('VISUAL_REVIEW_REQUIRED');
  return { status: 'incomplete', blockers };
}

export function designCss(issue) {
  const d = issue.design;
  if (!d) return '';
  // All values are bounded schema enums or six-digit hex colours. Never accept raw CSS.
  const p = d.palette;
  return `html[data-theme]{--paper:${p.paper};--surface:${p.surface};--ink:${p.ink};--accent:${p.accent};--forest:${p.ink};--sage:${p.surface}}` +
    (d.fontStyle === 'modern' ? 'html[data-theme]{--serif:var(--sans)}' : '') +
    '.masthead-tagline{max-width:280px}.hero h1{font-size:clamp(38px,5.1vw,76px);line-height:1.15;letter-spacing:-.035em}.hero-dek{max-width:520px}.hero-art img{object-fit:contain}' +
    (d.imageTreatment === 'text-led' && d.textLedRequested ? '.hero{grid-template-columns:1fr}.hero-art{display:none}.product-feature{grid-template-columns:1fr}.product-visual{display:none}.hero h1{max-width:1000px}' : '') +
    '@media(min-width:1000px){.product-feature:nth-of-type(even) .product-visual{order:2}.product-feature:nth-of-type(even) .product-content{order:1}}';
}
