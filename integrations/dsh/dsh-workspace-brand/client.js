window.__ModuleLoader__.load({
  id: 'dsh-workspace-brand',
  factory(require) {
    const { createElement: h } = require('react');
    const id = 'dsh-workspace-brand';
    // Change the identity here; the native host retains all navigation and conversation copy.
    const brand = { name: 'Workspace', description: '企业智能工作空间 · 基于 DeepSeek Harness' };
    const tokens = {
      '--dsw-alias-bg-base': { light: '#fcfcfc', dark: '#141414' },
      '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#1c1c1c' },
      '--dsw-alias-bg-layer-2': { light: '#ffffff', dark: '#242424' },
      '--dsw-alias-bg-layer-3': { light: '#f3f3f3', dark: '#2b2b2b' },
      '--dsw-alias-label-primary': { light: '#171717', dark: '#ededed' },
      '--dsw-alias-label-secondary': { light: '#737373', dark: '#a3a3a3' },
      '--dsw-alias-label-tertiary': { light: '#8a8a8a', dark: '#8f8f8f' },
      '--dsw-alias-brand-primary': { light: '#171717', dark: '#ededed' },
      '--dsw-alias-brand-text': { light: '#171717', dark: '#ededed' },
      '--dsw-alias-button-primary-fill': { light: '#171717', dark: '#ededed' },
      '--dsw-alias-button-primary-hover': { light: '#333333', dark: '#d4d4d4' },
      // Native Send uses a static white glyph in both palettes.
      '--dsw-alias-button-info-fill': { light: '#171717', dark: '#525252' },
      '--dsw-alias-button-info-hover': { light: '#333333', dark: '#666666' },
      '--dsw-alias-border-l1': { light: 'rgba(0,0,0,0.06)', dark: 'rgba(255,255,255,0.08)' },
      '--dsw-alias-border-l2': { light: 'rgba(0,0,0,0.10)', dark: 'rgba(255,255,255,0.13)' },
      '--dsw-specific-sidebar-fill': { light: '#f5f5f5', dark: '#191919' },
      '--dsw-specific-sidebar-nav-item-active': { light: '#e9e9e9', dark: '#303030' },
      '--dsw-specific-sidebar-nav-item-active-accent': { light: '#e9e9e9', dark: '#303030' },
      '--dsw-specific-sidebar-nav-item-hover': { light: '#eeeeee', dark: '#252525' },
      '--dsw-specific-input-major': { light: '#ffffff', dark: '#242424' },
    };

    function Mark({ size = 24, className } = {}) {
      return h('svg', { width: size, height: size, viewBox: '0 0 32 32', fill: 'none', className,
        'aria-hidden': true, 'data-workspace-brand-mark': '' },
      h('rect', { x: 1, y: 1, width: 30, height: 30, rx: 9, fill: 'var(--dsw-alias-label-primary)' }),
      h('path', { d: 'm7 9 4.5 14L16 14l4.5 9L25 9', stroke: 'var(--dsw-alias-bg-base)', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round' }));
    }

    function Name() {
      return h('span', { 'data-workspace-brand-name': '', title: brand.description,
        style: { display: 'inline-flex', alignItems: 'baseline', gap: 6, color: 'var(--dsw-alias-label-primary)', fontFamily: 'inherit', fontSize: 16, fontWeight: 600, letterSpacing: '-.45px' } },
      brand.name, h('small', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 9, fontWeight: 400, letterSpacing: '.5px' } }, 'DSH'));
    }

    function apply(ctx) {
      ctx.effect(() => ctx.theme.overrideTokens(id, tokens), 'workspace-brand: native light/dark palette');
      for (const [name, Component] of [
        ['sidebar.brand.mark', Mark],
        ['sidebar.brand.name', Name],
        ['conversation.hero.brand.mark', Mark],
      ]) {
        // Lower priority shadows the official brand entries without removing them.
        ctx.effect(() => ctx.slots.inject(name, () => ctx.slots.register({ name, priority: -50 }, Component)), `workspace-brand: ${name}`);
      }
    }
    return { apply, inject: ['theme', 'slots'], brand, tokens };
  },
});
