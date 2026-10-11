import { createHash } from 'node:crypto';
import { ApiError } from './runtime.mjs';

// A host-pinned, read-only Admin API integration. Credentials never enter the
// browser, goal context, store, or remote Worker task payload.
export const SHOPIFY_API_VERSION = '2026-10';
const fail = (status, code, message) => { throw new ApiError(status, code, message); };
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const SHOP = /^[a-z0-9][a-z0-9-]{0,61}\.myshopify\.com$/u;
const INFO_QUERY = `query WorkspaceShop {
  shop { id name myshopifyDomain currencyCode }
  currentAppInstallation { accessScopes { handle } }
}`;
const CATALOG_QUERY = `query WorkspaceCatalog($after: String) {
  products(first: 20, after: $after, sortKey: UPDATED_AT, reverse: true) {
    nodes { id title handle vendor status updatedAt
      variants(first: 10) { nodes { id sku price inventoryQuantity } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;
const ORDERS_QUERY = `query WorkspaceOrders($query: String!, $after: String) {
  orders(first: 50, after: $after, query: $query, sortKey: CREATED_AT) {
    nodes { id name createdAt updatedAt tags test cancelledAt displayFinancialStatus
      displayFulfillmentStatus
      totalReceivedSet { shopMoney { amount currencyCode } }
      totalRefundedSet { shopMoney { amount currencyCode } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

async function boundedJson(response) {
  if (Number(response.headers.get('content-length')) > 1_000_000 || !response.body)
    fail(502, 'SHOPIFY_RESPONSE_INVALID', 'Shopify 返回的数据大小或格式不受支持。');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_000_000) fail(502, 'SHOPIFY_RESPONSE_INVALID', 'Shopify 返回的数据超过读取上限。');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    fail(502, 'SHOPIFY_RESPONSE_INVALID', '无法读取 Shopify 返回的数据。');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function createShopifyClient({ environment = process.env, fetchImpl = fetch, clock = Date.now } = {}) {
  const domain = environment.WORKSPACE_SHOPIFY_SHOP_DOMAIN || '';
  const token = environment.WORKSPACE_SHOPIFY_ADMIN_TOKEN || '';
  const validDomain = SHOP.test(domain), configured = validDomain && typeof token === 'string' && !!token.trim();
  const fingerprint = createHash('sha256').update(JSON.stringify([domain, SHOPIFY_API_VERSION])).digest('hex');
  let observation = null, lastError = null;
  const at = () => new Date(clock()).toISOString();
  const status = () => ({
    configured, domain: validDomain ? domain : null, apiVersion: SHOPIFY_API_VERSION,
    status: !configured ? 'setup_required' : observation ? 'verified' : 'configured_unverified',
    verifiedAt: observation?.verifiedAt || null, shop: observation?.shop || null,
    scopes: observation?.scopes || [], lastError, readOnly: true,
    orderReadAvailable: !!observation?.scopes.some(scope => ['read_orders', 'write_orders'].includes(scope)),
    requirements: [!validDomain && '配置店铺的 myshopify.com 域名', !token && '在服务器配置 Admin API 授权凭证'].filter(Boolean),
  });
  async function graphql(query, variables) {
    if (!configured) fail(409, 'SHOPIFY_SETUP_REQUIRED', '请先在服务器配置经过授权的 Shopify 店铺。');
    try {
      const response = await fetchImpl(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
        body: JSON.stringify({ query, variables }),
      });
      if (!response.ok) {
        if ([401, 403].includes(response.status)) { observation = null; fail(409, 'SHOPIFY_AUTH_REJECTED', 'Shopify 授权已失效或缺少权限，请重新授权。'); }
        fail(502, response.status === 429 ? 'SHOPIFY_RATE_LIMITED' : 'SHOPIFY_REQUEST_FAILED', 'Shopify 暂时无法完成读取，请稍后重试。');
      }
      const returnedVersion = response.headers.get('x-shopify-api-version');
      if (returnedVersion && returnedVersion !== SHOPIFY_API_VERSION)
        fail(502, 'SHOPIFY_API_VERSION_MISMATCH', 'Shopify API 版本与当前集成不一致，请先升级集成。');
      const result = await boundedJson(response);
      if (result.errors?.length || !result.data || typeof result.data !== 'object')
        fail(502, 'SHOPIFY_QUERY_REJECTED', 'Shopify 未接受当前读取请求，请核对应用权限。');
      lastError = null;
      return result.data;
    } catch (error) {
      const safe = error instanceof ApiError ? error : new ApiError(502, 'SHOPIFY_UNREACHABLE', '无法连接 Shopify，请检查店铺配置和网络后重试。');
      lastError = { code: safe.code, message: safe.message, observedAt: at() };
      throw safe;
    }
  }
  return {
    status, fingerprint,
    async verify() {
      // A failed re-verification cannot keep an earlier observation green.
      observation = null;
      const data = await graphql(INFO_QUERY, {});
      const shop = data.shop, scopes = data.currentAppInstallation?.accessScopes;
      if (shop?.myshopifyDomain !== domain || !/^gid:\/\/shopify\/Shop\/\d+$/u.test(shop?.id) || typeof shop?.name !== 'string' || !/^[A-Z]{3}$/u.test(shop?.currencyCode) || !Array.isArray(scopes) || scopes.length > 200 || scopes.some(scope => typeof scope.handle !== 'string' || !/^[a-z_]{1,100}$/u.test(scope.handle)))
        fail(502, 'SHOPIFY_IDENTITY_MISMATCH', '返回的店铺身份或授权范围不匹配。');
      observation = { verifiedAt: at(), shop: { id: shop.id, name: shop.name, domain, currency: shop.currencyCode }, scopes: [...new Set(scopes.map(scope => scope.handle))] };
      return status();
    },
    async readCatalogPage({ after = null } = {}) {
      if (after !== null && (typeof after !== 'string' || after.length > 2000)) fail(400, 'INVALID_INPUT', 'Invalid product cursor.');
      if (!observation || !observation.scopes.some(scope => ['read_products', 'write_products'].includes(scope)))
        fail(409, 'SHOPIFY_PRODUCT_SCOPE_REQUIRED', 'Verify the store identity and read_products scope first.');
      const data = await graphql(CATALOG_QUERY, { after });
      const collection = data.products;
      if (!Array.isArray(collection?.nodes) || collection.nodes.length > 20 || typeof collection.pageInfo?.hasNextPage !== 'boolean')
        fail(502, 'SHOPIFY_CATALOG_INVALID', 'Shopify product page has invalid pagination.');
      const products = collection.nodes.map(product => {
        if (!/^gid:\/\/shopify\/Product\/\d+$/u.test(product?.id) || typeof product.title !== 'string' || product.title.length > 500 || typeof product.handle !== 'string' || typeof product.vendor !== 'string' || !Number.isFinite(Date.parse(product.updatedAt)) || !Array.isArray(product.variants?.nodes) || product.variants.nodes.length > 10)
          fail(502, 'SHOPIFY_CATALOG_INVALID', 'Shopify product record is invalid.');
        const variants = product.variants.nodes.map(variant => {
          if (!/^gid:\/\/shopify\/ProductVariant\/\d+$/u.test(variant?.id) || typeof variant.sku !== 'string' || variant.sku.length > 200 || typeof variant.price !== 'string' || !/^(?:0|[1-9]\d{0,10})(?:\.\d{1,6})?$/u.test(variant.price) || !Number.isSafeInteger(variant.inventoryQuantity))
            fail(502, 'SHOPIFY_CATALOG_INVALID', 'Shopify variant record is invalid.');
          return { id: variant.id, sku: variant.sku, price: variant.price, inventoryQuantity: variant.inventoryQuantity };
        });
        return { id: product.id, title: product.title, handle: product.handle, vendorLabel: product.vendor,
          status: product.status, updatedAt: product.updatedAt, variants };
      });
      const cursor = collection.pageInfo.hasNextPage ? collection.pageInfo.endCursor : null;
      if (cursor !== null && (typeof cursor !== 'string' || cursor === after || !cursor.length || cursor.length > 2000))
        fail(502, 'SHOPIFY_CATALOG_INVALID', 'Shopify product cursor is invalid.');
      return { shopId: observation.shop.id, observedAt: at(), products, nextCursor: cursor };
    },
    async readProjectOrders({ projectId, after = null, createdAt }) {
      if (!ID.test(projectId) || after !== null && (typeof after !== 'string' || after.length > 2000) || !Number.isFinite(Date.parse(createdAt)))
        fail(400, 'INVALID_INPUT', '订单读取范围无效。');
      if (!observation || !status().orderReadAvailable) fail(409, 'SHOPIFY_ORDER_SCOPE_REQUIRED', '请先验证店铺，并确认已授权读取订单。');
      if (clock() - Date.parse(createdAt) >= 60 * 86_400_000 && !observation.scopes.includes('read_all_orders'))
        fail(409, 'SHOPIFY_ORDER_HISTORY_SCOPE_REQUIRED', '本次任务已超过普通订单读取窗口，需要授权历史订单读取后再核验完整结果。');
      const data = await graphql(ORDERS_QUERY, { query: `tag:workspace-project-${projectId} created_at:>='${new Date(createdAt).toISOString()}'`, after });
      const result = data.orders;
      if (!Array.isArray(result?.nodes) || result.nodes.length > 50 || typeof result.pageInfo?.hasNextPage !== 'boolean' || (result.pageInfo.hasNextPage && (typeof result.pageInfo.endCursor !== 'string' || !result.pageInfo.endCursor || result.pageInfo.endCursor === after || result.pageInfo.endCursor.length > 2000)))
        fail(502, 'SHOPIFY_RESPONSE_INVALID', 'Shopify 订单分页结果无效。');
      if (result.nodes.some(order => !Array.isArray(order.tags) || !order.tags.includes(`workspace-project-${projectId}`) || !Number.isFinite(Date.parse(order.createdAt)) || Date.parse(order.createdAt) < Date.parse(createdAt)))
        fail(502, 'SHOPIFY_ORDER_SCOPE_MISMATCH', '返回的订单不属于本次托管任务范围，未记录这批结果。');
      return { orders: result.nodes, nextCursor: result.pageInfo.hasNextPage ? result.pageInfo.endCursor : null, observedAt: at(), shopId: observation.shop.id, shopDomain: domain };
    },
  };
}
