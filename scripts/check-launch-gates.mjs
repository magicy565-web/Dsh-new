#!/usr/bin/env node
/** Evidence inventory, not a production/security certification. Never fabricates a pass. */
import { promises as fs } from 'node:fs';
import { sourceFingerprint } from './acceptance-provider.mjs';
const fingerprint = await sourceFingerprint();
const runtime = process.env.WORKSPACE_LAUNCH_RUNTIME || 'harness';
if (!['harness', 'fastaitoken'].includes(runtime)) throw new Error('Choose the exact intended relay runtime for launch acceptance.');
const gates = [];
async function report(name, filename, validate) {
  try { const value = JSON.parse(await fs.readFile(filename, 'utf8')); const problems = validate(value); gates.push({ name, status: problems.length ? 'blocked' : 'passed', evidence: filename, problems }); }
  catch (error) { gates.push({ name, status: 'blocked', evidence: filename, problems: [error.code === 'ENOENT' ? 'Required evidence is absent' : 'Required evidence is unreadable or invalid'] }); }
}
const sourceProblem = value => value.sourceFingerprint === fingerprint ? [] : ['Evidence is not for the current source/build fingerprint'];
if (runtime === 'fastaitoken') await report('authorized-selected-provider', 'evidence/live-provider.json', value => [...sourceProblem(value), ...(value.result === 'passed' ? [] : ['Real provider acceptance did not pass']), ...(value.evidenceKind === 'real-provider-fastaitoken' && value.model === 'gpt-6-sol' ? [] : ['Evidence does not establish the selected relay/model'])]);
else {
  await report('native-selected-provider', 'evidence/live-native-provider.json', value => [...sourceProblem(value), ...(value.result === 'passed' && value.evidenceKind === 'real-native-provider-fastaitoken' && value.acceptanceScope === 'native-text-session-lifecycle' && value.runtime === 'harness' && value.provider === 'fastaitoken' && value.model === 'gpt-6-sol' && value.cleanup === 'removed' && value.appCommandCount === 4 && value.lifecycle?.providerInstances === 2 && value.lifecycle?.confirmedProviderCloses === 2 && ['initialNativeMapping', 'duplicateIdempotency', 'sameProcessContinuation', 'persistentArtifact', 'persistedNativeResume', 'nativeEventReceipts', 'ownedProcessShutdown', 'cancellationAfterNativeAdmission', 'cancelledOwnedProcessShutdown'].every(check => value.checks?.[check] === true) ? [] : ['Real native selected-relay session-lifecycle acceptance is missing'])]);
  await report('native-reviewed-tool-profile', 'evidence/live-native-profile.json', value => [...sourceProblem(value), ...(value.result === 'passed' && value.evidenceKind === 'real-native-tool-profile' && value.model === 'gpt-6-sol' && value.nativeToolAcceptance === true && value.profilePermissionAcceptance === true && typeof value.permissionFingerprint === 'string' && /^[a-f0-9]{64}$/.test(value.permissionFingerprint) ? [] : ['Actual selected-profile tool and permission acceptance is missing; model text/session continuity does not establish it'])]);
}
await report('browser-reference-acceptance', 'evidence/browser/acceptance.json', value => [...sourceProblem(value), ...(value.result === 'accepted' && value.actualBrowser === true && value.referenceReviewed === true && value.desktop === true && value.mobile === true ? [] : ['Actual desktop/mobile rendering and reference acceptance are not established'])]);
await report('target-deployment', 'evidence/target-deployment.json', value => [...sourceProblem(value), ...(value.result === 'accepted' && value.tlsVerified === true && value.identityIngressVerified === true && value.persistenceVerified === true && value.offHostRecoveryVerified === true && value.publicDeploymentAuthorized === true && value.runtime === runtime && (runtime !== 'harness' || value.nativeRecoveryVerified === true) ? [] : ['Actual authorized host/TLS/identity/persistence/recovery acceptance is incomplete'])]);
await report('independent-security-review', 'evidence/security-review.json', value => [...sourceProblem(value), ...(value.result === 'passed' && value.unresolvedCriticalFindings === 0 ? [] : ['Independent final security review is incomplete'])]);
console.log(JSON.stringify({ schemaVersion: 1, checkedAt: new Date().toISOString(), runtime, sourceFingerprint: fingerprint, ready: gates.every(gate => gate.status === 'passed'), scope: 'Evidence consistency inventory; human launch authorization is still required', gates }, null, 2));
if (gates.some(gate => gate.status !== 'passed')) process.exitCode = 1;
