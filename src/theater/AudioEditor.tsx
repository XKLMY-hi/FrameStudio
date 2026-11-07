import { useRef } from "react";
import { MediaAsset, SceneClip } from "./schema";
import { clamp } from "../engine";
export function AudioEditor({
  asset,
  clip,
  onChange,
}: {
  asset: MediaAsset;
  clip: SceneClip;
  onChange: (c: SceneClip) => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const w = 700,
    h = 125;
  function drag(event: React.PointerEvent, side: "in" | "out") {
    event.preventDefault();
    const rect = ref.current!.getBoundingClientRect();
    const move = (e: PointerEvent) => {
      const t = clamp(
          ((e.clientX - rect.left) / rect.width) * clip.duration,
          0,
          clip.duration,
        ),
        next = { ...clip };
      if (side === "in") next.fadeIn = t;
      else next.fadeOut = clip.duration - t;
      onChange(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  const wave = asset.waveform || [];
  const points = Array.from({ length: 350 }, (_, i) => {
    const t = clip.trimIn + (i / 349) * clip.duration * clip.speed,
      index = Math.floor(
        ((clip.loop ? t % asset.duration : t) / asset.duration) * wave.length,
      );
    return wave[Math.max(0, Math.min(wave.length - 1, index))] || 0;
  });
  return (
    <div className="audio-editor">
      <div className="editor-caption">
        <strong>音频渐入渐出</strong>
        <span>拖动两个控制点调整淡入 / 淡出</span>
      </div>
      <svg ref={ref} viewBox={`0 0 ${w} ${h}`}>
        <path
          d={points
            .map((v, i) => `M${(i * w) / 349} ${65 - v * 43}v${v * 86}`)
            .join("")}
          stroke="var(--ink-muted)"
          strokeWidth="1.3"
        />
        <path
          d={`M0 110 L${(clip.fadeIn / clip.duration) * w} 20 L${(1 - clip.fadeOut / clip.duration) * w} 20 L${w} 110`}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2"
        />
        <circle
          cx={(clip.fadeIn / clip.duration) * w}
          cy="20"
          r="7"
          fill="var(--primary)"
          onPointerDown={(e) => drag(e, "in")}
        />
        <circle
          cx={(1 - clip.fadeOut / clip.duration) * w}
          cy="20"
          r="7"
          fill="var(--primary)"
          onPointerDown={(e) => drag(e, "out")}
        />
        <text x="4" y="122">
          0s
        </text>
        <text x={w - 40} y="122">
          {clip.duration.toFixed(2)}s
        </text>
      </svg>
    </div>
  );
}
