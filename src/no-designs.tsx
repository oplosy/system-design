import { shared } from './api.ts';
import { Icon } from './icons.tsx';
import { ShapePreview } from './palette.tsx';

/** What a first start shows: there is nothing to open yet. */
export function NoDesigns({ onCreate, onBrowse }: { onCreate: () => void; onBrowse: () => void }) {
  return (
    <div className="empty">
      <div className="empty-art" aria-hidden="true">
        <ShapePreview type="client" width={72} height={48} />
        <span className="empty-wire" />
        <ShapePreview type="api-gateway" width={84} height={40} />
        <span className="empty-wire" />
        <ShapePreview type="sql-db" width={64} height={48} />
      </div>
      <h2>No designs yet</h2>
      <button className="btn ink lg" onClick={onCreate}>
        <Icon name="plus" />
        New design
      </button>
      {!shared && (
        <button className="text-btn" onClick={onBrowse}>
          <Icon name="folder" />
          All designs
        </button>
      )}
    </div>
  );
}
