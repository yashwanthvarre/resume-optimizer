/** Claude's spark: the button that asks Claude about a highlighted change. */
export function ClaudeIcon({ size = 14 }: { size?: number }) {
  const rays = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {rays.map((r, i) => (
        <line key={r} x1="12" y1="12" x2="12" y2={i % 2 ? 4.5 : 2} stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" transform={`rotate(${r} 12 12)`} />
      ))}
    </svg>
  );
}
