import React from 'react';
import { useStore } from '@xyflow/react';
import { Minus, Plus, Maximize2 } from 'lucide-react';
import { IconButton } from '../ui.jsx';

export function ZoomControl({ actions }) {
  const percent = useStore((state) => Math.round(state.transform[2] * 100));
  return (
    <div className="cv-zoom" role="group" aria-label="缩放">
      <IconButton label="缩小（-）" onClick={() => actions.current?.zoomOut()}><Minus size={16} /></IconButton>
      <button type="button" className="cv-zoom-value" title="缩放回 100%（0）" aria-label={`当前缩放 ${percent}%，点击回到 100%`} onClick={() => actions.current?.zoomTo(1)}>{percent}%</button>
      <IconButton label="放大（+）" onClick={() => actions.current?.zoomIn()}><Plus size={16} /></IconButton>
      <i aria-hidden="true" />
      <IconButton label="适应视图（1）" onClick={() => actions.current?.fit()}><Maximize2 size={15} /></IconButton>
    </div>
  );
}
