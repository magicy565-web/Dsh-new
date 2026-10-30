import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KINDS } from '../src/model.mjs';
import { kindFamily, KIND_FAMILY } from '../src/canvas/kinds.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../src/styles.css');
const canvasCss = read('../src/canvas.css');

function declarations(block) {
  const match = css.match(new RegExp(`/\\* cn-tokens:${block} \\*/\\s*\\.cn(?:\\[data-theme=dark\\])?\\{([^}]*)\\}`));
  assert.ok(match, `token block "${block}" is missing from styles.css`);
  return new Map(match[1].split(';').map((entry) => entry.trim()).filter((entry) => entry.startsWith('--'))
    .map((entry) => [entry.slice(0, entry.indexOf(':')), entry.slice(entry.indexOf(':') + 1)]));
}
const light = declarations('light');
const dark = declarations('dark');
const themed = /^--cn-(canvas|grid(?!-size)|surface|ink|muted|line|accent|focus(?!-)|tone-|kind-|shadow-)/;

const channel = (hex) => { const value = parseInt(hex.slice(1), 16); return [value >> 16, (value >> 8) & 255, value & 255]; };
const luminance = (hex) => {
  const [r, g, b] = channel(hex).map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const tint = (fg, bg, share) => '#' + channel(fg).map((c, i) => Math.round(c * share + channel(bg)[i] * (1 - share)).toString(16).padStart(2, '0')).join('');

test('the dark block overrides every colour and shadow token and is opt-in', () => {
  for (const name of light.keys()) if (themed.test(name)) assert.ok(dark.has(name), `${name} has no dark value`);
  for (const name of dark.keys()) if (name !== 'color-scheme') assert.ok(light.has(name), `${name} exists only in dark`);
  assert.match(css, /\.cn\[data-theme=dark\]\{/);
});

for (const [mode, tokens] of [['light', light], ['dark', dark]]) {
  test(`${mode} text, badge and kind colours meet WCAG contrast`, () => {
    const value = (name) => (tokens.get(name) ?? light.get(name));
    for (const ground of ['--cn-canvas', '--cn-surface', '--cn-surface-sunken']) {
      assert.ok(contrast(value('--cn-ink'), value(ground)) >= 4.5, `ink on ${ground}`);
      assert.ok(contrast(value('--cn-muted'), value(ground)) >= 4.5, `muted on ${ground}`);
    }
    assert.ok(contrast(value('--cn-accent-ink'), value('--cn-accent')) >= 4.5, 'accent-ink on accent');
    for (const ground of ['--cn-canvas', '--cn-surface']) assert.ok(contrast(value('--cn-accent'), value(ground)) >= 3, `accent on ${ground}`);
    for (const tone of ['green', 'blue', 'amber', 'red', 'muted']) {
      assert.ok(contrast(value(`--cn-tone-${tone}`), value(`--cn-tone-${tone}-bg`)) >= 4.5, `tone ${tone}`);
    }
    for (const name of [...light.keys()].filter((key) => key.startsWith('--cn-kind-'))) {
      assert.ok(contrast(value(name), tint(value(name), value('--cn-surface'), 0.1)) >= 3, `${name} icon on its tint`);
    }
  });
}

test('every node kind resolves to a defined kind colour family', () => {
  for (const kind of Object.keys(KINDS)) {
    assert.ok(Object.hasOwn(KIND_FAMILY, kind), `kind ${kind} is not in the catalogue`);
    assert.ok(light.has(`--cn-kind-${kindFamily(kind)}`), `--cn-kind-${kindFamily(kind)} is not defined`);
  }
});

test('no colour literal exists outside the token blocks, so the dark theme is complete', () => {
  const tokenBlocks = /\/\* cn-tokens:light \*\/[\s\S]*?\/\* cn-tokens:end \*\//;
  const withoutTokens = css.replace(tokenBlocks, '');
  for (const [name, source] of [['styles.css', withoutTokens], ['canvas.css', canvasCss]]) {
    const literals = source.replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    assert.deepEqual(literals, [], `${name} contains colour literals that ignore the theme`);
    assert.ok(!/\brgba?\(/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')), `${name} contains rgb() literals that ignore the theme`);
  }
});
