// Minutes since takeoff, for the airborne action row's flight-time display
// (Dashboard's live lane, Tracking) — takes `now` as a parameter rather than
// reading Date.now() itself so callers can compute it during render without
// tripping React's "no impure calls during render" rule; pass a `now` value
// refreshed on each poll tick instead.
export function elapsedMinutes(offBlockIso: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(offBlockIso)) / 60_000));
}
