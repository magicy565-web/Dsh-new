// The kernel must stream a Response body chunk by chunk. Buffering would make
// SSE chat impossible: the client would only see the answer after the model
// finished, and a client abort would keep the producer running.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from '../src/app.mjs';
import { REPO_ROOT, fixtureComposition, silentLogger } from './helpers.mjs';
import { releaseStream, streamProbe } from './fixtures/plugins/routes-stream/src/index.mjs';

function deadline(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function withServing(run) {
  const harness = await createHarness({
    compositionPath: fixtureComposition('stream.composition.yml'),
    root: REPO_ROOT,
    logger: silentLogger,
  });
  try {
    const { address } = await harness.start();
    return await run(address);
  } finally {
    await harness.stop();
  }
}

test('http: a response body is streamed, never buffered', async () => {
  await withServing(async address => {
    const response = await deadline(
      fetch(`${address.url}/api/fixture/stream`), 2000,
      'response headers were buffered until the whole body finished',
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/u);

    const reader = response.body.getReader();
    const first = await deadline(reader.read(), 2000, 'the first chunk was buffered');
    assert.equal(new TextDecoder().decode(first.value), 'data: one\n\n');
    assert.equal(streamProbe().released, false, 'the client must see chunk one before the producer is released');

    releaseStream();
    const second = await deadline(reader.read(), 2000, 'the second chunk never arrived');
    assert.equal(new TextDecoder().decode(second.value), 'data: two\n\n');

    const end = await deadline(reader.read(), 2000, 'the stream never ended');
    assert.equal(end.done, true);
    assert.equal(streamProbe().ended, true);
  });
});

test('http: a client abort cancels the source stream', async () => {
  await withServing(async address => {
    const controller = new AbortController();
    const response = await fetch(`${address.url}/api/fixture/stream`, { signal: controller.signal });
    const reader = response.body.getReader();
    await deadline(reader.read(), 2000, 'the first chunk was buffered');

    controller.abort();
    const until = Date.now() + 2000;
    while (!streamProbe().cancelled && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(streamProbe().cancelled, true, 'the producer must learn that the client left');
  });
});
