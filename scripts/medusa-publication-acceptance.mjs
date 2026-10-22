// Real-medusa acceptance for the supplier publication adapter (S3 pre-flight).
// Creates one draft product with two variants and prices, republishes it to one
// sales channel, and prints both receipts. It never deletes anything: the
// created product id is reported so an operator can archive it manually.
//
// Required environment:
//   WORKSPACE_MEDUSA_BASE_URL       https origin (loopback http needs the adapter flag)
//   WORKSPACE_MEDUSA_SECRET_API_KEY secret key from the reviewed Medusa admin
//   WORKSPACE_MEDUSA_SALES_CHANNEL_ID  target sales channel (sc_...)
import { createHash } from 'node:crypto';
import { createMedusaPublicationAdapter } from '../server/medusa-publication.mjs';
import { supplierHash } from '../server/supplier-profile.mjs';

const environment = process.env;
const salesChannelId = environment.WORKSPACE_MEDUSA_SALES_CHANNEL_ID || '';
if (!/^sc_[A-Za-z0-9]+$/u.test(salesChannelId)) throw new Error('WORKSPACE_MEDUSA_SALES_CHANNEL_ID must be a Medusa sales channel id.');
const handle = `cnsub-acceptance-${Date.now()}`;
const preview = {
  product: { title: `Workspace acceptance ${handle}`, descriptionHtml: '<p>Automated acceptance for the supplier publication adapter.</p>' },
  market: { currency: 'USD' },
  saleUnit: { consumerPrice: '19.90' },
  images: [],
  options: [{ name: 'Color', values: ['Ivory', 'Blue'] }],
  variants: [
    { price: '19.90', sku: `${handle}-IVORY`, selectedOptions: [{ name: 'Color', value: 'Ivory' }] },
    { price: '21.50', sku: `${handle}-BLUE`, selectedOptions: [{ name: 'Color', value: 'Blue' }] },
  ],
};
const draftScope = {
  schema: 'workspace.supplier-publication-scope.v1', operationId: `accept-${handle}`, action: 'draft',
  subject: 'acceptance', workspaceId: environment.WORKSPACE_ID || 'local', serviceId: 'acceptance-service',
  serviceRevision: 1, previewHash: createHash('sha256').update(handle).digest('hex'), previewSnapshotHash: supplierHash(preview),
  preview, handle, salesChannelId: null, productId: null,
};
const adapter = createMedusaPublicationAdapter({ environment });
const status = adapter.status();
if (!status.configured) throw new Error('Medusa is unconfigured: set WORKSPACE_MEDUSA_BASE_URL and WORKSPACE_MEDUSA_SECRET_API_KEY.');
if (!status.writesEnabled) throw new Error('Set WORKSPACE_SUPPLIER_MEDUSA_WRITES_ENABLED=1 for the acceptance run.');

const binding = (scope, action) => ({ type: 'supplier-publication', operationId: scope.operationId, scopeHash: supplierHash(scope), action });

const drafted = await adapter.execute({ action: 'supplier.medusa.draft', payload: draftScope, binding: binding(draftScope) });
if (!drafted.found || !drafted.complete || drafted.status !== 'medusa_draft') throw new Error(`Draft acceptance failed: ${JSON.stringify(drafted.issues || drafted)}`);

const publishScope = {
  ...draftScope, action: 'publish', productId: drafted.productId, draftScope, draftScopeHash: supplierHash(draftScope),
  salesChannelId,
};
const published = await adapter.execute({ action: 'supplier.medusa.publish', payload: publishScope, binding: binding(publishScope) });
if (!published.published || !published.complete) throw new Error(`Publication acceptance failed: ${JSON.stringify(published.issues || published)}`);

console.log(JSON.stringify({
  ok: true,
  baseURL: status.baseURL,
  productId: drafted.productId,
  handle,
  variants: drafted.variantIds,
  draft: { status: drafted.status, complete: drafted.complete, remoteContentHash: drafted.remoteContentHash },
  publish: { status: published.status, published: published.published, salesChannelId, remoteContentHash: published.remoteContentHash },
  cleanup: `Archive ${drafted.productId} manually after review; this script never deletes.`,
}, null, 2));
