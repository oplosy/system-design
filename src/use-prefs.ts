import { useEffect, useState } from 'react';
import type { Theme } from './format.ts';

export type Docks = { left: { open: boolean; w: number }; right: { open: boolean; w: number } };
export const DOCKS: Docks = { left: { open: true, w: 248 }, right: { open: true, w: 352 } };
const DOCK_LIMITS = { left: [200, 420], right: [280, 600] } as const;
/** Gap between a floating panel and the window edge. */
export const GAP = 12;

/** Saves a view preference; blocked storage only loses the convenience. */
function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function loadStyle() {
  try {
    return localStorage.getItem('sd-style') !== 'clean';
  } catch {
    return true;
  }
}

function loadTheme(): Theme {
  try {
    const t = localStorage.getItem('sd-theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

function loadDocks(): Docks {
  try {
    const d = JSON.parse(localStorage.getItem('sd-docks') ?? 'null') as Docks | null;
    const side = (k: keyof Docks) => ({
      open: typeof d?.[k]?.open === 'boolean' ? d[k].open : DOCKS[k].open,
      w: Number.isFinite(d?.[k]?.w) ? Math.min(Math.max(d![k].w, DOCK_LIMITS[k][0]), DOCK_LIMITS[k][1]) : DOCKS[k].w,
    });
    return { left: side('left'), right: side('right') };
  } catch {
    return DOCKS;
  }
}

/** Light, dark or the system's, applied to the page and remembered. */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(loadTheme);
  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);
  const setTheme = (t: Theme) => {
    setThemeState(t);
    remember('sd-theme', t);
  };
  return [theme, setTheme] as const;
}

/** Sketch (hand-drawn) or clean lines, remembered. */
export function useSketch() {
  const [sketch, setSketch] = useState(loadStyle);
  const setStyle = (s: boolean) => {
    setSketch(s);
    remember('sd-style', s ? 'sketch' : 'clean');
  };
  return [sketch, setStyle] as const;
}

/** Whether each side panel is open and how wide, remembered. `inset` is the room a panel takes at that edge of the canvas. */
export function useDocks(presenting: boolean) {
  const [docks, setDocks] = useState<Docks>(loadDocks);
  const updateDocks = (fn: (d: Docks) => Docks) =>
    setDocks((d) => {
      const next = fn(d);
      remember('sd-docks', JSON.stringify(next));
      return next;
    });
  const toggleDock = (k: keyof Docks) => updateDocks((d) => ({ ...d, [k]: { ...d[k], open: !d[k].open } }));
  const resizeDock = (k: keyof Docks, w: number) =>
    updateDocks((d) => ({ ...d, [k]: { ...d[k], w: Math.round(Math.min(Math.max(w, DOCK_LIMITS[k][0]), DOCK_LIMITS[k][1])) } }));
  const inset = (k: keyof Docks) => (docks[k].open && !presenting ? docks[k].w + GAP : 0);
  return { docks, toggleDock, resizeDock, inset };
}
