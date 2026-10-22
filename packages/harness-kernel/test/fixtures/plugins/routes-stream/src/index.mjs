// Fixture: a real streaming response (SSE shape) that holds its second chunk
// until the test releases it. If the kernel buffers the body, the first chunk
// can never arrive and the test fails by timeout instead of passing by accident.
const encoder = new TextEncoder();

const probe = { started: 0, released: false, cancelled: false, ended: false };
let release = null;

export function streamProbe() {
  return { ...probe };
}

export function releaseStream() {
  probe.released = true;
  const resolve = release;
  release = null;
  resolve?.();
}

export function apply(ctx) {
  ctx.http.route({
    method: 'GET',
    path: '/api/fixture/stream',
    handler: () => {
      probe.started += 1;
      probe.released = false;
      probe.cancelled = false;
      probe.ended = false;
      return new Response(new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode('data: one\n\n'));
          await new Promise(resolve => { release = resolve; });
          if (probe.cancelled) return;
          controller.enqueue(encoder.encode('data: two\n\n'));
          probe.ended = true;
          controller.close();
        },
        cancel() {
          probe.cancelled = true;
          const resolve = release;
          release = null;
          resolve?.();
        },
      }), {
        status: 200,
        headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' },
      });
    },
  });
  ctx.http.health('routes-stream', () => ({ status: 'ok' }));
}
