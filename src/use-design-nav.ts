import { useCallback, useEffect, useRef, useState } from 'react';
import * as m from '../core/mutations.ts';
import type { Design } from '../core/schema.ts';
import { ApiError, api, shared, type Summary } from './api.ts';
import { errorText } from './format.ts';
import type { useDesignStore } from './use-design-store.ts';

/** A link into the app: #<design>, or #<design>/<item> for a step, part, line or any other item in it. */
function readHash() {
  const [design, item] = location.hash.slice(1).split('/').map((x) => decodeURIComponent(x));
  return { design: design || null, item: item || null };
}

type Options = {
  store: ReturnType<typeof useDesignStore>;
  selected: string | null;
  setSelected: (id: string | null) => void;
  setError: (message: string | null) => void;
  /** A design finished loading; stable, as it is an effect's dependency. */
  onOpened: (d: Design) => void;
  /** Shows an item of the open design; stable, as it is an effect's dependency. */
  showItem: (d: Design, item: string) => void;
};

/** Which design is open: the lists of designs, the address, opening a part's inside, and news from the server. */
export function useDesignNav({ store, selected, setSelected, setError, onOpened, showItem }: Options) {
  const { design, designRef, saveState, commit, change, settle } = store;
  const [designs, setDesigns] = useState<Summary[]>([]);
  const [templates, setTemplates] = useState<Summary[]>([]);
  const [id, setId] = useState<string | null>(() => readHash().design);
  const [browsing, setBrowsing] = useState(false);
  // An item the address points at, shown once its design has loaded.
  const linkTo = useRef<string | null>(readHash().item);
  const offeredList = useRef(false);
  // Designs left by opening a part's inside, outermost first, so the breadcrumb can lead back.
  const [trail, setTrail] = useState<{ id: string; title: string; via: string }[]>([]);

  const refreshLists = useCallback(() => {
    api.designs().then(setDesigns).catch((e) => setError(errorText(e)));
    api.templates().then(setTemplates).catch((e) => setError(errorText(e)));
  }, [setError]);

  // The open design is gone (deleted on disk, or a stale link): open another one instead of leaving a dead sheet.
  const leave = useCallback(
    async (missing: string, note: string) => {
      commit(null, { fresh: true });
      setSelected(null);
      setError(note);
      const list = await api.designs().catch(() => [] as Summary[]);
      setDesigns(list);
      const next = list.find((x) => x.id !== missing)?.id ?? null;
      if (!next) history.replaceState(null, '', location.pathname);
      setId(next);
    },
    [commit, setSelected, setError],
  );

  useEffect(() => {
    refreshLists();
    // A shared copy has no server to hear from.
    if (shared) return;
    const es = new EventSource('/api/events');
    es.onmessage = async (ev) => {
      const { id: changed } = JSON.parse(ev.data) as { id: string };
      api.designs().then(setDesigns).catch(() => {});
      const cur = designRef.current, s = saveState.current;
      if (!cur || cur.id !== changed || s.pending || s.inFlight) return;
      try {
        const fresh = await api.get(changed);
        if (fresh.rev !== designRef.current?.rev) commit(fresh, { fresh: true });
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) leave(changed, `“${cur.title}” was deleted, so another design was opened.`);
        else setError(errorText(e));
      }
    };
    return () => es.close();
  }, [refreshLists, commit, leave, setError]);

  // Without a link, reopen the design last worked on; failing that, show the list once instead of guessing.
  useEffect(() => {
    if (id || !designs.length) return;
    const last = localStorage.getItem('sd-last');
    if (last && designs.some((d) => d.id === last)) setId(last);
    else if (shared) setId(designs[0].id);
    else if (!offeredList.current) {
      offeredList.current = true;
      setBrowsing(true);
    }
  }, [id, designs]);

  // Following a link while the app is open: another design, or another item in this one.
  useEffect(() => {
    const onHash = () => {
      const { design: next, item } = readHash();
      if (!next) return;
      if (next !== designRef.current?.id) {
        linkTo.current = item;
        setTrail([]);
        setId(next);
      } else if (item) showItem(designRef.current, item);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [showItem]);

  useEffect(() => {
    if (!id) return;
    if (!shared) localStorage.setItem('sd-last', id);
    let cancelled = false;
    api
      .get(id)
      .then((d) => {
        if (cancelled) return;
        commit(d, { fresh: true });
        setSelected(null);
        onOpened(d);
        if (linkTo.current) showItem(d, linkTo.current);
        linkTo.current = null;
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) leave(id, `There is no design “${id}”, so another one was opened.`);
        else setError(errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [id, commit, leave, onOpened, showItem, setSelected, setError]);

  // The address follows the open design and the selection, so it can be copied as a link to either.
  useEffect(() => {
    if (!id || linkTo.current) return;
    history.replaceState(null, '', `#${[id, ...(selected ? [selected] : [])].map(encodeURIComponent).join('/')}`);
  }, [id, selected]);

  /** Opens a design from outside any part, so there is no way back to lead. */
  const openTop = (target: string) => {
    setTrail([]);
    setId(target);
  };
  const drill = async (target: string, via: string) => {
    if (!design) return;
    await settle();
    setTrail((t) => [...t, { id: design.id, title: design.title, via }]);
    setId(target);
  };
  const backTo = async (i: number) => {
    await settle();
    setId(trail[i].id);
    setTrail(trail.slice(0, i));
  };
  /** Starts an empty design for what is inside a part, links the part to it and opens it. */
  const createInside = async (componentId: string) => {
    const c = design?.components.find((x) => x.id === componentId);
    if (!design || !c) return;
    const base = m.slugify(`${design.id}-${c.id}`);
    let target = base;
    for (let i = 2; designs.some((x) => x.id === target); i++) target = `${base}-${i}`;
    try {
      await api.create({ id: target, title: c.label });
    } catch (e) {
      setError(errorText(e));
      return;
    }
    change((d) => {
      const x = d.components.find((i) => i.id === componentId);
      if (x) x.detail = target;
    });
    refreshLists();
    await drill(target, c.label);
  };

  return { id, setId, designs, templates, refreshLists, browsing, setBrowsing, trail, openTop, drill, backTo, createInside };
}
