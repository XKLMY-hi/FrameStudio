import React, { useEffect, useState } from "react";
import {
  Pause,
  Play,
  Repeat,
  RotateCcw,
  StepBack,
  StepForward,
  X,
} from "lucide-react";
import type { AuditionState } from "./motion-audition";

export function AuditionControls({
  clock,
  change,
  close,
}: {
  clock: React.RefObject<AuditionState | undefined>;
  change: (patch: Partial<AuditionState>) => void;
  close: () => void;
}) {
  const [value, setValue] = useState(clock.current);
  useEffect(() => {
    const timer = setInterval(() => setValue(clock.current), 80);
    return () => clearInterval(timer);
  }, [clock]);
  if (!value) return null;
  const update = (patch: Partial<AuditionState>) => {
    change(patch);
    setValue(clock.current);
  };
  const { time, duration, fps, playing } = value;
  return (
    <div className="audition-controls" aria-label="动作试听控制">
      <div className="audition-name">
        <span>{value.isolated ? "独立试听" : "动作试听"}</span>
        <strong title={value.name}>{value.name}</strong>
      </div>
      <button
        title="从头试听"
        onClick={() => update({ time: 0, playing: true })}
      >
        <RotateCcw size={14} />
      </button>
      <button
        title="上一帧"
        onClick={() =>
          update({ playing: false, time: Math.max(0, time - 1 / fps) })
        }
      >
        <StepBack size={15} />
      </button>
      <button
        title={playing ? "暂停试听" : "播放试听"}
        onClick={() =>
          update({
            playing: !playing,
            time: !playing && time >= duration ? 0 : time,
          })
        }
      >
        {playing ? <Pause size={15} /> : <Play size={15} />}
      </button>
      <button
        title="下一帧"
        onClick={() =>
          update({ playing: false, time: Math.min(duration, time + 1 / fps) })
        }
      >
        <StepForward size={15} />
      </button>
      <input
        aria-label="动作试听进度"
        type="range"
        min={0}
        max={duration}
        step="any"
        value={time}
        onChange={(e) => update({ time: +e.target.value, playing: false })}
      />
      <span className="audition-time">
        {time.toFixed(3)} / {duration.toFixed(3)} s
      </span>
      <select
        aria-label="动作试听速度"
        value={value.speed}
        onChange={(e) => update({ speed: +e.target.value })}
      >
        {[0.25, 0.5, 1, 2].map((n) => (
          <option key={n} value={n}>
            {n}×
          </option>
        ))}
      </select>
      <button
        title="循环试听"
        className={value.loop ? "active" : ""}
        aria-pressed={value.loop}
        onClick={() => update({ loop: !value.loop })}
      >
        <Repeat size={15} />
      </button>
      <button title="结束试听并恢复场景" onClick={close}>
        <X size={16} />
      </button>
    </div>
  );
}
