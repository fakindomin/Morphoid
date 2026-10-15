import { LOGO_SVG, LOGO_VIEWBOX } from '../brand/marks';

/** The Morphoid mark: a faceted M with a head and a tail; it nods, blinks and sways its tail (CSS, see .logo-live). */
export function Logo({ size = 34, live = true }: { size?: number; live?: boolean }) {
  return (
    <svg className={`logo-mark${live ? ' logo-live' : ''}`} width={size} height={size} viewBox={LOGO_VIEWBOX}
      aria-hidden="true" dangerouslySetInnerHTML={{ __html: LOGO_SVG }} />
  );
}
