import { useEffect, useRef } from 'react';
import { toMermaid } from '../core/export.ts';
import * as m from '../core/mutations.ts';
import { guessType } from './shapes.ts';
import { readSource } from './transfer.ts';
import type { useDesignStore } from './use-design-store.ts';

/** Marks clipboard content copied from this sheet. */
const CLIP_MIME = 'application/x-system-design';
/** Where typing goes rather than to the sheet. */
export const TEXT_ENTRY = 'input, textarea, [role="combobox"], [contenteditable]';

type Options = {
  store: Pick<ReturnType<typeof useDesignStore>, 'design' | 'designRef' | 'change'>;
  /** No dialog or presentation is keeping the sheet from taking the clipboard. */
  active: boolean;
  stepId: string | undefined;
  /** The ids a copy, cut or delete acts on. */
  selectedIds: () => string[];
  remove: (ids: string[]) => void;
  selectPasted: (ids: string[]) => void;
  showImported: (index: number) => void;
  setError: (message: string | null) => void;
};

/** Copy, cut and paste on the sheet, and bringing in diagrams and infrastructure files from elsewhere. */
export function useClipboard({ store: { design, designRef, change }, active, stepId, selectedIds, remove, selectPasted, showImported, setError }: Options) {
  const clip = useRef<{ items: m.Clip; pastes: number } | null>(null);
  /** The text last copied from this sheet: Firefox drops the custom type, so this is how a paste knows it as ours. */
  const copiedText = useRef<string | null>(null);
  /** A copy, cut or paste key still waiting for its clipboard event. */
  const clipKey = useRef<string | null>(null);

  const pasteClip = (c: { items: m.Clip; pastes: number }) => {
    if (!stepId) return;
    c.pastes++;
    let ids: string[] = [];
    change((d) => {
      ids = m.pasteItems(d, c.items, { step: stepId, offset: 40 * c.pastes });
    });
    selectPasted(ids);
  };
  const copy = () => {
    const d = designRef.current, ids = selectedIds();
    if (!d || !ids.length) return false;
    clip.current = { items: m.copyItems(d, ids), pastes: 0 };
    return true;
  };
  const cut = () => remove(selectedIds());
  const duplicate = () => {
    const d = designRef.current, ids = selectedIds();
    if (d && ids.length) pasteClip({ items: m.copyItems(d, ids), pastes: 0 });
  };

  /** Ctrl+C, X or V: the browser follows with a clipboard event (so text travels to and from other apps); where none comes, the key acts on the sheet's own clipboard. */
  const onClipKey = (key: string) => {
    clipKey.current = key;
    setTimeout(() => {
      if (clipKey.current !== key) return;
      clipKey.current = null;
      if (key === 'v') return void (clip.current && pasteClip(clip.current));
      if (copy() && key === 'x') cut();
    });
  };

  /** Adds a pasted or dropped diagram or infrastructure file to the design as a new step, and shows that step. */
  const importSource = async (raw: string, what: string) => {
    const read = await readSource(raw, what);
    if (typeof read === 'string') return setError(read);
    const before = designRef.current?.steps.length ?? 0;
    change((d) => void read.importAsStep(d, read.text, { seen: true, guess: guessType, plugin: read.plugin }));
    const after = designRef.current?.steps.length ?? 0;
    if (after > before) showImported(after - 1);
  };

  // Copied parts go to the clipboard as a Mermaid flowchart for other apps, marked so a paste here keeps every detail.
  // A pasted diagram or infrastructure file (Mermaid, C4-PlantUML, compose, Kubernetes, Terraform, traces) becomes a new step.
  useEffect(() => {
    const ignore = (e: ClipboardEvent) => !active || !design || !!(e.target as HTMLElement).closest?.(TEXT_ENTRY);
    const onCopy = (e: ClipboardEvent) => {
      clipKey.current = null;
      if (ignore(e) || window.getSelection()?.toString() || !copy()) return;
      const c = clip.current!.items, inside = new Set(c.boundaries.map((b) => b.id));
      const text = toMermaid({
        ...design!,
        ...c,
        components: c.components.map((x) => (x.boundary && inside.has(x.boundary) ? x : { ...x, boundary: undefined })),
        boundaries: c.boundaries.map((b) => (b.parent && inside.has(b.parent) ? b : { ...b, parent: undefined })),
      });
      copiedText.current = text;
      e.clipboardData?.setData('text/plain', text);
      e.clipboardData?.setData(CLIP_MIME, '1');
      e.preventDefault();
      if (e.type === 'cut') cut();
    };
    const onPaste = async (e: ClipboardEvent) => {
      clipKey.current = null;
      if (ignore(e) || !stepId) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const ours = e.clipboardData?.types.includes(CLIP_MIME) || text === copiedText.current;
      e.preventDefault();
      if (ours || !text.trim()) return void (clip.current && pasteClip(clip.current));
      await importSource(text, 'paste');
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCopy);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCopy);
      document.removeEventListener('paste', onPaste);
    };
  });

  return { duplicate, onClipKey, importSource };
}
