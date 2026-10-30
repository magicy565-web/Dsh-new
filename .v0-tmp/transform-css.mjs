import postcss from 'postcss';
import { readFileSync, writeFileSync } from 'node:fs';

const file = 'integrations/dsh/dsh-commerce-network/src/styles.css';
const source = readFileSync(file, 'utf8');
const root = postcss.parse(source);

// Rules for these classes are replaced by canvas.css.
const REPLACED = new Set([
  'cn-header', 'cn-heading', 'cn-brand', 'cn-header-actions', 'cn-toolbar', 'cn-view-switch', 'cn-toolbar-right', 'cn-review-pill', 'cn-budget-button',
  'cn-content', 'cn-flow', 'cn-search-muted', 'cn-node', 'cn-node-selected', 'cn-node-top', 'cn-node-icon', 'cn-node-type', 'cn-node-menu', 'cn-node-summary',
  'cn-node-detail', 'cn-node-proof', 'cn-product-preview', 'cn-product-icon', 'cn-member-avatar', 'cn-inspector-icon', 'cn-kind-factory', 'cn-kind-distributor',
  'cn-kind-personal_agent', 'cn-kind-service_order', 'cn-kind-product', 'cn-kind-channel', 'cn-kind-market', 'cn-kind-worker', 'cn-kind-buyer',
  'cn-status', 'cn-tone-green', 'cn-tone-blue', 'cn-tone-red', 'cn-tone-amber', 'cn-tone-muted',
  'cn-canvas-search', 'cn-canvas-tools', 'cn-footer', 'cn-layout-state', 'cn-empty', 'cn-empty-network', 'cn-empty-shortcuts', 'cn-loading', 'cn-error-empty',
  'cn-inspector', 'cn-inspector-scroll', 'cn-inspector-actions', 'cn-members-panel', 'cn-activity-panel', 'cn-panel-intro', 'cn-member-list', 'cn-event',
  'cn-event-dot', 'cn-panel-empty', 'cn-notices', 'cn-message', 'cn-message-error', 'cn-add',
]);
const firstClass = (selector) => selector.match(/\.(cn-[a-z0-9_-]+)/)?.[1] || null;
const isReplaced = (selector) => /react-flow/.test(selector) || REPLACED.has(firstClass(selector));

const parse = (hex) => {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  const n = (i) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
};
const hsl = ({ r, g, b }) => {
  const [R, G, B] = [r, g, b].map((v) => v / 255);
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? ((G - B) / d + (G < B ? 6 : 0)) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: h * 60, s, l };
};
const hue = ({ h, s }) => (s < 0.16 ? 'neutral' : h < 20 || h >= 340 ? 'red' : h < 65 ? 'amber' : h < 175 ? 'green' : h < 255 ? 'blue' : 'purple');
const mix = (token, share, base = 'transparent') => `color-mix(in srgb,var(${token}) ${Math.round(share)}%,${base})`;

function background(color) {
  const { a } = color, { l, s } = hsl(color), family = hue({ ...hsl(color) });
  if (a < 1) return mix('--cn-ink', a * 100);
  if (l >= 0.965) return 'var(--cn-surface)';
  if (family === 'neutral' || (family === 'green' && s < 0.26 && l >= 0.85)) return l >= 0.9 ? 'var(--cn-surface-sunken)' : l >= 0.78 ? 'var(--cn-line)' : l >= 0.45 ? 'var(--cn-line-strong)' : 'var(--cn-ink)';
  if (l >= 0.84) return { red: 'var(--cn-tone-red-bg)', amber: 'var(--cn-tone-amber-bg)', green: 'var(--cn-tone-green-bg)', blue: 'var(--cn-tone-blue-bg)', purple: mix('--cn-kind-ai', 12, 'var(--cn-surface)') }[family];
  if (l < 0.4 && family === 'green') return mix('--cn-accent', 82, 'var(--cn-ink)');
  if (l < 0.3) return 'var(--cn-ink)';
  return { red: 'var(--cn-tone-red)', amber: 'var(--cn-tone-amber)', green: 'var(--cn-accent)', blue: 'var(--cn-tone-blue)', purple: 'var(--cn-kind-ai)' }[family];
}
function line(color) {
  const { l, s } = hsl(color), family = hue(hsl(color));
  if (color.a < 1) return mix('--cn-ink', color.a * 100);
  if (l >= 0.965) return 'var(--cn-surface)';
  if (family !== 'neutral' && s >= 0.3 && l < 0.82) return mix(family === 'purple' ? '--cn-kind-ai' : `--cn-tone-${family === 'green' ? 'green' : family}`, 42, 'var(--cn-line)');
  return l >= 0.8 ? 'var(--cn-line)' : 'var(--cn-line-strong)';
}
function foreground(color) {
  const { l, s } = hsl(color), family = hue(hsl(color));
  if (color.a < 1) return mix('--cn-ink', color.a * 100);
  if (l >= 0.965) return 'var(--cn-accent-ink)';
  if (family === 'neutral' || s < 0.2) return l < 0.4 ? 'var(--cn-ink)' : 'var(--cn-muted)';
  return { red: 'var(--cn-tone-red)', amber: 'var(--cn-tone-amber)', green: l < 0.25 ? 'var(--cn-ink)' : 'var(--cn-tone-green)', blue: 'var(--cn-tone-blue)', purple: 'var(--cn-kind-ai)' }[family];
}
const shadow = (color) => (color.a < 1 ? mix('--cn-ink', color.a * 100) : 'var(--cn-line-strong)');

const kindOf = (prop) => (/^(background|--)/.test(prop) ? background : /^(border|outline|column-rule|text-decoration-color)/.test(prop) ? line : /shadow|^filter$/.test(prop) ? shadow : foreground);
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const RGB = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)/g;

let converted = 0;
const legacy = [];
let seenTokens = false;
for (const node of [...root.nodes]) {
  if (node.type === 'comment' && /cn-tokens:end/.test(node.text)) { seenTokens = true; continue; }
  if (seenTokens && node.type !== 'comment') legacy.push(node);
}

function prune(container) {
  container.each((child) => {
    if (child.type === 'rule') {
      if (child.parent.type === 'atrule' && /keyframes$/.test(child.parent.name)) return;
      child.selectors = child.selectors.filter((selector) => !isReplaced(selector));
      if (!child.selectors.length) child.remove();
    } else if (child.type === 'atrule' && child.nodes && !/keyframes$/.test(child.name)) {
      prune(child);
      if (!child.nodes.length) child.remove();
    }
  });
}
const holder = postcss.root();
for (const node of legacy) holder.append(node.clone());
prune(holder);
holder.walkRules((rule) => {
  if (rule.selector === '.cn') rule.walkDecls(/^--cn-/, (decl) => decl.remove());
});
holder.walkDecls((decl) => {
  const convert = kindOf(decl.prop);
  const before = decl.value;
  decl.value = decl.value
    .replace(HEX, (hex) => { converted += 1; return convert(parse(hex)); })
    .replace(RGB, (_all, r, g, b, a) => { converted += 1; return convert({ r: +r, g: +g, b: +b, a: a === undefined ? 1 : +a }); });
  if (/(^|[^\w-])#[0-9a-f]{3,8}\b/i.test(decl.value)) throw new Error(`unconverted colour in ${decl.prop}: ${before}`);
});

const kept = [];
let afterTokens = false;
for (const node of root.nodes) {
  if (!afterTokens) kept.push(node.toString().trim() === '' ? '' : node.toString());
  if (node.type === 'comment' && /cn-tokens:end/.test(node.text)) afterTokens = true;
}
const header = root.nodes.slice(0, root.nodes.findIndex((n) => n.type === 'comment' && /cn-tokens:end/.test(n.text)) + 1).map((n) => n.toString()).join('\n');
writeFileSync(file, `${header}\n${holder.toString().trim()}\n`);
console.log(`converted ${converted} colour literals; kept ${holder.nodes.length} top-level legacy nodes`);
