import { useEffect, type RefObject } from 'react';
import { useReactFlow } from '@xyflow/react';

/** Where the stylesheet puts the selected item's card at the bottom of the window instead of beside the sheet. */
const PHONE = '(max-width: 640px)';
/** Room the top bar takes. */
const TOP = 60;

/**
 * On a phone the selected item's card covers the lower part of the sheet. When it would hide the item it is about,
 * the sheet moves up so the item sits in the middle of what is left above the card.
 */
export function useCardReveal(selected: string | null, canvasRef: RefObject<HTMLDivElement | null>, cardRef: RefObject<HTMLDivElement | null>) {
  const { getViewport, setViewport } = useReactFlow();
  useEffect(() => {
    if (!selected || !matchMedia(PHONE).matches) return;
    // The card lays out and the item is drawn selected a frame later.
    const t = setTimeout(() => {
      const card = cardRef.current?.getBoundingClientRect();
      const item = canvasRef.current?.querySelector(`[data-id="${CSS.escape(selected)}"]`)?.getBoundingClientRect();
      if (!card || !item || (item.top >= TOP && item.bottom <= card.top)) return;
      const shift = (TOP + card.top) / 2 - (item.top + item.bottom) / 2;
      const v = getViewport();
      void setViewport({ ...v, y: v.y + shift }, { duration: 300 });
    }, 60);
    return () => clearTimeout(t);
  }, [selected, canvasRef, cardRef, getViewport, setViewport]);
}
