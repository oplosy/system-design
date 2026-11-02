import { useEffect, useRef, type KeyboardEvent } from 'react';

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** What a dialog's overlay needs: Escape closes it, Tab stays inside it, and focus goes back to where it was on closing. */
export function useModal(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    if (!ref.current?.contains(document.activeElement)) ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => before?.focus?.();
  }, []);
  const onKeyDown = (e: KeyboardEvent) => {
    // A field inside that used the key marks it as handled.
    if (e.defaultPrevented) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Tab') {
      const all = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      const at = all.indexOf(document.activeElement as HTMLElement);
      if (at === -1) return;
      const next = e.shiftKey ? (at === 0 ? all.at(-1) : undefined) : at === all.length - 1 ? all[0] : undefined;
      if (next) {
        e.preventDefault();
        next.focus();
      }
    }
  };
  return { ref, onKeyDown };
}
