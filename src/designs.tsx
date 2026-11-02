import { useCallback, useEffect, useRef, useState } from 'react';
import * as m from '../core/mutations.ts';
import { api, type Me, type Summary, type Trashed } from './api.ts';
import { useDismiss } from './menus.tsx';
import { pad, errorText, MAX_IMPORT } from './format.ts';

export function DesignSwitcher({ designs, current, meta, onPick, onCreate, onAll, onConnections, user }: { designs: Summary[]; current: string | null; meta?: string; onPick: (id: string) => void; onCreate?: () => void; onAll?: () => void; onConnections?: () => void; user: Me }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  const cur = designs.find((d) => d.id === current);
  return (
    <div className="switcher" ref={ref}>
      <button className="switcher-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={meta}>
        <span className="switcher-title">{cur?.title ?? 'Select a design'}</span>
        {cur?.unseen ? <span className="new-count">{cur.unseen} new</span> : null}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
      </button>
      {open && (
        <div className="menu" role="listbox" aria-label="Designs">
          {meta && <p className="menu-head">{meta}</p>}
          {designs.map((d) => (
            <button
              key={d.id}
              role="option"
              aria-selected={d.id === current}
              className="menu-item"
              onClick={() => {
                onPick(d.id);
                setOpen(false);
              }}
            >
              <span className="menu-main">
                <span className="menu-title">{d.title}</span>
                {d.description && <span className="menu-desc">{d.description}</span>}
              </span>
              {d.unseen ? <span className="new-count">{d.unseen} new</span> : <span className="menu-meta">{pad(d.steps)} steps</span>}
            </button>
          ))}
          {onCreate && (
            <button
              className="menu-item menu-all"
              onClick={() => {
                setOpen(false);
                onCreate();
              }}
            >
              New design
            </button>
          )}
          {onAll && (
            <button
              className="menu-item menu-all"
              onClick={() => {
                setOpen(false);
                onAll();
              }}
            >
              All designs, trash and files…
            </button>
          )}
          {user && (
            <a className="menu-item menu-all" href="/auth/logout">
              Sign out {user.email}
            </a>
          )}
          {onConnections && (
            <button
              className="menu-item menu-all"
              onClick={() => {
                setOpen(false);
                onConnections();
              }}
            >
              Connections: webhooks, API, links…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const ago = (t?: number) => {
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(t).toLocaleDateString();
};

/** Every design on this machine: open, rename, copy, download, delete to the trash and restore, or add one from a file. */
export function Designs({ designs, current, onOpen, onClose, onChanged }: { designs: Summary[]; current: string | null; onOpen: (id: string) => void; onClose: () => void; onChanged: () => void }) {
  const [query, setQuery] = useState('');
  const [byName, setByName] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [trashed, setTrashed] = useState<Trashed[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [dir, setDir] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useDismiss(!renaming, onClose);
  const loadTrash = useCallback(() => api.trashed().then(setTrashed).catch((e) => setErr(errorText(e))), []);
  useEffect(() => {
    loadTrash();
    api.info().then((i) => setDir(i.dir)).catch(() => {});
  }, [loadTrash, designs]);
  // Each action reports its own error here, and refreshes the list the app keeps.
  const run = async (f: () => Promise<unknown>) => {
    setErr(null);
    try {
      await f();
      onChanged();
    } catch (e) {
      setErr(errorText(e));
    }
  };
  const rename = (id: string, title: string) =>
    run(async () => {
      setRenaming(null);
      const d = await api.get(id);
      if (title.trim() && title.trim() !== d.title) await api.save({ ...d, title: title.trim() });
    });
  const copy = (s: Summary) =>
    run(async () => {
      const title = `${s.title} copy`;
      let id = m.slugify(title);
      for (let n = 2; designs.some((x) => x.id === id); n++) id = `${m.slugify(title)}-${n}`;
      await api.create({ id, title, from: s.id });
    });
  const download = (id: string) =>
    run(async () => {
      const d = await api.get(id);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
      a.download = `${id}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  const upload = (f: File) =>
    run(async () => {
      if (f.size > MAX_IMPORT) throw new Error('That file is too big to be a design.');
      let raw: unknown;
      try {
        raw = JSON.parse(await f.text());
      } catch {
        throw new Error(`${f.name} isn’t a design file (JSON exported from here).`);
      }
      onOpen((await api.importFile(raw)).id);
    });
  const q = query.trim().toLowerCase();
  const shown = designs
    .filter((d) => !q || `${d.title} ${d.description ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => (byName ? a.title.localeCompare(b.title) : (b.updated ?? 0) - (a.updated ?? 0)));
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide" role="dialog" aria-modal="true" aria-labelledby="designs-title">
        <header className="dialog-head">
          <span className="tag" id="designs-title">
            Designs · {designs.length}
          </span>
          <button type="button" className="text-btn" onClick={onClose}>
            Close <kbd>Esc</kbd>
          </button>
        </header>
        <div className="designs-tools">
          <input className="find-input" autoFocus value={query} placeholder="Search designs" aria-label="Search designs" onChange={(e) => setQuery(e.target.value)} />
          <button className="text-btn" onClick={() => setByName((x) => !x)} title="Change the order">
            {byName ? 'A–Z' : 'Recent'}
          </button>
        </div>
        {err && <em className="ed-error">{err}</em>}
        <ul className="designs-list">
          {shown.map((d) => (
            <li key={d.id} className="designs-row" aria-current={d.id === current || undefined}>
              {renaming === d.id ? (
                <input
                  className="find-input"
                  autoFocus
                  defaultValue={d.title}
                  aria-label="New title"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') rename(d.id, e.currentTarget.value);
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  onBlur={(e) => rename(d.id, e.currentTarget.value)}
                />
              ) : (
                <button className="designs-open" onClick={() => onOpen(d.id)}>
                  <span className="choice-main">
                    <strong>{d.title}</strong>
                    {d.description && <span>{d.description}</span>}
                  </span>
                  <span className="menu-meta">
                    {d.unseen ? <span className="new-count">{d.unseen} new</span> : `${pad(d.steps)} steps`} · {ago(d.updated)}
                  </span>
                </button>
              )}
              <span className="designs-actions">
                <button className="text-btn" onClick={() => setRenaming(d.id)}>Rename</button>
                <button className="text-btn" onClick={() => copy(d)}>Copy</button>
                <button className="text-btn" onClick={() => download(d.id)} title="Download as a .json file">Download</button>
                <button className="text-btn danger" onClick={() => run(() => api.trash(d.id))} title="Move to the trash; it can be restored">Delete</button>
              </span>
            </li>
          ))}
          {!shown.length && <li className="designs-empty">{designs.length ? 'No design matches.' : 'No designs yet.'}</li>}
        </ul>
        {trashed.length > 0 && (
          <>
            <button className="text-btn" aria-expanded={showTrash} onClick={() => setShowTrash((x) => !x)}>
              Recently deleted · {trashed.length}
            </button>
            {showTrash && (
              <ul className="designs-list">
                {trashed.map((t) => (
                  <li key={t.entry} className="designs-row">
                    <span className="choice-main">
                      <strong>{t.title}</strong>
                      <span>Deleted {ago(t.deleted)}</span>
                    </span>
                    <span className="designs-actions">
                      <button className="text-btn" onClick={() => run(async () => (await api.restore(t.entry), loadTrash()))}>Restore</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <footer className="dialog-foot designs-foot">
          {dir && (
            <span className="designs-dir" title="Every design is a JSON file in this folder">
              Saved in <code>{dir}</code>
              <button className="text-btn" onClick={() => navigator.clipboard?.writeText(dir)}>Copy path</button>
            </span>
          )}
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => (e.target.files?.[0] && upload(e.target.files[0]), (e.target.value = ''))} />
          <button className="btn" onClick={() => fileRef.current?.click()}>Add from file</button>
        </footer>
      </div>
    </div>
  );
}
