import React, { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, getBezierPath, useStore } from '@xyflow/react';
import { EDGE_MARKER } from './edge-style.mjs';

const compact = (state) => state.transform[2] < 0.45;

export const CommerceEdge = memo(function CommerceEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }) {
  const small = useStore(compact);
  const tone = data?.tone || 'default';
  const geometry = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition };
  const [path, labelX, labelY] = Math.abs(targetX - sourceX) < 24 ? getBezierPath(geometry) : getSmoothStepPath({ ...geometry, borderRadius: 14 });
  const showLabel = data?.label && data.showLabel !== false && (!small || selected);
  const className = `cn-edge-path cn-edge-${tone}${selected ? ' cn-edge-selected' : ''}${data?.emphasis ? ' cn-edge-emphasis' : ''}${data?.dimmed ? ' cn-edge-dimmed' : ''}`;
  return (
    <>
      <BaseEdge id={id} path={path} className={className} markerEnd={`url(#${EDGE_MARKER[tone] || 'cn-arrow'})`} interactionWidth={18} />
      {showLabel && (
        <EdgeLabelRenderer>
          <span className={`cn-edge-label cn-edge-label-${tone}${selected ? ' cn-edge-label-selected' : ''}${data.dimmed ? ' cn-edge-dimmed' : ''}`} style={{ transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)` }}>{data.label}</span>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

/** Shared arrowheads. Colours come from CSS so both themes use the same markers. */
export function EdgeMarkers() {
  const marker = (id, cls) => (
    <marker key={id} id={id} viewBox="0 0 12 12" refX="10" refY="6" markerWidth="12" markerHeight="12" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
      <path d="M2 2 L10 6 L2 10 z" className={cls} />
    </marker>
  );
  return (
    <svg className="cn-marker-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>{marker('cn-arrow', 'cn-marker')}{marker('cn-arrow-active', 'cn-marker cn-marker-active')}{marker('cn-arrow-done', 'cn-marker cn-marker-done')}{marker('cn-arrow-failed', 'cn-marker cn-marker-failed')}</defs>
    </svg>
  );
}

/** Preview while dragging a connection; colour tells whether the target would accept it. */
export function ConnectionLine({ fromX, fromY, toX, toY, fromPosition, toPosition, connectionStatus }) {
  const [path] = getBezierPath({ sourceX: fromX, sourceY: fromY, targetX: toX, targetY: toY, sourcePosition: fromPosition, targetPosition: toPosition });
  return (
    <g className={`cn-connection cn-connection-${connectionStatus || 'idle'}`}>
      <path d={path} fill="none" className="cn-connection-path" />
      <circle cx={toX} cy={toY} r={4} className="cn-connection-end" />
    </g>
  );
}
