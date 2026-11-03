import { useCallback, useEffect, useRef, useState } from 'react';
import * as m from '../core/mutations.ts';
import { api, type Summary, type Trashed } from './api.ts';
import { DialogHead, MenuLabel, useDismiss, useHoverOpen } from './menus.tsx';
import { Icon, type IconName } from './icons.tsx';
import { useModal } from './use-modal.ts';
import { errorText, MAX_IMPORT } from './format.ts';

export function DesignSwitcher({ designs, current, onPick, onCreate, onAll }: { designs: Summary[]; current: string | null; onPick: (id: string) => void; onCreate?: () => void; onAll?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  const hover = useHoverOpen(open, setOpen);
  const cur = designs.find((d) => d.id === current);
  /** Closes the menu, then acts. */
  const item = (name: string, icon: IconName, onClick: () => void) => (
    <button
      type="button"
      className="menu-row"
      onClick={() => {
        setOpen(false);
        onClick();
      }}
    >
      <MenuLabel name={name} icon={icon} />
    </button>
  );
  return (
    <div className="switcher" ref={ref} {...hover.area}>
      <button type="button" className="switcher-btn" aria-haspopup="listbox" aria-expanded={open} {...hover.trigger} onClick={() => setOpen((o) => !o)}>
        <span className="switcher-title">{cur?.title ?? 'Select a design'}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
      </button>
      {open && (
        <div className="menu">
          <div role="listbox" aria-label="Designs">
            {designs.map((d) => (
              <button
                type="button"
                key={d.id}
                role="option"
                aria-selected={d.id === current}
                className="menu-row"
                title={d.description}
                onClick={() => {
                  onPick(d.id);
                  setOpen(false);
                }}
              >
                <span className="menu-name">{d.title}</span>
                {d.unseen ? <span className="new-count">{d.unseen} new</span> : null}
              </button>
            ))}
          </div>
          {(onCreate || onAll) && <hr className="menu-rule" />}
          {onCreate && item('New design', 'plus', onCreate)}
          {onAll && item('All designs', 'folder', onAll)}
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
  const modal = useModal(onClose);
  const [query, setQuery] = useState('');
  const [byName, setByName] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [trashed, setTrashed] = useState<Trashed[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [dir, setDir] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useDismiss(!renaming, onClose);
  const hover = useHoverOpen(showTrash, setShowTrash);
  const loadTrash = useCallback(() => api.trashed().then(setTrashed).catch((e) => setErr(errorText(e))), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a changed list of designs may mean one went to the trash, so it is reloaded then.
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
    // biome-ignore lint/a11y/noStaticElementInteractions: a press on the backdrop closes the dialog; Escape does the same from the keyboard.
    <div className="overlay" {...modal} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide" role="dialog" aria-modal="true" aria-labelledby="designs-title">
        <DialogHead id="designs-title" title="Designs" onClose={onClose} />
        <div className="designs-tools">
          <input className="find-input" autoFocus value={query} placeholder="Search designs" aria-label="Search designs" onChange={(e) => setQuery(e.target.value)} />
          <button type="button" className="text-btn" onClick={() => setByName((x) => !x)} title="Change the order">
            <Icon name="sort" />
            {byName ? 'By name' : 'Recent'}
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
                    if (e.key === 'Escape') (e.preventDefault(), setRenaming(null));
                  }}
                  onBlur={(e) => rename(d.id, e.currentTarget.value)}
                />
              ) : (
                <button type="button" className="designs-open" title={d.description} onClick={() => onOpen(d.id)}>
                  <span className="menu-name">{d.title}</span>
                  {d.unseen ? <span className="new-count">{d.unseen} new</span> : <span className="menu-meta">{ago(d.updated)}</span>}
                </button>
              )}
              <span className="designs-actions">
                <button type="button" className="text-btn" onClick={() => setRenaming(d.id)}><Icon name="sketch" />Rename</button>
                <button type="button" className="text-btn" onClick={() => copy(d)}><Icon name="copy" />Copy</button>
                <button type="button" className="text-btn" onClick={() => download(d.id)} title="Download as a .json file"><Icon name="export" />Download</button>
                <button type="button" className="text-btn danger" onClick={() => run(() => api.trash(d.id))} title="Move to the trash; it can be restored"><Icon name="trash" />Delete</button>
              </span>
            </li>
          ))}
          {!shown.length && <li className="designs-empty">{designs.length ? 'No design matches.' : 'No designs yet.'}</li>}
        </ul>
        {trashed.length > 0 && (
          <div className="contents" {...hover.area}>
            <button type="button" className="text-btn" aria-expanded={showTrash} {...hover.trigger} onClick={() => setShowTrash((x) => !x)}>
              <Icon name="trash" />
              Trash {trashed.length}
            </button>
            {showTrash && (
              <ul className="designs-list">
                {trashed.map((t) => (
                  <li key={t.entry} className="designs-row">
                    <span className="choice-main">
                      <strong>{t.title}</strong>
                    </span>
                    <span className="menu-meta">{ago(t.deleted)}</span>
                    <span className="designs-actions">
                      <button type="button" className="text-btn" onClick={() => run(async () => (await api.restore(t.entry), loadTrash()))}><Icon name="undo" />Restore</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <footer className="dialog-foot designs-foot">
          {dir && (
            <button type="button" className="text-btn" title={dir} onClick={() => navigator.clipboard?.writeText(dir)}>
              <Icon name="folder" />
              Copy folder path
            </button>
          )}
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => (e.target.files?.[0] && upload(e.target.files[0]), (e.target.value = ''))} />
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}><Icon name="upload" />Add from file</button>
        </footer>
      </div>
    </div>
  );
}
