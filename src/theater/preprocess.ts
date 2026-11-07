import { Scene, emptyScene, layer, addVisual } from "./schema";
export function preprocessingScene(source: Scene, resourceId: string): Scene {
  const preview = emptyScene();
  preview.id = "@preprocessing";
  preview.name = "模型预处理";
  preview.width = preview.height = 720;
  preview.duration = 1;
  preview.fps = 30;
  preview.workArea = { start: 0, end: 1, loop: false };
  preview.models = source.models;
  preview.assets = source.assets;
  preview.lighting = {
    enabled: false,
    ambient: 1,
    color: "#ffffff",
    exposure: 1,
  };
  // Keep existing controllers alive while the workbench uses its own neutral actor.
  preview.layers = source.layers.map((l) => ({ ...l, visible: false }));
  preview.tracks = [];
  const r = source.models.find((r) => r.id === resourceId);
  if (!r) return preview;
  const l = layer("model", r.name);
  l.id = "@preprocess:" + r.id;
  l.width = 540;
  l.height = 648;
  l.receiveLight = false;
  l.model = {
    resourceId: r.id,
    physics: false,
    parameterMap: {},
    groupOverrides: {},
    baseValues: {},
    keys: [],
    lipOpen: "",
    lipForm: "",
  };
  addVisual(preview, l, 0, 1);
  return preview;
}
