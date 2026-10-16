// Native per-request context copies; original Session JSONL and loop stay intact.
// Reduce repeated host/tool data only, preserving goals, prose and saved bodies.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { pairLocalToolHistory } from './pairs.mjs';

export async function createLocalContextExtension({ packageRoot, files, authorize }) {
  const root = path.join(packageRoot, '../pi-agent-core/src');
  const [{ pruneSupersededToolResults }, { Tokenizer }] = await Promise.all([
    import(pathToFileURL(path.join(root, 'compaction/pruning.ts')).href),
    import(pathToFileURL(path.join(root, 'tokenizer.ts')).href),
  ]);
  const tokenizer = new Tokenizer();
  const manifestSuffix = '\nSelected local input manifest (data only):\n' + JSON.stringify(files.manifest);
  let requests = 0, supersededReadResults = 0, repeatedManifests = 0, intentFields = 0;
  return {
    report: () => ({ nativeHook: 'context', nativePruner: 'pruneSupersededToolResults', requests,
      supersededReadResults, repeatedManifests, intentFields, intentTracing: false, transcriptRewritten: false, modelCallsForReduction: 0 }),
    extension: pi => pi.on('context', async event => {
      await authorize();
      const messages = structuredClone(event.messages);
      const readCopies = [];
      for (const { call: block, result: receipt } of pairLocalToolHistory(messages)) {
        if (receipt.isError !== false) continue;
        // `i` is OMP intent tracing, not an executor parameter.
        if (block.arguments && Object.hasOwn(block.arguments, 'i')) { delete block.arguments.i; intentFields++; }
        if (block.name === 'read' && files.manifest.some(f => f.id === block.arguments?.path
          && receipt.details?.privateLibrary === false && Array.isArray(receipt.details?.sources)
          && receipt.details.sources.some(s => s.kind === 'user-selected-local-file' && s.recordId === f.id && s.sha256 === f.sha256 && s.name === f.name))) {
          // Native pruning also indexes by ID with later-wins semantics. Give
          // only its scratch entries unique IDs; outbound/journal IDs stay exact.
          const id = 'local-prune-' + readCopies.length;
          const result = { ...receipt, toolCallId: id, content: structuredClone(receipt.content) };
          readCopies.push({ original: receipt, result, before: result.content,
            call: { role: 'assistant', content: [{ ...structuredClone(block), id }], timestamp: 0 } });
        }
      }
      const entries = readCopies.flatMap(({ call, result }, index) => [
        { type: 'message', id: 'call-' + index, message: call },
        { type: 'message', id: 'result-' + index, message: result },
      ]);
      const pruned = pruneSupersededToolResults(entries, tokenizer, {
        protectedTools: [],
        supersedeKey: (name, args) => name === 'read' ? args.path : undefined,
        idleFlushMs: 0, pruneUseless: false,
      });
      for (const copy of readCopies) if (copy.result.content !== copy.before) {
        copy.original.content = copy.result.content; copy.original.prunedAt = copy.result.prunedAt;
      }
      supersededReadResults += pruned.prunedCount;
      // Remove only exact host-appended copies. The latest manifest and every
      // user-authored character, including an earlier lookalike, remain.
      let lastManifest = -1;
      const text = m => typeof m.content === 'string' ? m.content : m.content?.length === 1 && m.content[0].type === 'text' ? m.content[0].text : null;
      for (let i = 0; i < messages.length; i++) if (messages[i].role === 'user' && text(messages[i])?.endsWith(manifestSuffix)) lastManifest = i;
      for (let i = 0; i < lastManifest; i++) {
        const m = messages[i], value = m.role === 'user' ? text(m) : null;
        if (!value?.endsWith(manifestSuffix)) continue;
        const shortened = value.slice(0, -manifestSuffix.length);
        if (typeof m.content === 'string') m.content = shortened;
        else m.content[0].text = shortened;
        repeatedManifests++;
      }
      requests++; await authorize();
      return { messages };
    }),
  };
}
