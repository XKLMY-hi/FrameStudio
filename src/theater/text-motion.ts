import { clamp } from "../engine";

export const titleMotions = {
  rise: "浮升入场",
  slide: "横向冲入",
  pop: "弹力放大",
  swing: "摆入旋停",
  bounce: "落地反弹",
  wipe: "横向擦入",
  flicker: "霓虹闪亮",
  glitch: "故障 · RGB 残影",
  drift: "持续漂浮",
  pulse: "持续呼吸",
} as const;
export type TitleMotion = keyof typeof titleMotions;
export type TextAnimation = "none" | "typewriter" | "fade" | "typewriter-fade" | TitleMotion;
export type TitlePose = {
  x: number;
  y: number;
  scale: number;
  angle: number;
  alpha: number;
  reveal: number;
  echo: number;
};
export const isTitleMotion = (id: string): id is TitleMotion => Object.hasOwn(titleMotions, id);
export const defaultTitleDuration = 0.55;
export const defaultTitleAmount = 0.75;

function pose(id: string, progress: number, clock: number, size: number, amount: number): TitlePose {
  const p = clamp(progress, 0, 1), q = 1 - p, ease = q * q * q;
  const a: TitlePose = { x: 0, y: 0, scale: 1, angle: 0, alpha: 1, reveal: 1, echo: 0 };
  const distance = size * amount;
  switch (id) {
    case "rise": a.y = distance * 1.2 * ease; a.alpha = 1 - ease; break;
    case "slide": a.x = -distance * 3 * ease; a.alpha = 1 - ease; break;
    case "pop": a.scale = Math.max(.05, 1 - amount * ease + Math.sin(p * Math.PI * 2) * q * amount * .34); a.alpha = 1 - ease; break;
    case "swing": a.angle = -ease * amount * .72 + Math.sin(p * Math.PI * 2) * q * amount * .12; a.x = -distance * ease; a.alpha = 1 - ease; break;
    case "bounce": a.y = -distance * 1.8 * q * q * Math.abs(Math.cos(p * Math.PI * 3)); a.alpha = Math.min(1, p * 4); break;
    case "wipe": a.reveal = 1 - q * q; break;
    case "flicker": a.alpha = p >= 1 ? 1 : clamp(p + (Math.sin(Math.floor(p * 20) * 15.7) * .65 * q * amount), 0, 1); break;
    case "glitch": {
      const v = Math.floor(p * 18);
      a.x = Math.sin(v * 23.13) * distance * .5 * q;
      a.y = Math.cos(v * 8.7) * distance * .17 * q;
      a.alpha = 1 - ease;
      a.echo = distance * q * (.15 + .35 * Math.abs(Math.sin(v * 17.2)));
      break;
    }
    case "drift": a.y = Math.sin(clock * Math.PI * 1.6) * distance * .23; break;
    case "pulse": a.scale = 1 + Math.sin(clock * Math.PI * 1.8) * amount * .09; break;
  }
  return a;
}

export function titlePose(
  animation: TextAnimation,
  exit: TitleMotion | undefined,
  elapsed: number,
  remaining: number,
  size: number,
  inDuration = defaultTitleDuration,
  outDuration = 0.35,
  amount = defaultTitleAmount,
): TitlePose {
  const strength = clamp(amount, 0, 1);
  const start = pose(animation, elapsed / Math.max(.01, inDuration), elapsed, size, strength);
  if (!exit || remaining >= outDuration || outDuration <= 0) return start;
  const end = pose(exit, remaining / Math.max(.01, outDuration), remaining, size, strength);
  return {
    x: start.x + end.x,
    y: start.y + end.y,
    scale: start.scale * end.scale,
    angle: start.angle + end.angle,
    alpha: start.alpha * end.alpha,
    reveal: Math.min(start.reveal, end.reveal),
    echo: Math.max(start.echo, end.echo),
  };
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export const titleCharacters = (value: string) =>
  Array.from(segmenter.segment(value), ({ segment }) => segment);
