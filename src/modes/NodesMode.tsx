import { useRef, useState } from 'react';
import { useGestures } from '../gesture/GestureProvider';
import { useHandEvents } from '../gesture/useHandEvents';
import type { Point } from '../gesture/types';
import './NodesMode.css';

type NodeKind = 'source' | 'transform' | 'output';
type PortSide = 'in' | 'out';

interface NodeData {
  id: string;
  title: string;
  kind: NodeKind;
  x: number;
  y: number;
}

interface Wire {
  id: string;
  /** Node id on the output side. */
  from: string;
  /** Node id on the input side. */
  to: string;
}

/** Per-hand interaction state, keyed by handIndex. */
type Drag =
  | { kind: 'node'; nodeId: string; dx: number; dy: number }
  | { kind: 'wire'; nodeId: string; side: PortSide }
  | { kind: 'spawn'; nodeKind: NodeKind };

const NODE_W = 168;
const NODE_H = 64;
const PORT_HIT = 18;
const KINDS: NodeKind[] = ['source', 'transform', 'output'];

const KIND_LABEL: Record<NodeKind, string> = {
  source: 'Source',
  transform: 'Transform',
  output: 'Output',
};

const KIND_ACCENT: Record<NodeKind, string> = {
  source: 'var(--teal)',
  transform: 'var(--pink)',
  output: 'var(--amber)',
};

const SEED_NODES: NodeData[] = [
  { id: 'seed-camera', title: 'Camera', kind: 'source', x: 60, y: 110 },
  { id: 'seed-tracker', title: 'Hand Tracker', kind: 'transform', x: 320, y: 200 },
  { id: 'seed-gestures', title: 'Gestures', kind: 'transform', x: 580, y: 110 },
  { id: 'seed-renderer', title: 'Renderer', kind: 'output', x: 580, y: 320 },
  { id: 'seed-canvas', title: 'Canvas', kind: 'output', x: 840, y: 210 },
];

const SEED_WIRES: Wire[] = [
  { id: 'seed-camera->seed-tracker', from: 'seed-camera', to: 'seed-tracker' },
  { id: 'seed-tracker->seed-gestures', from: 'seed-tracker', to: 'seed-gestures' },
  { id: 'seed-gestures->seed-canvas', from: 'seed-gestures', to: 'seed-canvas' },
];

function inRect(el: Element | null, p: Point): boolean {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

function portPos(n: NodeData, side: PortSide): Point {
  return { x: side === 'in' ? n.x : n.x + NODE_W, y: n.y + NODE_H / 2 };
}

function bezier(a: Point, b: Point): string {
  const dx = Math.max(48, Math.abs(b.x - a.x) / 2);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

export default function NodesMode() {
  const { frame } = useGestures();
  const [nodes, setNodes] = useState<NodeData[]>(SEED_NODES);
  const [wires, setWires] = useState<Wire[]>(SEED_WIRES);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const trashRef = useRef<HTMLDivElement | null>(null);
  const chipRefs = useRef<Record<NodeKind, HTMLDivElement | null>>({
    source: null,
    transform: null,
    output: null,
  });
  const dragsRef = useRef(new Map<number, Drag>());
  const spawnCount = useRef<Record<NodeKind, number>>({
    source: 0,
    transform: 0,
    output: 0,
  });

  /** Viewport CSS px -> container-local px. */
  const toLocal = (p: Point): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    return rect ? { x: p.x - rect.left, y: p.y - rect.top } : { x: p.x, y: p.y };
  };

  const clampPos = (p: Point): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return p;
    return {
      x: Math.min(Math.max(p.x, 4), Math.max(4, rect.width - NODE_W - 4)),
      y: Math.min(Math.max(p.y, 4), Math.max(4, rect.height - NODE_H - 4)),
    };
  };

  const nodeAtPoint = (p: Point): NodeData | null => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (p.x >= n.x && p.x <= n.x + NODE_W && p.y >= n.y && p.y <= n.y + NODE_H) {
        return n;
      }
    }
    return null;
  };

  const portAtPoint = (p: Point): { node: NodeData; side: PortSide } | null => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      for (const side of ['out', 'in'] as const) {
        const c = portPos(n, side);
        if (Math.hypot(p.x - c.x, p.y - c.y) <= PORT_HIT) return { node: n, side };
      }
    }
    return null;
  };

  const nodeBusy = (id: string): boolean => {
    for (const d of dragsRef.current.values()) {
      if (d.kind === 'node' && d.nodeId === id) return true;
    }
    return false;
  };

  const spawnNode = (kind: NodeKind, at: Point) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || at.x < 0) return;
    const p = toLocal(at);
    if (p.x < 0 || p.y < 0 || p.x > rect.width || p.y > rect.height) return;
    if (inRect(toolbarRef.current, at) || inRect(trashRef.current, at)) return;
    spawnCount.current[kind] += 1;
    const count = spawnCount.current[kind];
    const pos = clampPos({ x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 });
    setNodes((prev) => [
      ...prev,
      {
        id: `spawn-${kind}-${count}`,
        title: `${KIND_LABEL[kind]} ${count}`,
        kind,
        x: pos.x,
        y: pos.y,
      },
    ]);
  };

  const finishWire = (drag: { nodeId: string; side: PortSide }, at: Point) => {
    const p = toLocal(at);
    const targetSide: PortSide = drag.side === 'out' ? 'in' : 'out';
    let target: NodeData | null = null;
    const port = portAtPoint(p);
    if (port && port.side === targetSide && port.node.id !== drag.nodeId) {
      target = port.node;
    }
    if (!target) {
      const n = nodeAtPoint(p);
      if (n && n.id !== drag.nodeId) target = n;
    }
    if (!target) return;
    const from = drag.side === 'out' ? drag.nodeId : target.id;
    const to = drag.side === 'out' ? target.id : drag.nodeId;
    if (from === to) return;
    setWires((prev) =>
      prev.some((w) => w.from === from && w.to === to)
        ? prev
        : [...prev, { id: `${from}->${to}`, from, to }],
    );
  };

  useHandEvents({
    onPinchStart: (handIndex, at) => {
      // Toolbar chips first (viewport-space DOM hit test).
      for (const kind of KINDS) {
        if (inRect(chipRefs.current[kind], at)) {
          dragsRef.current.set(handIndex, { kind: 'spawn', nodeKind: kind });
          return;
        }
      }
      const p = toLocal(at);
      const port = portAtPoint(p);
      if (port) {
        dragsRef.current.set(handIndex, {
          kind: 'wire',
          nodeId: port.node.id,
          side: port.side,
        });
        return;
      }
      const n = nodeAtPoint(p);
      if (n && !nodeBusy(n.id)) {
        dragsRef.current.set(handIndex, {
          kind: 'node',
          nodeId: n.id,
          dx: p.x - n.x,
          dy: p.y - n.y,
        });
        // Bring the grabbed node to the front.
        setNodes((prev) => {
          const grabbed = prev.find((x) => x.id === n.id);
          return grabbed ? [...prev.filter((x) => x.id !== n.id), grabbed] : prev;
        });
      }
    },
    onPinchMove: (handIndex, at) => {
      const d = dragsRef.current.get(handIndex);
      if (d?.kind !== 'node') return;
      const p = toLocal(at);
      const pos = clampPos({ x: p.x - d.dx, y: p.y - d.dy });
      setNodes((prev) =>
        prev.map((n) => (n.id === d.nodeId ? { ...n, x: pos.x, y: pos.y } : n)),
      );
    },
    onPinchEnd: (handIndex, at) => {
      const d = dragsRef.current.get(handIndex);
      dragsRef.current.delete(handIndex);
      if (!d) return;
      if (d.kind === 'node') {
        if (inRect(trashRef.current, at)) {
          setNodes((prev) => prev.filter((n) => n.id !== d.nodeId));
          setWires((prev) =>
            prev.filter((w) => w.from !== d.nodeId && w.to !== d.nodeId),
          );
        }
        return;
      }
      if (d.kind === 'spawn') {
        spawnNode(d.nodeKind, at);
        return;
      }
      finishWire(d, at);
    },
  });

  // ---- Per-frame derived render state (hover, ghosts) ----------------------
  const hoverNodeIds = new Set<string>();
  const hoverPorts = new Set<string>();
  const hoverChips = new Set<NodeKind>();
  const draggingNodeIds = new Set<string>();
  const grabbedChips = new Set<NodeKind>();
  let trashHot = false;

  const ghostWires: Array<{ key: string; d: string; color: string }> = [];
  const ghostNodes: Array<{ key: string; kind: NodeKind; x: number; y: number }> = [];

  frame.hands.forEach((hand, i) => {
    const drag = dragsRef.current.get(i);
    const local = toLocal(hand.cursor);

    if (drag?.kind === 'node') {
      draggingNodeIds.add(drag.nodeId);
      if (inRect(trashRef.current, hand.cursor)) trashHot = true;
      return;
    }
    if (drag?.kind === 'spawn') {
      grabbedChips.add(drag.nodeKind);
      ghostNodes.push({ key: `ghost-${i}`, kind: drag.nodeKind, x: local.x, y: local.y });
      return;
    }
    if (drag?.kind === 'wire') {
      const src = nodes.find((n) => n.id === drag.nodeId);
      if (src) {
        const a = portPos(src, drag.side);
        ghostWires.push({
          key: `wire-${i}`,
          d: drag.side === 'out' ? bezier(a, local) : bezier(local, a),
          color: KIND_ACCENT[src.kind],
        });
        hoverPorts.add(`${src.id}:${drag.side}`);
        // Highlight the drop target under the cursor.
        const targetSide: PortSide = drag.side === 'out' ? 'in' : 'out';
        const port = portAtPoint(local);
        if (port && port.side === targetSide && port.node.id !== drag.nodeId) {
          hoverPorts.add(`${port.node.id}:${port.side}`);
          hoverNodeIds.add(port.node.id);
        } else {
          const n = nodeAtPoint(local);
          if (n && n.id !== drag.nodeId) hoverNodeIds.add(n.id);
        }
      }
      return;
    }

    // No drag: plain hover highlighting.
    for (const kind of KINDS) {
      if (inRect(chipRefs.current[kind], hand.cursor)) hoverChips.add(kind);
    }
    const port = portAtPoint(local);
    if (port) {
      hoverPorts.add(`${port.node.id}:${port.side}`);
      hoverNodeIds.add(port.node.id);
      return;
    }
    const n = nodeAtPoint(local);
    if (n) hoverNodeIds.add(n.id);
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div className="nm-root" ref={containerRef}>
      <svg className="nm-wires">
        {wires.map((w) => {
          const a = byId.get(w.from);
          const b = byId.get(w.to);
          if (!a || !b) return null;
          const d = bezier(portPos(a, 'out'), portPos(b, 'in'));
          return (
            <g key={w.id} className="nm-wire-group" style={{ color: KIND_ACCENT[a.kind] }}>
              <path className="nm-wire-glow" d={d} />
              <path className="nm-wire" data-testid="nm-wire" d={d} />
            </g>
          );
        })}
        {ghostWires.map((g) => (
          <g key={g.key} className="nm-wire-group" style={{ color: g.color }}>
            <path className="nm-wire-glow" d={g.d} />
            <path className="nm-wire nm-wire-ghost" d={g.d} />
          </g>
        ))}
      </svg>

      {nodes.map((n) => (
        <div
          key={n.id}
          data-testid="nm-node"
          className={[
            'nm-node',
            `nm-kind-${n.kind}`,
            hoverNodeIds.has(n.id) ? 'nm-hover' : '',
            draggingNodeIds.has(n.id) ? 'nm-dragging' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
        >
          <span className="nm-node-title">{n.title}</span>
          <span className="nm-node-kind">{KIND_LABEL[n.kind]}</span>
          <span
            data-testid="nm-port-in"
            className={`nm-port nm-port-in ${hoverPorts.has(`${n.id}:in`) ? 'nm-hover' : ''}`}
          />
          <span
            data-testid="nm-port-out"
            className={`nm-port nm-port-out ${hoverPorts.has(`${n.id}:out`) ? 'nm-hover' : ''}`}
          />
        </div>
      ))}

      {ghostNodes.map((g) => (
        <div
          key={g.key}
          className={`nm-ghost-node nm-kind-${g.kind}`}
          style={{ left: g.x, top: g.y }}
        >
          {KIND_LABEL[g.kind]}
        </div>
      ))}

      <div className="nm-toolbar" ref={toolbarRef}>
        <span className="nm-toolbar-label">+ Node</span>
        {KINDS.map((kind) => (
          <div
            key={kind}
            ref={(el) => {
              chipRefs.current[kind] = el;
            }}
            data-testid={`nm-add-${kind}`}
            className={[
              'nm-chip',
              `nm-kind-${kind}`,
              hoverChips.has(kind) ? 'nm-hover' : '',
              grabbedChips.has(kind) ? 'nm-grabbed' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span className="nm-chip-dot" />
            {KIND_LABEL[kind]}
          </div>
        ))}
      </div>

      <div
        ref={trashRef}
        data-testid="nm-trash"
        className={`nm-trash ${trashHot ? 'nm-hot' : ''}`}
      >
        <span className="nm-trash-icon">✕</span>
        <span>Trash</span>
      </div>
    </div>
  );
}
