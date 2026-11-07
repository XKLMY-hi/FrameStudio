import React, { useRef } from "react";
import {produce} from 'immer';
import {
  Play,
  Pause,
  SkipBack,
  Plus,
  Scissors,
  Copy,
  Trash2,
  Magnet,
  Volume2,
  VolumeX,
  Diamond,
  Music2,
  Layers,
  ChevronDown,
} from "lucide-react";
import { Asset, Clip, Project, Track } from "./types";
import { clamp } from "./engine";
type Props = {
  project: Project;
  time: number;
  playing: boolean;
  selected: string;
  zoom: number;
  snap: boolean;
  onSeek: (t: number) => void;
  onPlay: () => void;
  onChange: (p: Project) => void;
  onSelect: (id: string) => void;
  onZoom: (n: number) => void;
  onSnap: () => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onDropAsset: (id: string, trackId: string, t: number) => void;
  onAddTrack: () => void;
  curveOpen: boolean;
  onCurve: () => void;
};
export function Timeline(p: Props) {
  const scroll = useRef<HTMLDivElement>(null),
    labelWidth = 174,
    px = p.zoom;
  const width = Math.max(p.project.duration * px + 130, 600);
  const frame = 1 / p.project.fps;
  function quantize(t: number) {
    return p.snap ? Math.round(t / frame) * frame : t;
  }
  function seek(e: React.PointerEvent) {
    const rect = e.currentTarget.getBoundingClientRect(),
      initialX = e.clientX;
    const start = (initialX - rect.left) / px;
    p.onSeek(clamp(quantize(start), 0, p.project.duration));
    const move = (ev: PointerEvent) =>
      p.onSeek(
        clamp(
          quantize(start + (ev.clientX - initialX) / px),
          0,
          p.project.duration,
        ),
      );
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  function dragClip(
    e: React.PointerEvent,
    track: Track,
    clip: Clip,
    edge?: "left" | "right",
  ) {
    e.stopPropagation();
    e.preventDefault();
    p.onSelect(clip.id);
    const startX = e.clientX,
      startY = e.clientY,
      initial = p.project;
    const move = (ev: PointerEvent) => {
      const next = produce(initial,draft=>{
      const tr = draft.tracks.find((t) => t.id === track.id)!,
        c = tr.clips.find((c) => c.id === clip.id)!,
        asset = draft.assets.find((a) => a.id === c.assetId)!;
      let delta = quantize((ev.clientX - startX) / px);
      if (edge === "left") {
        delta = clamp(
          delta,
          -Math.min(c.start, c.trimIn / c.speed),
          c.duration - frame,
        );
        c.start += delta;
        c.trimIn += delta * c.speed;
        c.duration -= delta;
      } else if (edge === "right") {
        c.duration = clamp(
          c.duration + delta,
          frame,
          c.loop
            ? Math.max(draft.duration, 60)
            : (asset.duration - c.trimIn) / c.speed,
        );
      } else {
        c.start = clamp(
          quantize(clip.start + delta),
          0,
          Math.max(0, draft.duration - c.duration),
        );
        const shift = Math.round((ev.clientY - startY) / 52),
          at = draft.tracks.indexOf(tr),
          target = draft.tracks[clamp(at + shift, 0, draft.tracks.length - 1)];
        if (target.id !== tr.id) {
          tr.clips = tr.clips.filter((v) => v.id !== c.id);
          target.clips.push(c);
        }
      }
      });
      p.onChange(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  const interval = px > 130 ? 0.5 : px > 65 ? 1 : px > 30 ? 2 : 5;
  return (
    <section className="timeline-panel">
      <div className="timeline-toolbar">
        <div className="transport">
          <button title="回到起点" onClick={() => p.onSeek(0)}>
            <SkipBack size={15} />
          </button>
          <button
            className="play-btn"
            title="播放 / 暂停（空格）"
            onClick={p.onPlay}
          >
            {p.playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <span className="time-code">
            <span data-clock>{Math.floor(p.time / 60)
              .toString()
              .padStart(2, "0")}
            :{(p.time % 60).toFixed(3).padStart(6, "0")}</span>{" "}
            <i>/ {p.project.duration.toFixed(2)}s</i>
          </span>
        </div>
        <div className="timeline-actions">
          <button onClick={p.onAddTrack} title="添加轨道">
            <Plus size={15} />
            轨道
          </button>
          <button
            onClick={p.onSplit}
            disabled={!p.selected}
            title="在播放头处分割"
          >
            <Scissors size={15} />
          </button>
          <button
            onClick={p.onDuplicate}
            disabled={!p.selected}
            title="复制片段"
          >
            <Copy size={15} />
          </button>
          <button
            onClick={p.onDelete}
            disabled={!p.selected}
            title="删除片段（Delete）"
          >
            <Trash2 size={15} />
          </button>
          <span className="divider" />
          <button
            className={p.snap ? "active" : ""}
            onClick={p.onSnap}
            title="吸附到帧"
          >
            <Magnet size={15} />
          </button>
          <button className={p.curveOpen ? "active" : ""} onClick={p.onCurve}>
            <Diamond size={14} />
            曲线
          </button>
          <input
            aria-label="时间线缩放"
            type="range"
            min="25"
            max="220"
            value={p.zoom}
            onChange={(e) => p.onZoom(+e.target.value)}
          />
          <span className="small-muted">{p.project.fps} FPS</span>
        </div>
      </div>
      <div className="timeline-scroll" ref={scroll}>
        <div className="timeline-content" style={{ width: width + labelWidth }}>
          <div className="ruler-row">
            <div className="track-label ruler-label">
              时间线 <ChevronDown size={12} />
            </div>
            <div className="ruler" style={{ width }} onPointerDown={seek}>
              {Array.from(
                { length: Math.ceil(p.project.duration / interval) + 1 },
                (_, i) => i * interval,
              ).map((t) => (
                <span key={t} style={{ left: t * px }}>
                  {t.toFixed(interval < 1 ? 1 : 0)}s
                </span>
              ))}
            </div>
          </div>
          {p.project.tracks.map((tr, ti) => (
            <div className={`track-row ${tr.muted ? "muted" : ""}`} key={tr.id}>
              <div className="track-label">
                <span className={"track-dot " + tr.type} />
                <input
                  className="track-name"
                  title="直接输入轨道名称"
                  aria-label={`轨道 ${ti+1} 名称`}
                  value={tr.name} placeholder="未命名轨道"
                  onChange={e=>p.onChange(produce(p.project,d=>{d.tracks[ti].name=e.target.value;}))}
                  onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter')e.currentTarget.blur();}}
                />
                <button
                  onClick={() => {
                    const n = produce(p.project,d=>{d.tracks[ti].muted=!tr.muted;});
                    p.onChange(n);
                  }}
                  title="静音 / 禁用轨道"
                >
                  {tr.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                </button>
                <button
                  className={tr.solo ? "solo active" : "solo"}
                  title="独奏"
                  onClick={() => {
                    const n = produce(p.project,d=>{d.tracks[ti].solo=!tr.solo;});
                    p.onChange(n);
                  }}
                >
                  S
                </button>
              </div>
              <div
                className="track-lane"
                style={{ width, backgroundSize: `${px * interval}px 100%` }}
                onPointerDown={seek}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("asset");
                  if (id)
                    p.onDropAsset(
                      id,
                      tr.id,
                      clamp(
                        quantize(
                          (e.clientX -
                            e.currentTarget.getBoundingClientRect().left) /
                            px,
                        ),
                        0,
                        p.project.duration,
                      ),
                    );
                }}
              >
                {tr.clips.map((c) => {
                  const a = p.project.assets.find((a) => a.id === c.assetId);
                  if (!a) return null;
                  return (
                    <div
                      key={c.id}
                      className={`clip ${a.kind} ${c.id === p.selected ? "selected" : ""} ${!c.enabled ? "disabled" : ""}`}
                      style={{
                        left: c.start * px,
                        width: Math.max(9, c.duration * px),
                        opacity: c.enabled ? 1 : 0.35,
                      }}
                      title={`${a.name}\n${c.duration.toFixed(4)} 秒 · ${a.curves.length} 条曲线`}
                      onPointerDown={(e) => dragClip(e, tr, c)}
                    >
                      <div
                        className="clip-fade fade-in"
                        style={{
                          width: Math.min(c.duration / 2, c.fadeIn) * px,
                        }}
                      />
                      <div
                        className="clip-fade fade-out"
                        style={{
                          width: Math.min(c.duration / 2, c.fadeOut) * px,
                        }}
                      />
                      {a.kind === "audio" ? (
                        <svg
                          className="waveform"
                          viewBox="0 0 1000 34"
                          preserveAspectRatio="none"
                        >
                          <path
                            d={(a.waveform || [])
                              .filter((_, i) => i % 3 === 0)
                              .map(
                                (v, i) =>
                                  `M${(i * 3000) / (a.waveform?.length || 1)} ${17 - v * 15}v${v * 30}`,
                              )
                              .join("")}
                            stroke="currentColor"
                            strokeWidth="1"
                          />
                        </svg>
                      ) : null}
                      <span className="clip-title">
                        {a.kind === "audio" ? (
                          <Music2 size={11} />
                        ) : a.kind === "keyframe" ? (
                          <Diamond size={10} />
                        ) : (
                          <Layers size={11} />
                        )}{" "}
                        {a.name}
                      </span>
                      {a.kind === "keyframe" &&
                        a.curves[0]?.keys.map((k, i) => (
                          <i
                            className="timeline-key"
                            key={i}
                            style={{ left: ((k.t - c.trimIn) / c.speed) * px }}
                          />
                        ))}
                      <div
                        className="trim-handle left"
                        onPointerDown={(e) => dragClip(e, tr, c, "left")}
                      />
                      <div
                        className="trim-handle right"
                        onPointerDown={(e) => dragClip(e, tr, c, "right")}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <div
            className="playhead"
            data-playhead data-zoom={px}
            style={{
              left: labelWidth + p.time * px,
              height: 30 + p.project.tracks.length * 52,
            }}
          >
            <span />
          </div>
          <div
            className="timeline-end"
            style={{ left: labelWidth + p.project.duration * px }}
          />
        </div>
      </div>
      <div className="timeline-footer">
        <span>拖入预设创建片段 · 拖动片段叠加 · 拖动左右边缘裁切</span>
        <span>
          {p.project.tracks.reduce((s, t) => s + t.clips.length, 0)} 个片段 ·{" "}
          {p.project.tracks.length} 条轨道
        </span>
      </div>
    </section>
  );
}
