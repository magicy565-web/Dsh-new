import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { createApp } from '/workspace/workspace-release-20261013/server/index.mjs';
import { createPiProvider } from '/workspace/workspace-release-20261013/server/pi-provider.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let i = 0; i < 500; i++) { if (await check()) return; await pause(10); } throw Error('Probe did not settle'); }

test('supported two-step real Pi task preserves explicit public v1, private Library references, final file, cancel and restart', async () => {
  const directory = await fs.mkdtemp('/tmp/workspace-result-protocol-probe-');
  const faux = fauxProvider(), models = createModels(); models.setProvider(faux.provider);
  const provider = () => createPiProvider({ models, providerId: 'faux', model: 'faux-1' });
  let app = await createApp({ dataDirectory: directory, provider: provider() });
  try {
    const address = await app.listen(0), origin = `http://127.0.0.1:${address.port}`;
    async function api(route, method = 'GET', body) {
      const response = await fetch(origin + '/api' + route, { method,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value;
    }
    const conversation = (await api('/conversations', 'POST', { title: 'Synthetic pinned-input task' })).conversation;
    const internal = (await api('/artifacts', 'POST', { filename: 'internal.md', content: 'PRIVATE_LIBRARY_BYTES_NOT_AUTHORIZED_FOR_MODEL', metadata: { businessLibrary: { visibility: 'internal' } }, requestId: randomUUID() })).artifact;
    const document = (await api('/library/documents', 'POST', { requestId: randomUUID(), title: 'PRIVATE_LIBRARY_TITLE_NOT_AUTHORIZED_FOR_MODEL', slotKey: 'company', asset: { artifactId: internal.id, version: 1, sha256: internal.sha256 } })).document;
    const product = (await api('/library/products', 'POST', { requestId: randomUUID(), name: 'PRIVATE_LIBRARY_PRODUCT_NOT_AUTHORIZED_FOR_MODEL' })).product;
    const linked = await api(`/conversations/${conversation.id}/library-references`, 'PATCH', { requestId: randomUUID(), expectedRevision: 0, references: { products: [{ productId: product.id, productRevision: 1 }], documents: [{ documentId: document.id, documentVersion: 1 }] } });
    assert.equal(linked.libraryReferences.documents[0].documentVersion, 1);
    const input = (await api('/artifacts', 'POST', { filename: 'reviewed-public-scope.md', content: 'EXPLICITLY_SELECTED_PUBLIC_SCOPE_VERSION_ONE', requestId: randomUUID() })).artifact;
    await api('/artifacts/' + input.id, 'PATCH', { expectedRevision: input.revision, content: 'LATER_SCOPE_VERSION_TWO_NOT_SELECTED' });
    await api(`/conversations/${conversation.id}/input-context`, 'PATCH', { inputContext: { artifacts: [{ id: input.id, version: 1 }] } });
    let providerReads = 0;
    const response = (filename, done) => request => {
      providerReads++; const messages = JSON.stringify(request.messages);
      assert.match(messages, /EXPLICITLY_SELECTED_PUBLIC_SCOPE_VERSION_ONE/);
      assert.doesNotMatch(messages, /LATER_SCOPE_VERSION_TWO_NOT_SELECTED|PRIVATE_LIBRARY_/);
      return fauxAssistantMessage(JSON.stringify({ done, content: `Synthetic ${filename} ready.`, nextStep: done ? '' : 'Prepare final file', ...(done ? { artifact: { filename, content: `# Synthetic ${filename}\nPinned public scope only.` } } : {}) }));
    };
    faux.setResponses([response('first.md', false), response('final.md', true)]);
    const admitted = await api(`/conversations/${conversation.id}/messages`, 'POST', { content: 'Use the explicitly selected public scope to prepare two local file drafts.', requestId: randomUUID(), workspaceExecution: true });
    await until(() => !['running', 'queued'].includes(app.runtime.getRun(admitted.run.id).run.status));
    assert.equal(app.runtime.getRun(admitted.run.id).run.status, 'succeeded', JSON.stringify(app.runtime.getRun(admitted.run.id).run));
    const bootstrap = await api('/bootstrap'), run = bootstrap.runs.find(item => item.id === admitted.run.id);
    assert.equal(run.inputContextSnapshot.artifacts[0].version, 1);
    assert.equal(providerReads, 2);
    const outputs = bootstrap.messages.filter(item => item.runId === run.id && item.artifactReference);
    assert.equal(outputs.length, 1);
    const reachable = [];
    for (const message of outputs) {
      const artifact = bootstrap.artifacts.find(item => item.id === message.artifactId && item.sourceRunId === run.id && item.sourceConversationId === conversation.id);
      const version = artifact?.versions.find(item => item.version === message.artifactReference.version && item.sha256 === message.artifactReference.sha256);
      assert.ok(version, 'Exact message version and provenance must survive in bootstrap');
      const downloaded = await fetch(origin + `/api/artifacts/${artifact.id}/download?version=${version.version}&sha256=${version.sha256}`);
      assert.equal(downloaded.status, 200); assert.match(await downloaded.text(), /Pinned public scope only/);
      reachable.push({ filename: version.filename, artifactId: artifact.id, sourceRunId: artifact.sourceRunId,
        messageReference: message.artifactReference, scalarConversationGuardAllows: run.outputArtifactId === artifact.id,
        allOutputsMembership: run.outputArtifactIds?.includes(artifact.id) === true });
    }
    const refs = await api(`/conversations/${conversation.id}/library-references`);
    assert.equal(refs.libraryReferences.documents[0].documentVersion, 1);
    assert.ok(reachable.every(item => item.scalarConversationGuardAllows), 'Final file must remain reachable through the exact original conversation output guard');
    const cancelConversation = (await api('/conversations', 'POST', { title: 'Synthetic cancellable pinned-input task', inputContext: { artifacts: [{ id: input.id, version: 1 }] } })).conversation;
    faux.setResponses([async (request, options) => {
      const messages = JSON.stringify(request.messages);
      assert.match(messages, /EXPLICITLY_SELECTED_PUBLIC_SCOPE_VERSION_ONE/);
      assert.doesNotMatch(messages, /LATER_SCOPE_VERSION_TWO_NOT_SELECTED|PRIVATE_LIBRARY_/);
      await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
      return fauxAssistantMessage(JSON.stringify({ done: true, content: 'Late cancelled fixture', artifact: { filename: 'cancelled.md', content: 'Must not publish' } }), { stopReason: 'aborted' });
    }]);
    const cancelled = await api(`/conversations/${cancelConversation.id}/messages`, 'POST', { content: 'Use reviewed public text; cancellation fixture only.', requestId: randomUUID(), workspaceExecution: true });
    await until(() => faux.state.callCount === 3);
    await app.runtime.cancelConversation(cancelConversation.id);
    await until(() => app.runtime.status().queue.active === 0);
    assert.equal(app.runtime.getRun(cancelled.run.id).run.status, 'cancelled');
    assert.equal(app.store.read().artifacts.some(item => item.sourceRunId === cancelled.run.id), false);
    await app.close(); app = await createApp({ dataDirectory: directory, provider: provider() });
    await pause(60);
    const reopened = app.runtime.bootstrap();
    assert.equal(faux.state.callCount, 3, 'Restart cannot replay a completed or cancelled task');
    const reopenedMessage = reopened.messages.find(item => item.id === outputs[0].id);
    assert.deepEqual(reopenedMessage.artifactReference, outputs[0].artifactReference);
    assert.equal(reopened.runs.find(item => item.id === run.id).outputArtifactId, outputs[0].artifactId);
    assert.equal(reopened.runs.find(item => item.id === cancelled.run.id).status, 'cancelled');
    const savedReferences = app.businessLibrary.getConversationReferences(conversation.id);
    assert.equal(savedReferences.libraryReferences.documents[0].documentVersion, 1);
    assert.equal(savedReferences.libraryReferences.products[0].productRevision, 1);
    const savedFile = await app.artifacts.read(outputs[0].artifactId, { version: outputs[0].artifactReference.version });
    assert.equal(savedFile.version.sha256, outputs[0].artifactReference.sha256);
    assert.match(savedFile.content, /Pinned public scope only/);
    console.log(JSON.stringify({ runId: run.id, selectedInputVersion: 1, libraryReferenceVersion: 1, privateLibrarySentToModel: false, actualPiSdkRequests: faux.state.callCount, currentOutputArtifactId: run.outputArtifactId, outputFiles: reachable, cancelledRunId: cancelled.run.id, cancelledFilePublished: false, restartReplayedTasks: false, exactOutputReferenceSurvivedRestart: true }));
  } finally { await app.close(); await fs.rm(directory, { recursive: true, force: true }); }
});
