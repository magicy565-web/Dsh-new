import { supplierHash } from '../supplier-profile.mjs';
export function notificationSource(monitor, phase = 'summary') {
  if (phase === 'summary') return monitor.summary || null;
  if (phase !== 'first_sample') return null;
  const check = monitor.checks?.find(item => item.status === 'complete' && item.sample);
  if (!check) return null;
  const content = { monitorId: monitor.id, sourceRequestId: check.requestId, sample: check.sample };
  return { ...content, phase, messageId: `supplier-first-sample-${monitor.id}`, notificationCount: 1, revision: 1,
    contentHash: supplierHash(content), startAt: monitor.scope.startAt, endAt: check.sample.coverage.to,
    provisional: check.sample.salesStatus !== 'available' || check.sample.trafficStatus !== 'available' };
}
