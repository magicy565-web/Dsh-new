// Pair transcript occurrences, never a global provider-ID -> last-call map.
// One assistant message defines a tool batch. Reused IDs in later batches are
// valid; duplicate IDs within one batch are ambiguous and cannot grant a pair.
export function pairLocalToolHistory(messages) {
  const pairs = [], pending = new Map();
  for (const message of messages) {
    if (message.role === 'user') pending.clear();
    if (message.role === 'assistant') {
      pending.clear();
      const ambiguous = new Set();
      for (const call of message.content || []) {
        if (call.type !== 'toolCall' || typeof call.id !== 'string' || !call.id) continue;
        if (pending.has(call.id) || ambiguous.has(call.id)) { pending.delete(call.id); ambiguous.add(call.id); }
        else pending.set(call.id, call);
      }
    }
    if (message.role !== 'toolResult') continue;
    const call = pending.get(message.toolCallId); pending.delete(message.toolCallId);
    if (call && call.name === message.toolName) pairs.push({ call, result: message });
  }
  return pairs;
}
