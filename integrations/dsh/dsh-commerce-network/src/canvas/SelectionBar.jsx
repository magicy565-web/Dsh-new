import React from 'react';
import { AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, AlignHorizontalSpaceBetween, AlignVerticalSpaceBetween, X } from 'lucide-react';
import { IconButton } from '../ui.jsx';

const MODES = [
  ['left', '左对齐', AlignStartVertical, 2], ['center', '水平居中', AlignCenterVertical, 2], ['right', '右对齐', AlignEndVertical, 2],
  ['top', '顶部对齐', AlignStartHorizontal, 2], ['middle', '垂直居中', AlignCenterHorizontal, 2], ['bottom', '底部对齐', AlignEndHorizontal, 2],
  ['distribute-x', '水平等间距', AlignHorizontalSpaceBetween, 3], ['distribute-y', '垂直等间距', AlignVerticalSpaceBetween, 3],
];

/** Appears with two or more selected nodes. Alignment edits layout only and can be undone. */
export function SelectionBar({ count, movable, writable, onAlign, onClear }) {
  const reason = !writable ? '当前服务未开放布局保存' : '';
  return (
    <div className="cv-selection" role="toolbar" aria-label={`已选择 ${count} 个节点`}>
      <strong>已选 {count} 项</strong>
      <i aria-hidden="true" />
      {MODES.map(([mode, label, Icon, needs]) => (
        <IconButton key={mode} label={reason || (movable < needs ? `${label}（至少选中 ${needs} 个可移动节点）` : label)} disabled={!writable || movable < needs} onClick={() => onAlign(mode)}><Icon size={16} /></IconButton>
      ))}
      <i aria-hidden="true" />
      <IconButton label="清除选择（Esc）" onClick={onClear}><X size={15} /></IconButton>
    </div>
  );
}
