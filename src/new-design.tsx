import { useState } from 'react';
import { parseDesign, type Design } from '../core/schema.ts';
import * as m from '../core/mutations.ts';
import { ApiError, api, type Summary } from './api.ts';
import { guessType } from './shapes.ts';
import { DialogHead, useDismiss } from './menus.tsx';
import { errorText } from './format.ts';
import { Icon } from './icons.tsx';
import { useModal } from './use-modal.ts';

// Not a valid design id, so no template can take it.
const MERMAID = ':mermaid';
const INFRA = ':infra';

export function NewDesign({ templates, onCancel, onCreated }: { templates: Summary[]; onCancel: () => void; onCreated: (d: Design) => void }) {
  const modal = useModal(onCancel);
  const [title, setTitle] = useState('');
  const [template, setTemplate] = useState('');
  const [source, setSource] = useState('');
  // The text whose unreadable lines the user was already told about; submitting it again goes ahead.
  const [warned, setWarned] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useDismiss(true, onCancel);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setErr('Give the design a title.');
    if (!/[a-z0-9]/i.test(title)) return setErr('Use at least one letter or digit.');
    // Loaded only here, so the YAML parser stays out of the main bundle.
    const importer = template === MERMAID || template === INFRA ? await import('../core/importer.ts') : null;
    const id = m.slugify(title);
    let fill: ((d: Design) => void) | null = null;
    if (importer) {
      // Import into a draft first, so a paste that can't become a valid design never leaves an empty one behind.
      let left: string[];
      try {
        const text = await importer.unpack(source);
        const plugin = await api.readWithPlugin(text);
        if (!plugin && !importer.formatOf(text)) throw new Error('This isn’t a diagram or infrastructure file this can read.');
        fill = (d) => void importer.importText(d, text, { guess: guessType, plugin });
        const draft = m.blankDesign(id, title.trim());
        left = importer.importText(draft, text, { guess: guessType, plugin }).leftOut;
        parseDesign(draft);
      } catch (e) {
        return setErr(errorText(e));
      }
      if (left.length && warned !== source) {
        setWarned(source);
        return setErr(`Left out: ${left.join('; ')}. Create again to go ahead.`);
      }
    }
    setBusy(true);
    try {
      const created = await api.create({ id, title: title.trim(), template: fill ? undefined : template || undefined });
      if (fill) fill(created);
      onCreated(fill ? await api.save(created) : created);
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 409 ? 'A design with this name already exists. Try another.' : errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const options = [
    { id: '', title: 'Blank sheet', description: undefined, steps: 1, unseen: 0 },
    { id: MERMAID, title: 'Paste a diagram', description: 'Mermaid, C4-PlantUML, draw.io XML or a Structurizr workspace', steps: 1, unseen: 0 },
    { id: INFRA, title: 'Paste infrastructure or an API file', description: 'Compose, Kubernetes, Terraform JSON, CloudFormation, CDK, Pulumi, Backstage, OpenAPI, AsyncAPI, OpenTelemetry or Jaeger traces', steps: 1, unseen: 0 },
    ...templates,
  ];
  return (
    <div className="overlay" {...modal} onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="new-design-title" onSubmit={submit}>
        <DialogHead id="new-design-title" title="New design" onClose={onCancel} />
        <input
          className="title-input"
          autoFocus
          value={title}
          placeholder="Untitled design"
          aria-label="Title"
          aria-invalid={err ? true : undefined}
          onChange={(e) => {
            setTitle(e.target.value);
            setErr(null);
          }}
        />
        {err && <em className="ed-error">{err}</em>}
        <h3 className="rule-head">Start from</h3>
        <div role="radiogroup" aria-label="Start from">
          {options.map((t) => (
            <button key={t.id || 'blank'} type="button" role="radio" aria-checked={template === t.id} className="choice" title={t.description} onClick={() => setTemplate(t.id)}>
              <span className="radio" aria-hidden="true" />
              <span className="choice-main">
                <strong>
                  <Icon name={!t.id ? 'doc' : t.id === MERMAID ? 'code' : t.id === INFRA ? 'layers' : 'template'} />
                  {t.title}
                </strong>
              </span>
              {t.id && t.id !== MERMAID && t.id !== INFRA && <span className="menu-meta">{t.steps} steps</span>}
            </button>
          ))}
        </div>
        {(template === MERMAID || template === INFRA) && (
          <textarea
            className="ed mermaid-input"
            rows={8}
            value={source}
            placeholder={
              template === MERMAID
                ? 'flowchart LR\n  user((User)) --> api[Orders API]\n  api --> db[(Orders DB)]'
                : 'services:\n  api:\n    build: .\n    depends_on: [db]\n  db:\n    image: postgres:16'
            }
            aria-label={template === MERMAID ? 'Mermaid, C4-PlantUML, draw.io or Structurizr' : 'docker-compose, Kubernetes YAML, Terraform JSON, CloudFormation, Pulumi, Backstage, OpenAPI, AsyncAPI or trace JSON'}
            spellCheck={false}
            onChange={(e) => {
              setSource(e.target.value);
              setErr(null);
            }}
          />
        )}
        <footer className="dialog-foot">
          <button type="submit" className="btn ink" disabled={busy}>
            <Icon name="check" />
            Create design
          </button>
        </footer>
      </form>
    </div>
  );
}
