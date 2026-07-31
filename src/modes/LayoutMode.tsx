import { useRef, useState, type ReactNode } from 'react';
import { useGestures } from '../gesture/GestureProvider';
import { useHandEvents } from '../gesture/useHandEvents';
import type { Point } from '../gesture/types';
import './LayoutMode.css';

type BlockType =
  | 'navbar'
  | 'hero'
  | 'card'
  | 'button'
  | 'image'
  | 'text'
  | 'footer';

interface Block {
  id: number;
  type: BlockType;
  x: number;
  y: number;
}

interface DragState {
  id: number;
  /** Offset from cursor (container-local) to the block's top-left corner. */
  offX: number;
  offY: number;
  /** True when the block was just spawned from the shelf (drop on shelf = cancel). */
  fromShelf: boolean;
  /** Position when the grab started, for reverting existing blocks dropped on the shelf. */
  origX: number;
  origY: number;
}

const BLOCK_DEFS: Record<BlockType, { label: string; w: number; h: number }> = {
  navbar: { label: 'Navbar', w: 280, h: 40 },
  hero: { label: 'Hero', w: 280, h: 130 },
  card: { label: 'Card', w: 130, h: 150 },
  button: { label: 'Button', w: 104, h: 36 },
  image: { label: 'Image', w: 130, h: 96 },
  text: { label: 'Text', w: 170, h: 84 },
  footer: { label: 'Footer', w: 280, h: 36 },
};

const SHELF_TYPES: BlockType[] = [
  'navbar',
  'hero',
  'card',
  'button',
  'image',
  'text',
  'footer',
];

const GRID = 8;

const snap = (v: number) => Math.round(v / GRID) * GRID;
const clamp = (v: number, min: number, max: number) =>
  Math.min(Math.max(v, min), Math.max(min, max));

function ptInRect(rect: DOMRect, p: Point): boolean {
  return p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom;
}

/** Wireframe interior of a block. Styled entirely by .lm-face-<type> CSS. */
function faceEls(type: BlockType): ReactNode {
  switch (type) {
    case 'navbar':
      return (
        <>
          <b />
          <i />
          <i />
          <i />
        </>
      );
    case 'hero':
      return (
        <>
          <i />
          <i />
          <b />
        </>
      );
    case 'card':
      return (
        <>
          <b />
          <i />
          <i />
        </>
      );
    case 'button':
      return <i />;
    case 'image':
      return <b />;
    case 'text':
      return (
        <>
          <i />
          <i />
          <i />
          <i />
        </>
      );
    case 'footer':
      return (
        <>
          <i />
          <i />
          <i />
        </>
      );
    default:
      return null;
  }
}

export default function LayoutMode() {
  const { frame } = useGestures();
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [trashFlash, setTrashFlash] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const shelfRef = useRef<HTMLDivElement | null>(null);
  const trashRef = useRef<HTMLDivElement | null>(null);
  const chipRefs = useRef<Partial<Record<BlockType, HTMLDivElement | null>>>({});
  /** Active drags, keyed by handIndex — up to two hands can drag simultaneously. */
  const dragsRef = useRef<Map<number, DragState>>(new Map());
  const nextIdRef = useRef(1);
  const trashTimerRef = useRef(0);

  const toLocal = (p: Point): Point | null => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: p.x - rect.left, y: p.y - rect.top };
  };

  const flashTrash = () => {
    setTrashFlash(false);
    window.clearTimeout(trashTimerRef.current);
    // Restart the CSS animation on the next tick even if it's mid-flight.
    trashTimerRef.current = window.setTimeout(() => {
      setTrashFlash(true);
      trashTimerRef.current = window.setTimeout(() => setTrashFlash(false), 400);
    }, 16);
  };

  useHandEvents({
    onPinchStart: (handIndex, at) => {
      const local = toLocal(at);
      if (!local) return;

      // 1) Pinch on a shelf chip → spawn a fresh block attached to this hand.
      for (const type of SHELF_TYPES) {
        const el = chipRefs.current[type];
        if (el && ptInRect(el.getBoundingClientRect(), at)) {
          const def = BLOCK_DEFS[type];
          const id = nextIdRef.current++;
          const x = local.x - def.w / 2;
          const y = local.y - def.h / 2;
          dragsRef.current.set(handIndex, {
            id,
            offX: -def.w / 2,
            offY: -def.h / 2,
            fromShelf: true,
            origX: x,
            origY: y,
          });
          setBlocks((bs) => [...bs, { id, type, x, y }]);
          return;
        }
      }

      // 2) Pinch on an existing canvas block → grab it (topmost wins,
      //    blocks held by the other hand are skipped).
      const held = new Set([...dragsRef.current.values()].map((d) => d.id));
      for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i];
        if (held.has(b.id)) continue;
        const def = BLOCK_DEFS[b.type];
        if (
          local.x >= b.x &&
          local.x <= b.x + def.w &&
          local.y >= b.y &&
          local.y <= b.y + def.h
        ) {
          dragsRef.current.set(handIndex, {
            id: b.id,
            offX: b.x - local.x,
            offY: b.y - local.y,
            fromShelf: false,
            origX: b.x,
            origY: b.y,
          });
          return;
        }
      }
    },

    onPinchMove: (handIndex, at) => {
      const drag = dragsRef.current.get(handIndex);
      if (!drag) return;
      const local = toLocal(at);
      if (!local) return;
      setBlocks((bs) =>
        bs.map((b) =>
          b.id === drag.id
            ? { ...b, x: local.x + drag.offX, y: local.y + drag.offY }
            : b,
        ),
      );
    },

    onPinchEnd: (handIndex, at) => {
      const drag = dragsRef.current.get(handIndex);
      if (!drag) return;
      dragsRef.current.delete(handIndex);

      // at is (-1,-1) when the hand vanished mid-pinch; skip zone tests then.
      const trashRect = trashRef.current?.getBoundingClientRect();
      const shelfRect = shelfRef.current?.getBoundingClientRect();
      const overTrash = at.x >= 0 && !!trashRect && ptInRect(trashRect, at);
      const overShelf = at.x >= 0 && !!shelfRect && ptInRect(shelfRect, at);

      if (overTrash || (overShelf && drag.fromShelf)) {
        // Delete (trash) or cancel the spawn (back on the shelf).
        setBlocks((bs) => bs.filter((b) => b.id !== drag.id));
        if (overTrash) flashTrash();
        return;
      }

      if (overShelf) {
        // Existing block dropped on the shelf: send it back where it was.
        setBlocks((bs) =>
          bs.map((b) =>
            b.id === drag.id ? { ...b, x: drag.origX, y: drag.origY } : b,
          ),
        );
        return;
      }

      // Normal drop: snap to the 8px grid, keep it on the canvas and clear of the shelf.
      const rect = containerRef.current?.getBoundingClientRect();
      const minX = rect && shelfRect ? snap(shelfRect.right - rect.left + GRID) : 0;
      setBlocks((bs) =>
        bs.map((b) => {
          if (b.id !== drag.id) return b;
          const def = BLOCK_DEFS[b.type];
          const maxX = rect ? rect.width - def.w : Number.MAX_SAFE_INTEGER;
          const maxY = rect ? rect.height - def.h : Number.MAX_SAFE_INTEGER;
          return {
            ...b,
            x: clamp(snap(b.x), minX, snap(maxX)),
            y: clamp(snap(b.y), 0, snap(maxY)),
          };
        }),
      );
    },
  });

  // ---- Per-frame derived UI state (this component re-renders every gesture frame).
  const rect = containerRef.current?.getBoundingClientRect();
  const heldIds = new Set([...dragsRef.current.values()].map((d) => d.id));
  const hoveredIds = new Set<number>();
  const hotChips = new Set<BlockType>();
  let trashHot = false;

  if (rect) {
    frame.hands.forEach((hand, i) => {
      if (hand.pinch) {
        const drag = dragsRef.current.get(i);
        if (drag) {
          const trashRect = trashRef.current?.getBoundingClientRect();
          if (trashRect && ptInRect(trashRect, hand.cursor)) trashHot = true;
        }
        return;
      }
      // Idle hand: highlight the topmost block (or shelf chip) it could grab.
      const lx = hand.cursor.x - rect.left;
      const ly = hand.cursor.y - rect.top;
      for (let j = blocks.length - 1; j >= 0; j--) {
        const b = blocks[j];
        if (heldIds.has(b.id)) continue;
        const def = BLOCK_DEFS[b.type];
        if (lx >= b.x && lx <= b.x + def.w && ly >= b.y && ly <= b.y + def.h) {
          hoveredIds.add(b.id);
          break;
        }
      }
      for (const type of SHELF_TYPES) {
        const el = chipRefs.current[type];
        if (el && ptInRect(el.getBoundingClientRect(), hand.cursor)) {
          hotChips.add(type);
          break;
        }
      }
    });
  }

  return (
    <div className="lm-root" ref={containerRef}>
      {blocks.length === 0 && (
        <div className="lm-empty">
          <span className="lm-empty-glyph">⌖</span>
          Pinch a block from the shelf and drop it on the canvas
        </div>
      )}

      <div className="lm-shelf" ref={shelfRef}>
        <div className="lm-shelf-title">Blocks</div>
        {SHELF_TYPES.map((type) => (
          <div
            key={type}
            className={`lm-chip${hotChips.has(type) ? ' lm-chip-hot' : ''}`}
            data-testid={`lm-shelf-${type}`}
            ref={(el) => {
              chipRefs.current[type] = el;
            }}
          >
            <div className={`lm-chip-thumb lm-face lm-face-${type}`}>
              {faceEls(type)}
            </div>
            <span className="lm-chip-label">{BLOCK_DEFS[type].label}</span>
          </div>
        ))}
      </div>

      {blocks.map((b) => {
        const def = BLOCK_DEFS[b.type];
        const dragging = heldIds.has(b.id);
        const hovered = !dragging && hoveredIds.has(b.id);
        return (
          <div
            key={b.id}
            data-testid="lm-block"
            data-block-type={b.type}
            className={`lm-block lm-block-${b.type}${dragging ? ' lm-dragging' : ''}${hovered ? ' lm-hover' : ''}`}
            style={{
              width: def.w,
              height: def.h,
              transform: `translate(${b.x}px, ${b.y}px)`,
            }}
          >
            <div className={`lm-face lm-face-${b.type}`}>{faceEls(b.type)}</div>
          </div>
        );
      })}

      <div
        className={`lm-trash${trashHot ? ' lm-trash-hot' : ''}${trashFlash ? ' lm-trash-flash' : ''}`}
        data-testid="lm-trash"
        ref={trashRef}
      >
        <span className="lm-trash-glyph">✕</span>
        <span className="lm-trash-label">trash</span>
      </div>
    </div>
  );
}
