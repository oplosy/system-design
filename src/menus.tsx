import { useCallback, useEffect, useRef, useState } from 'react';
import { type Design } from '../core/schema.ts';
import { shared } from './api.ts';
import { LAYOUTS, type LayoutKind } from './layout.ts';
import { type Editing, type Theme } from './format.ts';

export function useDismiss(active: boolean, onDismiss: () => void, ref?: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onDismiss();
    const onDown = (e: MouseEvent) => ref?.current && !ref.current.contains(e.target as HTMLElement) && onDismiss();
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [active, onDismiss, ref]);
}

/** Text box over the canvas for renaming in place. Enter or leaving it saves; Esc cancels; Shift+Enter adds a line. */
export function InlineEdit({ at, value, multiline, onDone }: Editing & { onDone: (value: string | null) => void }) {
  const [v, setV] = useState(value);
  const done = useRef(false);
  const finish = (x: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(x);
  };
  const props = {
    autoFocus: true,
    value: v,
    'aria-label': 'Edit text',
    className: 'inline-edit nodrag nopan nowheel',
    style: { transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV(e.target.value),
    onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => e.currentTarget.select(),
    onBlur: () => finish(v),
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') finish(null);
      else if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
        e.preventDefault();
        finish(v);
      }
    },
  };
  return multiline ? <textarea rows={4} {...props} /> : <input {...props} />;
}

function Seg<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: readonly { key: T; title: string }[]; onPick: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} role="radio" aria-checked={value === o.key} onClick={() => onPick(o.key)}>
          {o.title}
        </button>
      ))}
    </div>
  );
}

