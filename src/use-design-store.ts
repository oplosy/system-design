import { useCallback, useRef, useState } from 'react';
import { mergeDesigns } from '../core/merge.ts';
import type { Design } from '../core/schema.ts';
import { ApiError, api } from './api.ts';
import { errorText } from './format.ts';

/** The open design, its undo history and the delayed save. `setError` shows what went wrong. */
export function useDesignStore(setError: (message: string | null) => void) {
  const [design, setDesign] = useState<Design | null>(null);
  const designRef = useRef<Design | null>(null);
  const saveState = useRef({ timer: undefined as number | undefined, pending: false, inFlight: false, dirty: false });
  // Undo history of whole designs. It restarts whenever the design is replaced from disk.
  const hist = useRef({ past: [] as Design[], future: [] as Design[], at: 0 });
  // The design as last loaded or saved: what local edits are replayed from when a save meets a newer file.
  const baseRef = useRef<Design | null>(null);
  const commit = useCallback((d: Design | null, { fresh = false } = {}) => {
    designRef.current = d;
    setDesign(d);
    if (fresh) {
      hist.current = { past: [], future: [], at: 0 };
      baseRef.current = d;
    }
  }, []);

  const flush = useCallback(async () => {
    const s = saveState.current;
    s.pending = false;
    if (s.inFlight) {
      s.dirty = true;
      return;
    }
    const d = designRef.current;
    if (!d) return;
    s.inFlight = true;
    try {
      const saved = await api.save(d);
      baseRef.current = saved;
      if (designRef.current?.id === saved.id) commit({ ...designRef.current, rev: saved.rev });
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Someone (usually an agent) wrote meanwhile: replay the edits since the last save onto their version.
        const theirs = await api.get(d.id);
        const base = baseRef.current;
        const result = base?.id === d.id ? mergeDesigns(base, designRef.current?.id === d.id ? designRef.current : d, theirs) : undefined;
        if (result) {
          baseRef.current = theirs;
          commit(result.merged);
          s.dirty = true;
          setError(result.clashes.length ? `This design changed on disk while you edited; your edits were kept on top (overrode: ${result.clashes.join(', ')}).` : null);
        } else {
          s.dirty = false;
          commit(theirs, { fresh: true });
          setError('This design changed on disk (probably an agent) in a way your last edit can’t be merged into, so it was reloaded and that edit dropped.');
        }
      } else setError(errorText(e));
    } finally {
      s.inFlight = false;
      if (s.dirty) {
        s.dirty = false;
        void flush();
      }
    }
  }, [commit]);

  const schedule = useCallback(() => {
    const s = saveState.current;
    clearTimeout(s.timer);
    s.pending = true;
    s.timer = window.setTimeout(flush, 350);
  }, [flush]);

  /** Applies an edit locally right away and saves shortly after. `record: false` keeps it out of undo (automatic layout). */
  const change = useCallback(
    (fn: (d: Design) => void, { record = true } = {}) => {
      const cur = designRef.current;
      if (!cur) return;
      const next = structuredClone(cur);
      try {
        fn(next);
      } catch (e) {
        setError(errorText(e));
        return;
      }
      if (record) {
        const h = hist.current, now = Date.now();
        // Edits in quick succession (typing, one drag) undo as one.
        if (now - h.at > 600) h.past = [...h.past.slice(-99), cur];
        h.at = now;
        h.future = [];
      }
      commit(next);
      schedule();
    },
    [commit, schedule],
  );

  const undo = (back: boolean) => {
    const h = hist.current, cur = designRef.current;
    const from = back ? h.past : h.future;
    if (!cur || !from.length) return false;
    (back ? h.future : h.past).push(cur);
    const snap = from.pop()!;
    h.at = 0;
    // Keep the newest revision so the save is not taken for a stale write.
    commit({ ...snap, rev: cur.rev });
    schedule();
    return true;
  };

  /** Saves a pending edit now, so switching designs cannot drop it. */
  const settle = async () => {
    clearTimeout(saveState.current.timer);
    if (saveState.current.pending) await flush();
  };

  return { design, designRef, saveState, hist, commit, flush, change, undo, settle };
}
