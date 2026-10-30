window.__ModuleLoader__.load({
  id: 'dsh-shopify-admin',
  factory(require) {
    const React = require('react');
    const { useEffect, useRef, useState } = React;
    const h = React.createElement;
    const API = '/shopify-admin-binding';
    const TAB_ID = 'dsh-shopify-admin/erp';
    const TAB_KIND = 'shopify-admin-erp';
    const styles = {
      panel: { padding: '28px 24px', maxWidth: '760px', fontFamily: 'system-ui, sans-serif', color: 'var(--dsw-alias-label-primary, #202521)', lineHeight: 1.6 },
      intro: { color: 'var(--dsw-alias-label-secondary, #66716a)', fontSize: '14px' },
      card: { marginTop: '24px', padding: '22px', border: '1px solid var(--dsw-alias-border-l1, #dce3dc)', borderRadius: '14px' },
      input: { boxSizing: 'border-box', width: '100%', padding: '10px 12px', margin: '8px 0 12px', border: '1px solid #b9c5bc', borderRadius: '8px', fontSize: '14px', background: 'transparent', color: 'inherit' },
      action: { display: 'inline-block', padding: '9px 15px', border: '0', borderRadius: '8px', color: '#fff', background: '#315e48', fontWeight: 600, textDecoration: 'none', cursor: 'pointer' },
      secondary: { marginLeft: '10px', padding: '8px 14px', border: '1px solid #b9c5bc', borderRadius: '8px', color: 'inherit', background: 'transparent', cursor: 'pointer' },
      error: { color: '#a33232', overflowWrap: 'anywhere' },
    };

    async function request(path, options = {}) {
      const response = await fetch(API + path, { ...options, credentials: 'same-origin' });
      let value;
      try { value = await response.json(); } catch { throw new Error('暂时无法读取商店状态，请重试。'); }
      if (!response.ok || !value.ok) throw new Error(value.error?.message || '暂时无法读取商店状态，请重试。');
      return value.data;
    }
    function adminLink(shop) {
      return typeof shop === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(shop)
        ? `https://${shop}/admin` : null;
    }

    function Panel({ sessionId }) {
      const [state, setState] = useState({ phase: 'loading' });
      const [shop, setShop] = useState('');
      const [authorization, setAuthorization] = useState(null);
      const [products, setProducts] = useState(null);
      const [message, setMessage] = useState('');
      const [busy, setBusy] = useState(false);
      const [revision, refresh] = useState(0);
      const scope = useRef(null);

      useEffect(() => {
        const controller = new AbortController();
        scope.current = controller;
        setAuthorization(null); setProducts(null); setMessage(''); setBusy(false);
        if (!sessionId) { setState({ phase: 'no-session' }); return () => controller.abort(); }
        setState({ phase: 'loading' });
        request(`/status?${new URLSearchParams({ sessionId })}`, { signal: controller.signal })
          .then(value => { if (!controller.signal.aborted) { setState({ phase: 'ready', value }); setShop(value.suggestedShop || ''); } })
          .catch(error => { if (!controller.signal.aborted) setState({ phase: 'error', message: error.message }); });
        return () => controller.abort();
      }, [sessionId, revision]);

      async function connect(event) {
        event.preventDefault();
        const controller = scope.current;
        if (!controller || controller.signal.aborted) return;
        const normalized = shop.trim().toLowerCase();
        if (!adminLink(normalized)) { setMessage('请输入完整的 xxx.myshopify.com 店铺域名。'); return; }
        setBusy(true); setMessage(''); setAuthorization(null);
        try {
          const result = await request('/authorize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, shop: normalized }), signal: controller.signal });
          if (controller.signal.aborted) return;
          const url = new URL(result.authorizeUrl);
          if (url.protocol !== 'https:' || url.hostname !== normalized || url.port || url.username || url.password || url.pathname !== '/admin/oauth/authorize') throw new Error('商店授权地址无效，请重试。');
          setAuthorization(url.href);
        } catch (error) { if (!controller.signal.aborted) setMessage(error.message); }
        finally { if (!controller.signal.aborted) setBusy(false); }
      }

      async function readProducts() {
        const controller = scope.current;
        if (!controller || controller.signal.aborted) return;
        setBusy(true); setMessage('');
        try {
          const result = await request(`/read?${new URLSearchParams({ sessionId, resource: 'products' })}`, { signal: controller.signal });
          if (!controller.signal.aborted) setProducts(result.products);
        } catch (error) { if (!controller.signal.aborted) setMessage(error.message); }
        finally { if (!controller.signal.aborted) setBusy(false); }
      }

      const status = state.value?.status;
      const link = adminLink(state.value?.shop);
      const suggestedLink = adminLink(state.value?.suggestedShop);
      return h('main', { style: styles.panel },
        h('p', { style: { ...styles.intro, letterSpacing: '0.12em', fontSize: '11px', fontWeight: 700 } }, 'SHOPIFY ADMIN'),
        h('h2', { style: { margin: '4px 0 8px', fontSize: '24px' } }, '经营后台'),
        h('p', { style: styles.intro }, '在 Shopify Admin 管理商品、客户、订单和库存，工作区可读取已授权的商店信息。'),
        h('section', { style: styles.card, 'aria-live': 'polite' },
          state.phase === 'loading' && h('p', null, '正在读取商店状态…'),
          state.phase === 'no-session' && h('p', null, '请先打开一个工作区会话。'),
          state.phase === 'error' && h(React.Fragment, null, h('p', { style: styles.error }, state.message), h('button', { type: 'button', style: styles.action, onClick: () => refresh(x => x + 1) }, '重试')),
          state.phase === 'ready' && status === 'setup_required' && h(React.Fragment, null,
            h('h3', null, '准备连接商店'),
            h('p', { style: styles.intro }, '请先由管理员完成 Shopify 应用和商店连接设置。完成后重新读取状态。'),
            state.value.workspaceId && h('p', { style: { ...styles.intro, overflowWrap: 'anywhere' } }, '当前工作区：', state.value.workspaceId),
            h('button', { type: 'button', style: styles.action, onClick: () => refresh(x => x + 1) }, '重新读取'),
            h('a', { href: suggestedLink || 'https://admin.shopify.com/', target: '_blank', rel: 'noopener noreferrer', style: styles.secondary }, '打开 Shopify Admin')),
          state.phase === 'ready' && status !== 'setup_required' && status !== 'connected' && h(React.Fragment, null,
            h('h3', null, status === 'unbound' ? '连接 Shopify 商店' : '重新连接 Shopify 商店'),
            h('p', { style: styles.intro }, '输入商店域名，接着由商店所有者在 Shopify 完成授权。'),
            h('form', { onSubmit: connect },
              h('label', { htmlFor: 'shopify-domain' }, '商店域名'),
              h('input', { id: 'shopify-domain', style: styles.input, value: shop, onChange: e => setShop(e.target.value), placeholder: 'your-store.myshopify.com', autoComplete: 'off', required: true }),
              h('button', { type: 'submit', style: styles.action, disabled: busy }, busy ? '正在准备…' : '准备授权')),
            authorization && h('p', null, h('a', { href: authorization, target: '_blank', rel: 'noopener noreferrer', style: styles.action }, '前往 Shopify 授权')),
            authorization && h('button', { type: 'button', style: styles.secondary, onClick: () => refresh(x => x + 1) }, '授权完成后刷新')),
          state.phase === 'ready' && status === 'connected' && h(React.Fragment, null,
            h('h3', null, state.value.shopName || '已连接的商店'),
            h('p', { style: styles.intro }, state.value.shop),
            link && h('a', { href: link, target: '_blank', rel: 'noopener noreferrer', style: styles.action }, '打开 Shopify Admin'),
            h('button', { type: 'button', style: styles.secondary, onClick: readProducts, disabled: busy }, busy ? '正在读取…' : '查看商品'),
            Array.isArray(products) && h('div', { style: { marginTop: '20px' } },
              h('h4', null, '商品概览'),
              products.length === 0 ? h('p', { style: styles.intro }, '商店没有返回商品。') : h('ul', null, products.map(item => h('li', { key: item.id }, item.title))),
              h('p', { style: styles.intro }, '这里只显示最多 10 个商品；完整记录请在 Shopify Admin 查看。'))),
          message && h('p', { role: 'alert', style: styles.error }, message)));
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register('shopifyAdmin', { zh: { title: 'Shopify 经营后台' }, en: { title: 'Shopify Admin' } }), 'shopify-admin: locale');
      const t = ctx.locale.bind('shopifyAdmin');
      ctx.effect(() => ctx.sidebarRightTabs.register({ id: TAB_ID, kind: TAB_KIND, title: () => t('title'), guide: [{ id: 'shopify', order: 45, title: () => t('title'), description: () => '连接商店并打开 Shopify Admin。' }] }), 'shopify-admin: tab');
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID, locale: 'shopifyAdmin' }, Panel)), 'shopify-admin: panel');
    }

    return { apply, inject: ['slots', 'locale', 'sidebarRightTabs'] };
  },
});
