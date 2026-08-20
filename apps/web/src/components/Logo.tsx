// Inline SVG so it themes with currentColor/tokens and needs no asset pipeline —
// a plane climbing away from a cloud, matching the brand-blue primary. Built from
// plain circles/rect/triangle primitives (not hand-fitted bezier coordinates) so
// the shapes stay legible without a visual proof pass. Used wherever the app
// identifies itself: dispatcher sidebar, /register, /board.
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {/* Cloud: three overlapping puffs + a flat base, classic circles+rect trick. */}
      <g fill="currentColor" opacity="0.35">
        <circle cx="10" cy="21" r="4.5" />
        <circle cx="15.5" cy="18.5" r="5.5" />
        <circle cx="21" cy="21" r="4.5" />
        <rect x="6" y="20.5" width="19" height="6" rx="3" />
      </g>
      {/* Plane: paper-airplane triangle climbing up-right out of the cloud. */}
      <path
        d="M6 27 28 5 19 15 28 5 15 25 13 16Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
