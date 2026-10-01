// A small baseball diamond. Filled bases have a runner on them.

export function diamondSvg({ first, second, third }) {
  const base = (x, y, occupied, label) =>
    `<rect x="${x - 7}" y="${y - 7}" width="14" height="14" transform="rotate(45 ${x} ${y})"
       class="base ${occupied ? "on" : ""}"><title>${label}${occupied ? ": runner" : ""}</title></rect>`;
  return `
    <svg class="diamond" viewBox="0 0 64 56" role="img"
         aria-label="Runners on: ${[first && "first", second && "second", third && "third"].filter(Boolean).join(", ") || "none"}">
      ${base(32, 12, second, "Second base")}
      ${base(52, 30, first, "First base")}
      ${base(12, 30, third, "Third base")}
      <rect x="27" y="45" width="10" height="8" class="plate"/>
    </svg>`;
}
