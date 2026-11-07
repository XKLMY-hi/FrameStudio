import React, { useEffect, useState } from "react";
import { MediaAsset } from "./schema";
export function AudioLibraryPreview({
  audio,
  asset,
}: {
  audio: HTMLAudioElement;
  asset: MediaAsset;
}) {
  const [t, setT] = useState(audio.currentTime);
  useEffect(() => {
    const timer = setInterval(() => setT(audio.currentTime), 150);
    return () => clearInterval(timer);
  }, [audio]);
  return (
    <div
      className="audio-library-preview"
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <svg viewBox="0 0 400 30" preserveAspectRatio="none">
        <path
          d={(asset.waveform || [])
            .filter((_, i) => i % 3 === 0)
            .map(
              (v, i) =>
                "M" +
                (i * 1200) / (asset.waveform?.length || 1) +
                " " +
                (15 - v * 14) +
                "v" +
                v * 28,
            )
            .join("")}
          stroke="currentColor"
        />
      </svg>
      <input
        aria-label={"库内试听进度 " + asset.id}
        type="range"
        min="0"
        max={asset.duration}
        step=".01"
        value={t}
        onChange={(e) => {
          audio.currentTime = +e.target.value;
          setT(+e.target.value);
        }}
      />
      <span>
        {t.toFixed(2)} / {asset.duration.toFixed(2)}s · 库内试听，不修改时间线
      </span>
    </div>
  );
}
