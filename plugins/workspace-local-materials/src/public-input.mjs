/** Obvious credential formats cannot be saved as conversational memory. */
export function looksLikeCredential(value) {
  if (typeof value !== 'string') return false;
  return /(?:\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bxox[baprs]-[A-Za-z0-9-]{10,}|\bAKIA[A-Z0-9]{16}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/-]{16,})/i.test(value)
    || /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|client[_ -]?secret)\s*[:=]\s*["']?[^\s"']{8,}/i.test(value);
}

export function validatePublicBusinessInput(input) {
  const forbidden = /^(?:__proto__|prototype|constructor|agentPresetContext|piTaskContext|tools|model|budget|artifact(?:s|Ids?|_ids?)?|skill(?:s|Ids?|_ids?)?|memory(?:Ids?|_ids?)?|file(?:s|Path|_path|Ids?)?)$/i;
  function publicTree(value, depth = 0) {
    if (depth > 8 || typeof value === 'number' && !Number.isFinite(value) || typeof value === 'string' && (value.length > 65536 || looksLikeCredential(value))) throw new Error('Use bounded explicit public text without credentials.');
    if (value && typeof value === 'object') {
      if (Array.isArray(value) && value.length > 100) throw new Error('Public business lists are limited to 100 items.');
      for (const [key, item] of Object.entries(value)) { if (forbidden.test(key)) throw new Error('Business input cannot set files, models, tools, budget or host context.'); publicTree(item, depth + 1); }
    }
  }
  publicTree(input);
  if (Buffer.byteLength(JSON.stringify(input)) > 96_000) throw new Error('Public business input exceeds this profile limit.');
}
