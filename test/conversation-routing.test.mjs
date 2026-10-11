import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationIdFromRoute, workspaceRoutePath, conversationApiPath } from '../src/conversationRoutes.ts';

test('opaque conversation slash/colon IDs are decoded and encoded exactly once', () => {
  for (const id of ['original/session', 'original:session', 'original/session:alpha']) {
    const route = workspaceRoutePath('chat', id);
    assert.deepEqual(conversationIdFromRoute(route.slice('/chat/'.length)), { id });
    assert.equal(conversationApiPath(id, '/muse-delegations'), `/conversations/${encodeURIComponent(id)}/muse-delegations`);
    assert.equal(conversationApiPath(id, '/procurement'), `/conversations/${encodeURIComponent(id)}/procurement`);
  }
  assert.deepEqual(conversationIdFromRoute('original%252Fsession'), { id: 'original%2Fsession' });
  assert.equal(conversationApiPath(conversationIdFromRoute('original%252Fsession').id), '/conversations/original%252Fsession');
  assert.deepEqual(conversationIdFromRoute('original/session'), { id: 'original/session' });
  assert.equal(workspaceRoutePath('library', 'products/product-id'), '/library/products/product-id');
});
test('malformed encoding and control bytes cannot become another conversation ID', () => {
  for (const raw of ['%ZZ', '%E0%A4%A', '%00', '%0A', '']) assert.deepEqual(conversationIdFromRoute(raw), { invalid: true });
});
