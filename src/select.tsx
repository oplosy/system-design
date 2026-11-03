import { type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons.tsx';

export type SelectOption<T extends string = string> = { value: T; label: string; group?: string; preview?: ReactNode };

/** Past this many options the list gets a search box. */
const SEARCH_FROM = 9;
const GAP = 6, EDGE = 8, MAX_H = 320;

/** A dropdown drawn by the app, so it matches the menus. It opens in a portal: panels around it clip their overflow. */
export function Select<T extends string>({ value, options, onChange, label, className = 'ed', placeholder }: { value: T; options: SelectOption<T>[]; onChange: (value: T) => void; label: string; className?: string; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const listId = useId();
  const search = options.length >= SEARCH_FROM;
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return options.filter((o) => words.every((w) => `${o.label} ${o.group ?? ''}`.toLowerCase().includes(w)));
  }, [options, query]);
  const chosen = options.find((o) => o.value === value);

  const show = () => {
    setQuery('');
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const hide = (refocus = true) => {
    setOpen(false);
    setPlace(null);
    if (refocus) trigger.current?.focus();
  };
  const pick = (o: SelectOption<T> | undefined) => {
    if (!o) return;
    hide();
    if (o.value !== value) onChange(o.value);
  };

  // Opens below the trigger, or above when that leaves more room.
  const measure = useCallback(() => {
    if (!trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const below = innerHeight - r.bottom - GAP - EDGE, above = r.top - GAP - EDGE;
    const width = Math.min(Math.max(r.width, 200), innerWidth - 2 * EDGE);
    const left = Math.min(Math.max(r.left, EDGE), innerWidth - width - EDGE);
    if (below >= Math.min(MAX_H, above)) setPlace({ left, width, top: r.bottom + GAP, maxHeight: Math.min(MAX_H, below) });
    else setPlace({ left, width, bottom: innerHeight - r.top + GAP, maxHeight: Math.min(MAX_H, above) });
  }, []);
  useLayoutEffect(() => {
    if (open) measure();
  }, [open, measure]);

  const placed = !!place;
  useEffect(() => {
    if (placed) (pop.current?.querySelector<HTMLElement>('input, [role="listbox"]') ?? pop.current)?.focus();
  }, [placed]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the active option moves, or the list is placed or filtered: each is a reason to scroll it into view.
  useLayoutEffect(() => {
    if (open) pop.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, active, placed, query]);

  // While open, every key belongs to the list: the window's shortcuts must not see them.
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      const move = (to: number) => {
        e.preventDefault();
        setActive(Math.min(Math.max(to, 0), shown.length - 1));
      };
      if (e.key === 'Escape') (e.preventDefault(), hide());
      else if (e.key === 'Tab') hide(false);
      else if (e.key === 'ArrowDown') move(active + 1);
      else if (e.key === 'ArrowUp') move(active - 1);
      else if (e.key === 'Home' && !search) move(0);
      else if (e.key === 'End' && !search) move(shown.length - 1);
      else if (e.key === 'PageDown') move(active + 8);
      else if (e.key === 'PageUp') move(active - 8);
      else if (e.key === 'Enter' || (e.key === ' ' && !search)) (e.preventDefault(), pick(shown[active]));
      else if (!search && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        const now = Date.now();
        typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now };
        const hit = shown.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text));
        if (hit >= 0) setActive(hit);
      }
      e.stopPropagation();
    };
    const away = (e: Event) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !trigger.current?.contains(t)) hide(false);
    };
    // The list follows its trigger while a panel behind it scrolls.
    const moved = (e: Event) => {
      if (!pop.current?.contains(e.target as Node)) measure();
    };
    window.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('scroll', moved, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('keydown', key, true);
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('scroll', moved, true);
      window.removeEventListener('resize', measure);
    };
  });

  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        className={`select-trigger ${className}`}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? hide() : show())}
        onKeyDown={(e) => {
          if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
            e.preventDefault();
            show();
          }
        }}
      >
        {chosen?.preview && <span className="select-preview">{chosen.preview}</span>}
        <span className={`select-value${chosen ? '' : ' quiet'}`}>{chosen?.label ?? placeholder}</span>
        <span className="select-chevron">
          <Icon name="down" />
        </span>
      </button>
      {open &&
        createPortal(
          // biome-ignore lint/a11y/noStaticElementInteractions: only keeps a press inside the list from reaching the page behind it.
          <div ref={pop} className="select-pop" tabIndex={-1} onMouseDown={(e) => e.stopPropagation()} style={{ ...(place ?? { left: 0, top: 0, width: 200, maxHeight: MAX_H }), visibility: place ? undefined : 'hidden' }}>
            {search && (
              <div className="select-search">
                <Icon name="find" />
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  placeholder="Search"
                  aria-label={`Search ${label}`}
                  role="combobox"
                  aria-expanded="true"
                  aria-autocomplete="list"
                  aria-controls={listId}
                  aria-activedescendant={shown.length ? `${listId}-${active}` : undefined}
                />
              </div>
            )}
            <div
              id={listId}
              className="select-list"
              role="listbox"
              aria-label={label}
              tabIndex={-1}
              aria-activedescendant={!search && shown.length ? `${listId}-${active}` : undefined}
            >
              {shown.map((o, i) => (
                <div key={o.value} role="none">
                  {o.group && o.group !== shown[i - 1]?.group && (
                    <div className="select-group" role="presentation">
                      {o.group}
                    </div>
                  )}
                  {/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/useFocusableInteractive: focus stays on the search box or the list, which points at the active option; the keys are handled while the list is open. */}
                  <div id={`${listId}-${i}`} className="select-option" role="option" aria-selected={o.value === value} data-active={i === active} onPointerMove={() => i !== active && setActive(i)} onClick={() => pick(o)}>
                    {o.preview && <span className="select-preview">{o.preview}</span>}
                    <span className="select-value">{o.label}</span>
                    {o.value === value && <Icon name="check" />}
                  </div>
                </div>
              ))}
              {!shown.length && <p className="quiet pad">No match</p>}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
