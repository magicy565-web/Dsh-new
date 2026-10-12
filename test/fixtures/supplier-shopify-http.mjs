// Shared local Shopify HTTP fixture. Never contacts a real store.
import assert from 'node:assert/strict';
import http from 'node:http';

export async function fakeShopify(t) {
  const products = new Map(), calls = [], state = { drops: new Set(), mediaReady: true, scopes: ['read_products', 'write_products', 'write_publications', 'read_orders'], uploads: 0, orders: [] };
  const shop = { id: 'gid://shopify/Shop/77', name: 'Local supplier test shop', myshopifyDomain: 'supplier-fixture.myshopify.com', currencyCode: 'USD' };
  const server = http.createServer(async (req, res) => {
    const buffers = []; for await (const part of req) buffers.push(part);
    if (req.url === '/staged') { state.uploads++; res.writeHead(201); res.end(); return; }
    const { query, variables } = JSON.parse(Buffer.concat(buffers).toString());
    const name = query.match(/(?:query|mutation)\s+(\w+)/)?.[1]; calls.push({ name, variables: structuredClone(variables) });
    let data;
    if (query.includes('currentAppInstallation')) data = { shop, currentAppInstallation: { accessScopes: state.scopes.map(handle => ({ handle })) } };
    else if (name === 'SupplierStageReviewedImage') data = { stagedUploadsCreate: { stagedTargets: [{ url: 'https://shopify-staged-uploads.storage.googleapis.com/fixture', resourceUrl: 'https://shopify-staged-uploads.storage.googleapis.com/fixture/image.png', parameters: [{ name: 'policy', value: 'LOCAL-EPHEMERAL-UPLOAD-AUTH-NEVER-PERSIST' }] }], userErrors: [] } };
    else if (name === 'SupplierCreateDraft') {
      const id = `gid://shopify/Product/${100 + products.size}`, variantId = `gid://shopify/ProductVariant/${1000 + products.size}`;
      const product = { id, handle: variables.product.handle, title: variables.product.title, descriptionHtml: variables.product.descriptionHtml, status: variables.product.status, publishedAt: null, onlineStoreUrl: null, publishedOnPublication: false,
        intent: { value: variables.product.metafields[0].value }, release: null,
        variants: { nodes: [{ id: variantId, sku: '', price: '0.00' }], pageInfo: { hasNextPage: false } },
        media: { nodes: variables.media.map((image, index) => ({ id: `gid://shopify/MediaImage/${1000 + index}`, alt: image.alt, image: state.mediaReady ? { url: `https://cdn.shopify.com/fixture/media-${1000 + index}.png` } : null, mediaContentType: 'IMAGE', status: state.mediaReady ? 'READY' : 'PROCESSING' })), pageInfo: { hasNextPage: false } } };
      products.set(product.handle, product); data = { productCreate: { product, userErrors: [] } };
    } else if (name === 'SupplierSetRetailVariant') {
      const product = [...products.values()].find(item => item.id === variables.productId), input = variables.variants[0];
      Object.assign(product.variants.nodes[0], { price: input.price, sku: input.inventoryItem?.sku || '' }); data = { productVariantsBulkUpdate: { productVariants: product.variants.nodes, userErrors: [] } };
    } else if (name === 'SupplierActivateReviewedDraft') {
      const product = [...products.values()].find(item => item.id === variables.product.id); product.status = 'ACTIVE'; product.release = { value: variables.product.metafields[0].value }; data = { productUpdate: { product, userErrors: [] } };
    } else if (name === 'SupplierPublishReviewedProduct') {
      const product = [...products.values()].find(item => item.id === variables.id); product.publishedOnPublication = true; product.publishedAt = '2026-10-12T12:00:00.000Z'; product.onlineStoreUrl = `https://${shop.myshopifyDomain}/products/${product.handle}`; data = { publishablePublish: { publishable: { availablePublicationsCount: { count: 1 } }, userErrors: [] } };
    } else if (['SupplierDraftReceipt', 'SupplierPublicationReceipt'].includes(name)) data = { product: products.get(variables.identifier.handle) || null };
    else if (name === 'WorkspaceSupplierProduct') data = { product: [...products.values()].find(item => item.id === variables.id) || null };
    else if (name === 'WorkspaceSupplierOrders') data = { orders: { nodes: structuredClone(state.orders), pageInfo: { hasNextPage: false, endCursor: null } } };
    else { res.writeHead(400); res.end(JSON.stringify({ error: 'Unknown local fixture query' })); return; }
    await state.afterResponsePrepared?.({ name, variables, data, products });
    if (state.drops.delete(name)) { res.destroy(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Shopify-API-Version': '2026-10' }); res.end(JSON.stringify({ data }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const fetchImpl = (url, init) => { const parsed = new URL(url); assert.equal(parsed.protocol, 'https:'); assert.ok([shop.myshopifyDomain, 'shopify-staged-uploads.storage.googleapis.com'].includes(parsed.hostname)); return fetch(base + (parsed.hostname === shop.myshopifyDomain ? '/graphql' : '/staged'), init); };
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { state, products, calls, fetchImpl, count: name => calls.filter(item => item.name === name).length };
}
