import { BADGE_SVG, type BadgeKey } from '../brand/marks';

/** A creature-type badge (body plan or build): an organic faceted shape that breathes the way that type moves. */
export function TypeBadge({ kind, label, size = 26 }: { kind: BadgeKey; label: string; size?: number }) {
  return (
    <span className="type-badge" title={label}>
      <svg className={`badge-mark badge-${kind}`} width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={label}>
        <g dangerouslySetInnerHTML={{ __html: BADGE_SVG[kind] }} />
      </svg>
    </span>
  );
}
