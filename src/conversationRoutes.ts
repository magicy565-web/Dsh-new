/** Conversation IDs are opaque. Decode browser paths once, encode API segments once. */
export function conversationIdFromRoute(value: string): { id?: string; invalid?: true } {
  try { const id = decodeURIComponent(value); return id && !/[\u0000-\u001f\u007f]/.test(id) ? { id } : { invalid: true }; }
  catch { return { invalid: true }; }
}
export function workspaceRoutePath(page: string, id?: string) { return `/${page}${id ? '/' + (page === 'chat' ? encodeURIComponent(id) : id) : ''}`; }
export function conversationApiPath(id: string, suffix = '') { return `/conversations/${encodeURIComponent(id)}${suffix}`; }
