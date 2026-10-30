import { Lock } from "lucide-react";

// EU flag geometry (height H = 20, width 30 = 3:2): 12 stars on a circle of radius H/3,
// each star's outer radius H/18, all stars upright. Colours: blue #003399, yellow #FFCC00.
const H = 20;
const W = 30;
const RING = H / 3;
const STAR_R = H / 18;
const STAR_INNER = STAR_R * 0.381966; // regular five-pointed star

function starPoints(cx: number, cy: number): string {
  return Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 === 0 ? STAR_R : STAR_INNER;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    return `${(cx + r * Math.cos(a)).toFixed(3)},${(cy + r * Math.sin(a)).toFixed(3)}`;
  }).join(" ");
}

const STARS = Array.from({ length: 12 }, (_, k) => {
  const a = -Math.PI / 2 + (k * Math.PI) / 6; // start at 12 o'clock
  return starPoints(W / 2 + RING * Math.cos(a), H / 2 + RING * Math.sin(a));
});

/** Logo: EU flag (3:2) and a square with a white lock on the app blue, same height, square corners. */
export function Logo({ height = 32 }: { height?: number }) {
  return (
    <span className="inline-flex flex-none" style={{ height }} aria-hidden>
      <svg width={(height * W) / H} height={height} viewBox={`0 0 ${W} ${H}`} className="block">
        <rect width={W} height={H} fill="#003399" />
        {STARS.map((pts, i) => (
          <polygon key={i} points={pts} fill="#FFCC00" />
        ))}
      </svg>
      <span className="flex items-center justify-center bg-brand-700 text-white" style={{ width: height, height }}>
        <Lock style={{ width: height * 0.56, height: height * 0.56 }} aria-hidden />
      </span>
    </span>
  );
}
