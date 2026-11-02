
/** A floating side panel; its inner edge drags (or arrow-keys) to resize, double-click resets. */
export function Dock({ side, width, onResize, onReset, children }: { side: 'left' | 'right'; width: number; onResize: (w: number) => void; onReset: () => void; children: React.ReactNode }) {
  const dir = side === 'left' ? 1 : -1;
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget, x0 = e.clientX;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => onResize(width + dir * (ev.clientX - x0));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  return (
    <div className={`dock dock-${side}`} style={{ width }}>
      {children}
      <div
        className="dock-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        aria-valuenow={width}
        tabIndex={0}
        title="Drag to resize, double-click to reset"
        onPointerDown={drag}
        onDoubleClick={onReset}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          onResize(width + (e.key === 'ArrowRight' ? 16 : -16) * dir);
        }}
      />
    </div>
  );
}
