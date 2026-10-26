import { parentPort, workerData } from 'node:worker_threads';
import { ErpStore } from '../store.js';
const store = new ErpStore(workerData.file, { clock: () => workerData.now });
const gate = new Int32Array(workerData.gate);
parentPort.postMessage({ ready: true });
const deadline = Date.now() + 10000;
while (true) {
  const ready = Atomics.load(gate, 0); if (ready >= 2) break;
  if (Date.now() > deadline) throw new Error("Race test rendezvous timed out");
  Atomics.wait(gate, 0, ready, 1000);
}
let result;
try { result = { ok: true, value: store.write('workspace-a', workerData.command, 'race-test') }; }
catch (error) { result = { ok: false, code: error.code, message: error.message }; }
finally { store.close(); }
parentPort.postMessage(result);
