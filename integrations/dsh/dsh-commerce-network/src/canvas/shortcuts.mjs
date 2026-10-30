// Keyboard model. One table drives both the handler and the help panel.

export const SHORTCUTS = Object.freeze([
  { id: 'tool.select', keys: ['V'], label: '选择工具', group: '工具' },
  { id: 'tool.hand', keys: ['H'], label: '平移工具', group: '工具' },
  { id: 'add.open', keys: ['Tab', 'N'], label: '添加节点', group: '创建', note: 'Tab 仅在画布获得焦点时生效' },
  { id: 'search.open', keys: ['Mod', 'F'], label: '搜索节点', group: '查找' },
  { id: 'select.all', keys: ['Mod', 'A'], label: '全选可见节点', group: '选择' },
  { id: 'inspect.open', keys: ['Enter'], label: '打开所选节点的详情', group: '选择' },
  { id: 'escape', keys: ['Esc'], label: '逐层关闭浮层与选择', group: '选择' },
  { id: 'nudge', keys: ['方向键'], label: '微移所选节点 1 像素（按住 Shift 为 8）', group: '布局' },
  { id: 'history.undo', keys: ['Mod', 'Z'], label: '撤销布局', group: '布局' },
  { id: 'history.redo', keys: ['Shift', 'Mod', 'Z'], label: '重做布局', group: '布局' },
  { id: 'view.fit', keys: ['1'], label: '适应视图', group: '视图' },
  { id: 'view.focus', keys: ['Shift', '1'], label: '定位到所选节点', group: '视图' },
  { id: 'view.zoomIn', keys: ['+'], label: '放大', group: '视图' },
  { id: 'view.zoomOut', keys: ['-'], label: '缩小', group: '视图' },
  { id: 'view.zoomReset', keys: ['0'], label: '缩放回 100%', group: '视图' },
  { id: 'help.open', keys: ['?'], label: '快捷键面板', group: '帮助' },
]);

const EDITABLE = 'input,textarea,select,[contenteditable=""],[contenteditable="true"],[role="dialog"],[role="menu"],[role="listbox"],[role="combobox"]';
export const isEditableTarget = (target) => Boolean(target?.closest?.(EDITABLE));

const ARROWS = Object.freeze({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] });

/**
 * Map a keyboard event to a canvas action. Returns `{ id, payload? }` or null.
 * Keys typed into inputs, dialogs and menus are never intercepted.
 */
export function resolveShortcut(event, { canvasFocused = false } = {}) {
  if (event.defaultPrevented || isEditableTarget(event.target)) return null;
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key;
  if (mod) {
    const lowered = key.length === 1 ? key.toLowerCase() : key;
    if (event.altKey) return null;
    if (lowered === 'f') return { id: 'search.open' };
    if (lowered === 'a') return { id: 'select.all' };
    if (lowered === 'z') return { id: event.shiftKey ? 'history.redo' : 'history.undo' };
    if (lowered === 'y') return { id: 'history.redo' };
    return null;
  }
  if (event.altKey) return null;
  if (ARROWS[key]) { const [x, y] = ARROWS[key]; const step = event.shiftKey ? 8 : 1; return { id: 'nudge', payload: { dx: x * step, dy: y * step } }; }
  if (key === 'Tab') return !event.shiftKey && canvasFocused ? { id: 'add.open' } : null;
  if (key === 'Enter') return { id: 'inspect.open' };
  if (key === 'Escape') return { id: 'escape' };
  if (event.code === 'Digit1' && event.shiftKey) return { id: 'view.focus' };
  if (key === '?') return { id: 'help.open' };
  if (event.shiftKey && key !== '+') return null;
  const lowered = key.toLowerCase();
  if (lowered === 'v') return { id: 'tool.select' };
  if (lowered === 'h') return { id: 'tool.hand' };
  if (lowered === 'n') return { id: 'add.open' };
  if (key === '1') return { id: 'view.fit' };
  if (key === '+' || key === '=') return { id: 'view.zoomIn' };
  if (key === '-' || key === '_') return { id: 'view.zoomOut' };
  if (key === '0') return { id: 'view.zoomReset' };
  return null;
}

export const isMacPlatform = (nav = globalThis.navigator) => /Mac|iPhone|iPad/.test(nav?.platform || nav?.userAgent || '');
export const keyLabel = (key, mac = isMacPlatform()) => (key === 'Mod' ? (mac ? '⌘' : 'Ctrl') : key === 'Shift' && mac ? '⇧' : key);
