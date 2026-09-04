/** Achilles triangle mark, recolored to the landing accent inline. */
export function AchillesMark({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 500 500" width={size} height={size} aria-hidden="true">
      <path
        fill="#1F3FE0"
        fillRule="evenodd"
        d="M 250,28 L 480,458 L 20,458 Z M 250,252 L 312,458 L 230,458 L 150,360 L 195,310 L 155,250 Z"
      />
    </svg>
  );
}
