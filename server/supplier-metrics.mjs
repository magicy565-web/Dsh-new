import { supplierFail } from './supplier-profile.mjs';
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const integer = value => Number.isSafeInteger(value) && value >= 0;
const gid = (kind, value) => new RegExp(`^gid://shopify/${kind}/\\d+$`).test(value);
export function productCohortMetrics(orders, { productId, variantIds = [], from, to }) {
  const metrics = { grossOrders: 0, grossUnits: 0, cancelledOrders: 0, cancelledUnits: 0, refundedUnits: 0, cancelledRefundedOverlapUnits: 0, removedOrAdjustedUnits: 0, retainedOrders: 0, retainedUnits: 0, revenue: null };
  const orderIds = new Set();
  for (const order of orders) {
    if (!gid('Order', order.id) || orderIds.has(order.id) || !validDate(order.createdAt) || !validDate(order.updatedAt) || typeof order.test !== 'boolean' || order.cancelledAt !== null && !validDate(order.cancelledAt) || !Array.isArray(order.lineItems?.nodes) || order.lineItems.pageInfo?.hasNextPage !== false || !Array.isArray(order.refunds)) supplierFail(502, 'SHOPIFY_ORDERS_INCOMPLETE', 'A complete acknowledged order/line/refund cohort is required.');
    orderIds.add(order.id);
    if (Date.parse(order.createdAt) < Date.parse(from) || Date.parse(order.createdAt) >= Date.parse(to)) supplierFail(502, 'SHOPIFY_ORDER_SCOPE_MISMATCH', 'The order is outside the exact creation cohort.');
    if (order.test) continue;
    const lineIds = new Set(), matches = [];
    for (const line of order.lineItems.nodes) {
      if (!gid('LineItem', line.id) || lineIds.has(line.id) || !integer(line.quantity) || !integer(line.currentQuantity) || line.currentQuantity > line.quantity) supplierFail(502, 'SHOPIFY_ORDERS_INCOMPLETE', 'Line quantities or identities are incomplete.');
      lineIds.add(line.id);
      if (line.product?.id === productId && (!variantIds.length || variantIds.includes(line.variant?.id))) matches.push(line);
    }
    const refunded = new Map(), refundIds = new Set();
    for (const refund of order.refunds) {
      if (!gid('Refund', refund.id) || refundIds.has(refund.id) || !validDate(refund.createdAt) || !Array.isArray(refund.refundLineItems?.nodes) || refund.refundLineItems.pageInfo?.hasNextPage !== false) supplierFail(502, 'SHOPIFY_ORDERS_INCOMPLETE', 'Actual refund pagination and identities are required.');
      refundIds.add(refund.id);
      for (const item of refund.refundLineItems.nodes) {
        if (!integer(item.quantity) || !lineIds.has(item.lineItem?.id)) supplierFail(502, 'SHOPIFY_ORDERS_INCOMPLETE', 'Refund units must reference an acknowledged original line.');
        refunded.set(item.lineItem.id, (refunded.get(item.lineItem.id) || 0) + item.quantity);
      }
    }
    if (!matches.length) continue;
    metrics.grossOrders++; if (order.cancelledAt) metrics.cancelledOrders++;
    let retained = 0;
    for (const line of matches) {
      const refundUnits = refunded.get(line.id) || 0;
      if (refundUnits > line.quantity) supplierFail(502, 'SHOPIFY_ORDERS_INCOMPLETE', 'Refunded quantities exceed the acknowledged original line.');
      metrics.grossUnits += line.quantity; metrics.refundedUnits += refundUnits;
      if (order.cancelledAt) { metrics.cancelledUnits += line.quantity; metrics.cancelledRefundedOverlapUnits += refundUnits; }
      else retained += line.currentQuantity;
      metrics.removedOrAdjustedUnits += Math.max(0, line.quantity - line.currentQuantity - refundUnits);
    }
    metrics.retainedUnits += retained; if (retained) metrics.retainedOrders++;
  }
  return metrics;
}
export const SUPPLIER_METRIC_DEFINITION = Object.freeze({ cohort: 'non-test orders created in [startAt,endAt), exact product and optionally exact variant IDs',
  grossUnits: 'original matching line quantity, including later cancellations/refunds', cancelledUnits: 'original matching quantity on orders cancelled as of sampling; may overlap refunds', refundedUnits: 'actual refundLineItems.quantity joined to the original matching line as of sampling',
  retainedUnits: 'currentQuantity on non-cancelled matching lines; already excludes refunded/removed units, so refunds are never subtracted twice',
  correction: 'later refunds/cancellations revise the same seven-day cohort and original final summary', revenue: 'not derived from store/order totals; unavailable in this bounded quantity adapter', traffic: 'no whole-store sessions substitution; exact authorized product attribution required' });
