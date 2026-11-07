import type { Asset, Project } from "../types";
import {
  addVisual,
  emptyScene,
  sceneClip,
  type Layer,
  type Scene,
} from "./schema";
import { layerAlpha, modelProject } from "./scene-engine";
import { clamp } from "../engine";

export type AuditionState = {
  id: string;
  name: string;
  duration: number;
  fps: number;
  time: number;
  speed: number;
  playing: boolean;
  loop: boolean;
  isolated: boolean;
};

export function auditionProject(
  s: Scene,
  target: Layer,
  asset: Asset,
  t: number,
) {
  const duration = Math.max(0.001, asset.duration);
  const clip = sceneClip(
    "motion",
    target.id,
    asset.id,
    asset.name,
    0,
    duration,
  );
  clip.fadeIn = clip.fadeOut = 0;
  clip.blend = "override";
  const project: Project = {
    ...modelProject(s, target),
    duration,
    assets: [
      {
        ...asset,
        curves: asset.curves.map((c) => ({ ...c, fadeIn: 0, fadeOut: 0 })),
      },
    ],
    tracks: [
      {
        id: "audition",
        name: "试听",
        type: "generic",
        muted: false,
        solo: false,
        clips: [clip],
      },
    ],
  };
  if (layerAlpha(s, target, t) > 0) return { project };
  // Keep the same controller ID. A temporary stage makes even off-timeline or
  // hidden actors auditionable without moving the project playhead.
  const stage: Scene = {
    ...s,
    layers: [],
    tracks: [],
    lighting: undefined,
    camera: emptyScene().camera,
  };
  const scale = Math.min(
    (s.width * 0.85) / target.width,
    (s.height * 0.9) / target.height,
  );
  addVisual(
    stage,
    {
      ...target,
      visible: true,
      parentId: null,
      animation: {},
      is3D: false,
      transform: {
        x: 0,
        y: 0,
        z: 0,
        rotation: 0,
        rotationX: 0,
        rotationY: 0,
        scaleX: scale,
        scaleY: scale,
        opacity: 1,
      },
    },
    0,
    s.duration + 1,
  );
  return { project, stage };
}

export function advanceAudition(a: AuditionState, dt: number): AuditionState {
  if (!a.playing || dt <= 0) return a;
  const next = a.time + dt * a.speed;
  if (next < a.duration) return { ...a, time: next };
  return a.loop
    ? { ...a, time: next % a.duration }
    : { ...a, time: a.duration, playing: false };
}
// The timeline uses half-open clip intervals. Sample just inside the end so
// holding the last pose cannot fall through to the default model parameters.
export const auditionSample = (time: number, duration: number) =>
  clamp(time, 0, Math.max(0, duration - 1e-8));
