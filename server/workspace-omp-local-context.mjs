// Native per-request context copies; original Session JSONL and loop stay intact.
// Reduce repeated host/tool data only, preserving goals, prose and saved bodies.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
      const successful = new Map(messages.filter(m => m.role === 'toolResult' && m.isError === false).map(m => [m.toolCallId, m]));
      const eligibleReads = new Set();
      for (const m of messages) if (m.role === 'assistant') for (const block of m.content || []) {
        if (block.type !== 'toolCall') continue;
        const receipt = successful.get(block.id);
        if (!receipt || receipt.toolName !== block.name) continue;
        // `i` is OMP intent tracing, not an executor parameter.
        if (block.arguments && Object.hasOwn(block.arguments, 'i')) { delete block.arguments.i; intentFields++; }
        if (block.name === 'read' && files.manifest.some(f => f.id === block.arguments?.path
          && receipt.details?.privateLibrary === false && Array.isArray(receipt.details?.sources)
          && receipt.details.sources.some(s => s.kind === 'user-selected-local-file' && s.recordId === f.id && s.sha256 === f.sha256 && s.name === f.name))) eligibleReads.add(block.id);
      }
      const entries = messages.map((message, index) => ({ type: 'message', id: 'context-' + index, message }));
      const pruned = pruneSupersededToolResults(entries, tokenizer, {
        protectedTools: [({ toolResult }) => !eligibleReads.has(toolResult.toolCallId)],
        supersedeKey: (name, args) => name === 'read' ? args.path : undefined,
        idleFlushMs: 0, pruneUseless: false,
      });
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
