// Limited source-driven Chromium rendering; never official WeChat engine evidence.
export async function installSourceRenderer(ui, { wxml, css, spirit, componentWxml = '', componentSources = {} }) {
await ui.evaluate(({ wxml, css, spirit, componentWxml, componentSources }) => {
  const definitions = { 'muse-draft-review': { wxml: componentWxml, stateField: '_draftReview', prefix: 'component.' }, ...componentSources };
  const normalized = wxml.replace(/\b(scroll-y|selectable|auto-height|wx:else)(?=[\s>])/g, '$1=""');
  const source = new DOMParser().parseFromString('<root xmlns:wx="urn:wx" xmlns:bind="urn:bind">' + normalized + '</root>', 'application/xml');
  if (source.querySelector('parsererror')) throw Error(source.querySelector('parsererror').textContent);
  const style = document.createElement('style'); document.head.append(style);
  const evaluate = (expression, scope) => new Function('scope', 'with(scope) { return (' + expression + '); }')(scope);
  const value = (text, scope) => { const full = text.match(/^{{([\s\S]+)}}$/); return full && !full[1].includes('}}') ? evaluate(full[1], scope) : text.replace(/{{([\s\S]+?)}}/g, (_, expression) => String(evaluate(expression, scope) ?? '')); };
  function children(nodes, scope, parent, prefix = '') {
    let previousIf = null;
    for (const node of nodes) {
      if (node.nodeType === 3) { parent.append(document.createTextNode(String(value(node.textContent, scope)))); continue; }
      if (node.nodeType !== 1) continue;
      if (node.hasAttribute('wx:if')) { previousIf = Boolean(value(node.getAttribute('wx:if'), scope)); if (!previousIf) continue; }
      else if (node.hasAttribute('wx:else')) { if (previousIf !== false) continue; previousIf = null; }
      else previousIf = null;
      if (node.hasAttribute('wx:for')) {
        const list = value(node.getAttribute('wx:for'), scope);
        if (!Array.isArray(list)) throw Error('Simulator expects actual array in wx:for');
        list.forEach((item, index) => element(node, { ...scope, [node.getAttribute('wx:for-item') || 'item']: item, [node.getAttribute('wx:for-index') || 'index']: index }, parent, prefix));
      } else element(node, scope, parent, prefix);
    }
  }
  function element(node, scope, parent, prefix = '') {
    if (definitions[node.tagName]) {
      const definition=definitions[node.tagName], state=definition.instanceAttribute ? scope[definition.stateField]?.[value(node.getAttribute(definition.instanceAttribute),scope)] : scope[definition.stateField];
      if (definition.wxml && state) {
        const child = new DOMParser().parseFromString('<root xmlns:wx="urn:wx" xmlns:bind="urn:bind">' + definition.wxml.replace(/\b(scroll-y|selectable|auto-height|wx:else)(?=[\s>])/g, '$1=""') + '</root>', 'application/xml');
        if (child.querySelector('parsererror')) throw Error(child.querySelector('parsererror').textContent);
        children([...child.documentElement.childNodes], state, parent, definition.prefix || '');
      }
      return;
    }
    const tag = ({ view: 'div', 'scroll-view': 'div', text: 'span', image: 'img', 'checkbox-group': 'div', checkbox: 'input' })[node.tagName] || node.tagName;
    const target = document.createElement(tag); let handler, inputHandler, changeHandler;
    if (node.tagName === 'checkbox') target.type = 'checkbox';
    for (const attribute of node.attributes) {
      if (attribute.name.startsWith('wx:') || ['scroll-y', 'auto-height', 'selectable', 'mode'].includes(attribute.name)) continue;
      if (attribute.name === 'bindtap') { handler = attribute.value; continue; }
      if (attribute.name === 'bindinput') { inputHandler = attribute.value; continue; }
      if (attribute.name === 'bindchange') { changeHandler = attribute.value; continue; }
      const rendered = value(attribute.value, scope);
      if (attribute.name === 'disabled') { target.disabled = Boolean(rendered); continue; }
      if (attribute.name === 'checked') { target.checked = Boolean(rendered); continue; }
      if (attribute.name === 'loading') continue;
      if (attribute.name === 'value') { target.value = String(rendered ?? ''); continue; }
      target.setAttribute(attribute.name, String(rendered ?? ''));
    }
    if (node.tagName === 'text') target.classList.add('wx-text');
    if (node.tagName === 'image' && target.getAttribute('src') === '/assets/spirit.png') target.src = spirit;
    if (node.tagName === 'scroll-view') target.style.overflowY = 'auto';
    if (handler) target.onclick = async () => { await window.pageEvent(prefix + handler, { ...target.dataset }); };
    if (inputHandler) target.oninput = () => { void window.pageEvent(prefix + inputHandler, {}, target.value); };
    if (changeHandler) target.onchange = () => { void window.pageEvent(prefix + changeHandler, {}, [...target.querySelectorAll('input[type=checkbox]:checked')].map(input => input.value)); };
    children([...node.childNodes], scope, target, prefix); parent.append(target);
  }
  window.renderSource = state => {
    const scroll = document.querySelector('.transcript')?.scrollTop || 0;
    const height = document.querySelector('.transcript')?.scrollHeight || 0;
    const nativeCss = css.replace(/(-?[\d.]+)rpx/g, (_, number) => `${Number(number) * innerWidth / 750}px`).replace(/\bpage(?=\s*{)/g, 'body').replace(/\btext(?=[\s,{.#>:+])/g, '.wx-text').replace(/\bcheckbox(?=[\s,{])/g, 'input[type=checkbox]');
    style.textContent = nativeCss + 'body{margin:0}header{height:28px;box-sizing:border-box;text-align:center;padding:6px 2px;background:#e9e5d9;color:#6b675b;font-size:11px}.conversation{height:calc(100vh - 28px)}.wx-text{display:inline}textarea{font:inherit;border:0;resize:none;min-height:65px}button{border:0;cursor:pointer}button:disabled{opacity:.5;cursor:default}.transcript{overflow-y:auto}.sheet-heading{gap:10px}.card-title{display:block}';
    const root = document.querySelector('main'); root.replaceChildren(); children([...source.documentElement.childNodes], state, root);
    const transcript = document.querySelector('.transcript'); if (transcript) transcript.scrollTop = Math.abs(scroll - height) < 50 ? transcript.scrollHeight : scroll;
  };
}, { wxml, css, spirit, componentWxml, componentSources });
}
