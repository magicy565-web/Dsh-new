import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, BackgroundVariant, MiniMap, ViewportPortal, SelectionMode, applyNodeChanges, useReactFlow } from '@xyflow/react';
import { NodeCard } from '../NodeCard.jsx';
import { DraftCard } from './DraftCard.jsx';
import { CommerceEdge, EdgeMarkers, ConnectionLine } from './CommerceEdge.jsx';
import { EDGE_LABELS, KINDS, STATUSES, autoLayout, initialViewport } from '../model.mjs';
import { GRID, NODE_HEIGHT_ESTIMATE, NODE_WIDTH, isVisibleInView, kindFamily } from './kinds.mjs';
import { alignBoxes, alignmentGuides } from './guides.mjs';
import { createHistory } from './history.mjs';
import { LayoutSaver } from './layout-saver.mjs';
import { edgeTone } from './edge-style.mjs';
import { connectionRule } from './connect-rules.mjs';
import { draftNodeId } from './drafts.mjs';
import { loadViewport, saveViewport } from './viewport-store.mjs';

const nodeTypes = { commerce: NodeCard, draft: DraftCard };
const edgeTypes = { commerce: CommerceEdge };
const LARGE_GRAPH = 150;
const SNAP_THRESHOLD = 6;

const sizeOf = (node) => ({ w: node.measured?.width ?? NODE_WIDTH, h: node.measured?.height ?? NODE_HEIGHT_ESTIMATE });
const sameIds = (a, b) => a.length === b.length && a.every((id, index) => id === b[index]);
const miniMapColor = (node) => `var(--cn-kind-${kindFamily(node.data?.item?.kind)})`;

export function CanvasSurface({
  graph, saveableIds, scope, view, tool, matching, related, drafts, selectedEdgeId, showMap, showEdgeLabels, inspectorOpen,
  onSelectionChange, onSelectEdge, onOpenNode, onAsk, onConnectNodes, onConnectDrop, onConnectRefused, onPaneDoubleClick,
  onDraftDismiss, onDraftRetry, onSaveLayout, onReload, onSyncChange, onHistoryChange, announce, actionRef,
}) {
  const flow = useReactFlow();
  const writable = graph.commerceNetwork?.layoutWriteSupported === true;
  const [nodes, setNodes] = useState([]);
  const [guides, setGuides] = useState([]);
  const [startingViewport] = useState(() => loadViewport(scope) || initialViewport(graph));
  const hadSavedViewport = useRef(Boolean(loadViewport(scope) || graph.viewport));

  const nodesRef = useRef(nodes);
  const graphRef = useRef(graph);
  const saveableRef = useRef(saveableIds);
  const handlers = useRef({});
  handlers.current = { onSaveLayout, onSyncChange, onHistoryChange, announce, onSelectionChange };
  graphRef.current = graph;
  saveableRef.current = saveableIds;

  const history = useRef(null);
  if (!history.current) history.current = createHistory();
  const saver = useRef(null);
  if (!saver.current) {
    saver.current = new LayoutSaver({
      projectId: graph.projectId,
      revision: graph.layoutRevision,
      save: async (patch) => handlers.current.onSaveLayout(patch),
      online: () => globalThis.navigator?.onLine !== false,
      onChange: (state) => handlers.current.onSyncChange(state),
    });
  }

  const commitNodes = useCallback((next) => { nodesRef.current = next; setNodes(next); }, []);
  const reportHistory = useCallback(() => handlers.current.onHistoryChange?.({ canUndo: history.current.canUndo, canRedo: history.current.canRedo }), []);

  const seenRevision = useRef(graph.layoutRevision);
  useEffect(() => {
    const unseen = graph.layoutRevision > seenRevision.current;
    if (unseen) seenRevision.current = graph.layoutRevision;
    saver.current.setRevision(graph.layoutRevision);
    const keepLocal = !unseen || saver.current.busy;
    const previous = new Map(nodesRef.current.map((node) => [node.id, node]));
    const real = graph.nodes.map((item) => {
      const before = previous.get(item.id);
      const saveable = saveableIds.has(item.id);
      return {
        id: item.id, type: 'commerce', position: keepLocal && before ? before.position : item.position,
        data: { item: { ...item, saveable }, onAsk },
        draggable: writable && saveable, selectable: true, selected: before?.selected, measured: before?.measured,
        ariaLabel: `${KINDS[item.kind] || item.kind}：${item.title}，${STATUSES[item.status] || '待核对'}`,
      };
    });
    const pending = drafts.map((draft) => {
      const before = previous.get(draftNodeId(draft.id));
      return { id: draftNodeId(draft.id), type: 'draft', position: draft.position, data: { draft: { ...draft, retryable: Boolean(draft.retryable) }, onDismiss: onDraftDismiss, onRetry: onDraftRetry }, draggable: false, selectable: false, measured: before?.measured };
    });
    commitNodes([...real, ...pending]);
    history.current.prune(new Set(graph.nodes.map((node) => node.id)));
    reportHistory();
  }, [graph, saveableIds, drafts, onAsk, onDraftDismiss, onDraftRetry, writable, commitNodes, reportHistory]);

  useEffect(() => {
    saver.current.setWritable(writable);
    handlers.current.onSyncChange({ status: saver.current.status, message: saver.current.message, pendingCount: saver.current.pendingCount });
    const online = () => { void saver.current.retry(); };
    globalThis.addEventListener?.('online', online);
    const instance = saver.current;
    return () => {
      globalThis.removeEventListener?.('online', online);
      void instance.flush();
      instance.dispose();
    };
  }, [writable]);

  const firstNodes = useRef(graph.nodes.length === 0);
  useEffect(() => {
    if (!firstNodes.current || !graph.nodes.length) return;
    firstNodes.current = false;
    if (!hadSavedViewport.current) void flow.setViewport(initialViewport(graph));
  }, [graph, flow]);

  const displayed = useMemo(() => nodes
    .filter((node) => node.type === 'draft' || (isVisibleInView(view, node.data.item.kind) && (!related || related.has(node.id))))
    .map((node) => (node.type === 'draft' ? node : { ...node, className: matching && !matching.has(node.id) ? 'cn-dim' : undefined })), [nodes, view, related, matching]);
  const visibleIds = useMemo(() => new Set(displayed.map((node) => node.id)), [displayed]);
  const selectedIds = useMemo(() => new Set(nodes.filter((node) => node.selected).map((node) => node.id)), [nodes]);
  const edges = useMemo(() => graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)).map((edge) => {
    const touching = selectedIds.has(edge.source) || selectedIds.has(edge.target);
    return {
      id: edge.id, source: edge.source, target: edge.target, type: 'commerce', selected: edge.id === selectedEdgeId,
      data: { tone: edgeTone(edge), label: EDGE_LABELS[edge.kind] || edge.kind, showLabel: showEdgeLabels, emphasis: touching, dimmed: selectedIds.size > 0 && !touching },
    };
  }), [graph.edges, visibleIds, selectedIds, selectedEdgeId, showEdgeLabels]);

  const positionOf = (id) => nodesRef.current.find((node) => node.id === id)?.position;
  const applyPositions = useCallback((list) => {
    const byId = new Map(list.map((entry) => [entry.id, entry.position]));
    commitNodes(nodesRef.current.map((node) => (byId.has(node.id) ? { ...node, position: byId.get(node.id) } : node)));
  }, [commitNodes]);
  const finishMove = useCallback((label, changes) => {
    const saveable = changes.filter((change) => saveableRef.current.has(change.id));
    if (history.current.record({ label, changes: saveable })) {
      saver.current.queue(saveable.filter((change) => change.before.x !== change.after.x || change.before.y !== change.after.y).map((change) => ({ id: change.id, position: change.after })));
    }
    reportHistory();
  }, [reportHistory]);

  const dragStart = useRef(new Map());
  const dragIds = useRef(new Set());
  const nudgeSession = useRef(null);

  const handleNodesChange = useCallback((changes) => {
    const zoom = flow.getViewport().zoom || 1;
    let nextGuides = null;
    const adjusted = changes.filter((change) => change.type !== 'remove').map((change) => {
      if (change.type !== 'position' || !change.dragging || !change.position || dragIds.current.size !== 1 || !dragIds.current.has(change.id)) return change;
      const self = nodesRef.current.find((node) => node.id === change.id);
      if (!self) return change;
      const { w, h } = sizeOf(self);
      const near = nodesRef.current.filter((node) => node.id !== change.id && node.type !== 'draft' && Math.abs(node.position.x - change.position.x) < 1400 && Math.abs(node.position.y - change.position.y) < 1000);
      const others = near.map((node) => ({ x: node.position.x, y: node.position.y, ...(() => { const s = sizeOf(node); return { w: s.w, h: s.h }; })() }));
      const result = alignmentGuides({ x: change.position.x, y: change.position.y, w, h }, others, SNAP_THRESHOLD / zoom);
      nextGuides = result.guides;
      return { ...change, position: { x: change.position.x + result.dx, y: change.position.y + result.dy } };
    });
    if (dragIds.current.size === 1) setGuides(nextGuides || []);
    commitNodes(applyNodeChanges(adjusted, nodesRef.current));
  }, [flow, commitNodes]);

  const beginDrag = useCallback((_event, _node, dragged) => {
    dragIds.current = new Set(dragged.map((node) => node.id));
    dragStart.current = new Map(dragged.map((node) => [node.id, { ...node.position }]));
  }, []);
  const endDrag = useCallback((_event, _node, dragged) => {
    setGuides([]);
    const changes = dragged.map((node) => ({ id: node.id, before: dragStart.current.get(node.id) || node.position, after: { ...(positionOf(node.id) || node.position) } }));
    dragIds.current = new Set();
    finishMove(changes.length > 1 ? '移动所选节点' : '移动节点', changes);
  }, [finishMove]);

  const selectedSaveable = () => nodesRef.current.filter((node) => node.selected && node.type !== 'draft' && saveableRef.current.has(node.id));

  const select = useCallback((ids) => {
    const wanted = new Set(ids);
    commitNodes(nodesRef.current.map((node) => (node.selected === wanted.has(node.id) ? node : { ...node, selected: wanted.has(node.id) })));
  }, [commitNodes]);

  const focus = useCallback((ids) => { void flow.fitView({ nodes: ids.map((id) => ({ id })), duration: 280, padding: 0.3, maxZoom: 1 }); }, [flow]);

  useEffect(() => {
    actionRef.current = {
      fit: () => flow.fitView({ duration: 250, padding: 0.2, maxZoom: 1.05 }),
      focus,
      focusSelection: () => { const ids = [...selectedIds]; if (ids.length) focus(ids); else void flow.fitView({ duration: 250, padding: 0.2, maxZoom: 1.05 }); },
      zoomIn: () => flow.zoomIn({ duration: 160 }),
      zoomOut: () => flow.zoomOut({ duration: 160 }),
      zoomTo: (zoom) => flow.zoomTo(zoom, { duration: 200 }),
      select,
      selectAll: () => select(displayed.filter((node) => node.type !== 'draft').map((node) => node.id)),
      clearSelection: () => select([]),
      screenToFlow: (point) => flow.screenToFlowPosition(point),
      nudge: (dx, dy) => {
        const targets = selectedSaveable();
        if (!targets.length || !writable) return false;
        if (!nudgeSession.current) nudgeSession.current = { before: new Map(targets.map((node) => [node.id, { ...node.position }])), timer: null };
        const session = nudgeSession.current;
        applyPositions(targets.map((node) => ({ id: node.id, position: { x: node.position.x + dx, y: node.position.y + dy } })));
        saver.current.queue(targets.map((node) => ({ id: node.id, position: positionOf(node.id) })));
        clearTimeout(session.timer);
        session.timer = setTimeout(() => {
          nudgeSession.current = null;
          finishMove('微移节点', [...session.before].map(([id, before]) => ({ id, before, after: { ...positionOf(id) } })));
        }, 500);
        return true;
      },
      align: (mode) => {
        const targets = selectedSaveable();
        const moved = alignBoxes(targets.map((node) => ({ id: node.id, x: node.position.x, y: node.position.y, ...(() => { const s = sizeOf(node); return { w: s.w, h: s.h }; })() })), mode);
        if (!moved.length) return false;
        const changes = moved.map((entry) => ({ id: entry.id, before: { ...positionOf(entry.id) }, after: { x: entry.x, y: entry.y } }));
        applyPositions(changes.map((change) => ({ id: change.id, position: change.after })));
        finishMove('对齐节点', changes);
        return true;
      },
      arrange: () => {
        if (!writable) return false;
        const placed = new Map(autoLayout(graphRef.current.nodes).map((node) => [node.id, node.position]));
        const changes = nodesRef.current.filter((node) => node.type !== 'draft' && placed.has(node.id)).map((node) => ({ id: node.id, before: { ...node.position }, after: placed.get(node.id) }));
        applyPositions(changes.map((change) => ({ id: change.id, position: change.after })));
        finishMove('自动整理', changes);
        requestAnimationFrame(() => { void flow.fitView({ duration: 260, padding: 0.22, maxZoom: 1 }); });
        return true;
      },
      undo: () => { const entry = history.current.undo(); if (!entry) return false; applyPositions(entry.positions); saver.current.queue(entry.positions.filter((p) => saveableRef.current.has(p.id))); reportHistory(); handlers.current.announce?.(`已撤销：${entry.label}`); return true; },
      redo: () => { const entry = history.current.redo(); if (!entry) return false; applyPositions(entry.positions); saver.current.queue(entry.positions.filter((p) => saveableRef.current.has(p.id))); reportHistory(); handlers.current.announce?.(`已重做：${entry.label}`); return true; },
      place: (id, position) => {
        const before = positionOf(id);
        if (!before || !writable || !saveableRef.current.has(id)) return false;
        const after = { x: position.x, y: position.y };
        applyPositions([{ id, position: after }]);
        finishMove('放置新节点', [{ id, before: { ...before }, after }]);
        return true;
      },
      retry: () => saver.current.retry(),
      resolveConflict: (choice) => saver.current.resolveConflict(choice, async () => {
        const latest = await onReload();
        const layout = latest?.canvasLayouts?.find((entry) => entry.projectId === graphRef.current.projectId);
        if (layout) saver.current.setRevision(layout.revision);
      }),
    };
    return () => { actionRef.current = null; };
  });

  const viewportTimer = useRef(null);
  useEffect(() => () => clearTimeout(viewportTimer.current), []);
  const rememberViewport = useCallback((_event, viewport) => {
    clearTimeout(viewportTimer.current);
    viewportTimer.current = setTimeout(() => saveViewport(scope, viewport), 300);
  }, [scope]);

  const lastSelection = useRef([]);
  const reportSelection = useCallback(({ nodes: picked }) => {
    const ids = picked.filter((node) => node.type !== 'draft').map((node) => node.id);
    if (sameIds(ids, lastSelection.current)) return;
    lastSelection.current = ids;
    handlers.current.onSelectionChange(ids);
  }, []);

  const lookup = (id) => nodesRef.current.find((node) => node.id === id)?.data?.item;
  const isValidConnection = useCallback((connection) => connectionRule(lookup(connection.source), lookup(connection.target), graphRef.current.edges).ok, []);
  const connect = useCallback((connection) => {
    const source = lookup(connection.source);
    const target = lookup(connection.target);
    const verdict = connectionRule(source, target, graphRef.current.edges);
    if (verdict.ok) onConnectNodes(source, target, verdict.rule);
  }, [onConnectNodes]);
  const endConnect = useCallback((event, state) => {
    if (state.isValid) return;
    const source = state.fromNode?.data?.item;
    if (!source) return;
    if (state.toNode && !state.toNode.data?.draft) {
      const verdict = connectionRule(source, state.toNode.data.item, graphRef.current.edges);
      if (!verdict.ok) onConnectRefused(verdict.reason);
      return;
    }
    if (state.toNode) return;
    const point = event.changedTouches?.[0] || event;
    const client = { x: point.clientX, y: point.clientY };
    onConnectDrop({ source, client, position: flow.screenToFlowPosition(client) });
  }, [flow, onConnectDrop, onConnectRefused]);

  const doubleClick = useCallback((event) => {
    if (!event.target.classList?.contains('react-flow__pane')) return;
    const client = { x: event.clientX, y: event.clientY };
    onPaneDoubleClick({ client, position: flow.screenToFlowPosition(client) });
  }, [flow, onPaneDoubleClick]);

  const keyDown = useCallback((event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const holder = event.target.closest?.('.react-flow__node');
    const id = holder?.getAttribute('data-id');
    if (!id || id.startsWith('draft:')) return;
    event.preventDefault();
    select([id]);
    onOpenNode(id);
  }, [select, onOpenNode]);

  const hand = tool === 'hand';
  return (
    <>
      <EdgeMarkers />
      <ReactFlow
        nodes={displayed} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange} onSelectionChange={reportSelection}
        onNodeClick={(event, node) => {
          if (node.type === 'draft' || event.shiftKey || event.metaKey || event.ctrlKey) return;
          if (!selectedIds.has(node.id) || selectedIds.size > 1) select([node.id]);
        }}
        onEdgeClick={(_, edge) => onSelectEdge(edge.id)}
        onPaneClick={() => { onSelectEdge(null); }}
        onNodeDoubleClick={(_, node) => { if (node.type !== 'draft') void flow.fitView({ nodes: [{ id: node.id }], duration: 220, padding: 1, maxZoom: 1.1 }); }}
        onNodeDragStart={beginDrag} onNodeDragStop={endDrag} onSelectionDragStart={beginDrag} onSelectionDragStop={endDrag}
        onConnect={connect} onConnectEnd={endConnect} isValidConnection={isValidConnection} connectionLineComponent={ConnectionLine} connectionRadius={28}
        onMoveEnd={rememberViewport} onDoubleClick={doubleClick} onKeyDown={keyDown}
        defaultViewport={startingViewport} minZoom={0.1} maxZoom={4}
        nodesDraggable={writable} nodesConnectable edgesReconnectable={false} nodesFocusable edgesFocusable={false} disableKeyboardA11y
        panOnDrag={hand ? true : [1, 2]} selectionOnDrag={!hand} selectionMode={SelectionMode.Partial} panOnScroll zoomOnScroll={false} zoomOnDoubleClick={false}
        panActivationKeyCode="Space" multiSelectionKeyCode={['Shift', 'Meta', 'Control']} deleteKeyCode={null}
        snapToGrid snapGrid={[GRID, GRID]} autoPanOnNodeDrag elevateNodesOnSelect onlyRenderVisibleElements={nodes.length > LARGE_GRAPH}
        proOptions={{ hideAttribution: true }} className={`cn-flow${hand ? ' cn-tool-hand' : ''}${inspectorOpen ? ' cn-inspector-open' : ''}`} aria-label="海外销售协作网络无限画布"
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.4} />
        {showMap && <MiniMap position="bottom-right" nodeColor={miniMapColor} nodeStrokeWidth={0} pannable zoomable ariaLabel="网络导航缩略图" />}
        {guides.length > 0 && (
          <ViewportPortal>
            <svg className="cn-guides" aria-hidden="true">
              {guides.map((guide) => (guide.axis === 'x'
                ? <line key={`x${guide.position}`} x1={guide.position} x2={guide.position} y1={guide.start - 32} y2={guide.end + 32} />
                : <line key={`y${guide.position}`} y1={guide.position} y2={guide.position} x1={guide.start - 32} x2={guide.end + 32} />))}
            </svg>
          </ViewportPortal>
        )}
      </ReactFlow>
    </>
  );
}
