import React from 'react';
import { MousePointer2, Hand, Plus, Search, Undo2, Redo2, LayoutGrid, Map as MapIcon, Tag, Link2, Keyboard } from 'lucide-react';
import { IconButton, MenuButton } from '../ui.jsx';
import { keyLabel } from './shortcuts.mjs';

const hint = (label, ...keys) => `${label}（${keys.map((key) => keyLabel(key)).join('+')}）`;

export function FloatingToolbar({
  tool, onTool, onAdd, addHint, addDisabled, onSearch, searchActive, canUndo, canRedo, onUndo, onRedo, onArrange, canArrange,
  showMap, onToggleMap, showLabels, onToggleLabels, onlyRelated, onToggleRelated, relatedDisabled, onHelp,
}) {
  return (
    <div className="cv-toolbar" role="toolbar" aria-label="画布工具" aria-orientation="horizontal">
      <div className="cv-toolbar-group" role="group" aria-label="指针工具">
        <IconButton label={hint('选择工具', 'V')} pressed={tool === 'select'} active={tool === 'select'} onClick={() => onTool('select')}><MousePointer2 size={17} /></IconButton>
        <IconButton label={hint('平移工具', 'H')} pressed={tool === 'hand'} active={tool === 'hand'} onClick={() => onTool('hand')}><Hand size={17} /></IconButton>
      </div>
      <div className="cv-toolbar-group">
        <button type="button" className="cv-add-button" onClick={onAdd} disabled={addDisabled} aria-label={hint('添加节点', 'N')} title={hint('添加节点', 'N')} aria-haspopup="menu">
          <Plus size={16} /><span>添加</span>{addHint && <i className="cv-dot" aria-hidden="true" />}
        </button>
        <IconButton label={hint('搜索节点', 'Mod', 'F')} pressed={searchActive} active={searchActive} onClick={onSearch}><Search size={17} /></IconButton>
      </div>
      <div className="cv-toolbar-group">
        <IconButton label={hint('撤销布局', 'Mod', 'Z')} disabled={!canUndo} onClick={onUndo}><Undo2 size={17} /></IconButton>
        <IconButton label={hint('重做布局', 'Shift', 'Mod', 'Z')} disabled={!canRedo} onClick={onRedo}><Redo2 size={17} /></IconButton>
        <MenuButton label="自动整理布局" icon={<LayoutGrid size={17} />} direction="up" align="center" disabled={!canArrange}>
          {(close) => (
            <div className="cv-confirm">
              <strong>整理全部节点？</strong>
              <p>会按业务层级重新排布所有节点的位置，不会改动任何业务记录。可以随时撤销。</p>
              <div><button type="button" className="cn-button" onClick={close}>取消</button><button type="button" className="cn-button cn-primary" onClick={() => { onArrange(); close(); }}>整理布局</button></div>
            </div>
          )}
        </MenuButton>
      </div>
      <div className="cv-toolbar-group">
        <IconButton label="只看与所选节点相关的内容" pressed={onlyRelated} active={onlyRelated} disabled={relatedDisabled} onClick={onToggleRelated}><Link2 size={17} /></IconButton>
        <IconButton label="导航缩略图" pressed={showMap} active={showMap} onClick={onToggleMap}><MapIcon size={17} /></IconButton>
        <IconButton label="显示关系名称" pressed={showLabels} active={showLabels} onClick={onToggleLabels}><Tag size={17} /></IconButton>
        <IconButton label={hint('快捷键', '?')} onClick={onHelp}><Keyboard size={17} /></IconButton>
      </div>
    </div>
  );
}
