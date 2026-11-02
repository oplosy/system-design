import { useEffect, useState } from 'react';
import type { Theme } from './format.ts';


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
    return localStorage.getItem('sd-style') === 'sketch';
  } catch {
    return false;
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

/** Whether the overview map is shown, remembered. Off until asked for. */
export function useMinimap() {
  const [minimap, setMinimapState] = useState(() => {
    try {
      return localStorage.getItem('sd-minimap') === 'on';
    } catch {
      return false;
    }
  });
  const setMinimap = (on: boolean) => {
    setMinimapState(on);
    remember('sd-minimap', on ? 'on' : 'off');
  };
  return [minimap, setMinimap] as const;
}
