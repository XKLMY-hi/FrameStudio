// Cubism Core's JS views do not follow a grown native heap. A later MOC/model
// allocation can leave earlier models writing parameters into an obsolete buffer.
// Refresh both Core views and the SDK's cached aliases at allocation boundaries.
const guards = new WeakMap<object, CubismMemoryGuard>();
export class CubismMemoryGuard {
  private nativeModels = new Set<any>();
  private owners = new Map<any, Map<any, () => void>>();
  private heap?: ArrayBufferLike;
  growths = 0;
  repairs = 0;
  constructor(private Core: any) {
    const guard = this,
      mocFactory = Core.Moc.fromArrayBuffer,
      modelFactory = Core.Model.fromMoc,
      release = Core.Model.prototype.release;
    Core.Moc.fromArrayBuffer = function (...args: any[]) {
      try {
        return mocFactory.apply(this, args);
      } finally {
        guard.synchronize();
      }
    };
    Core.Model.fromMoc = function (...args: any[]) {
      let model;
      try {
        model = modelFactory.apply(this, args);
        if (model) guard.nativeModels.add(model);
        return model;
      } finally {
        guard.synchronize(model);
      }
    };
    Core.Model.prototype.release = function (...args: any[]) {
      guard.nativeModels.delete(this);
      guard.owners.delete(this);
      return release.apply(this, args);
    };
  }
  track(core: any, onRefresh: () => void) {
    const raw = core._model;
    this.nativeModels.add(raw);
    let entries = this.owners.get(raw);
    if (!entries) {
      entries = new Map();
      this.owners.set(raw, entries);
    }
    entries.set(core, onRefresh);
    this.synchronize(raw);
    this.bindOwner(core, raw);
    return () => {
      entries!.delete(core);
      if (!entries!.size) this.owners.delete(raw);
    };
  }
  private bindOwner(core: any, raw: any) {
    core._parameterValues = raw.parameters.values;
    core._parameterMinimumValues = raw.parameters.minimumValues;
    core._parameterMaximumValues = raw.parameters.maximumValues;
    core._partOpacities = raw.parts.opacities;
  }
  synchronize(probe?: any) {
    probe = probe || [...this.nativeModels].find((raw) => raw._ptr);
    if (!probe?._ptr) return;
    // Constructors query Core's current heap, including a growth during Model's
    // own construction. No new native model is allocated here.
    const fresh = new this.Core.Parameters(probe._ptr),
      buffer = fresh.values.buffer;
    if (this.heap && this.heap !== buffer) this.growths++;
    this.heap = buffer;
    for (const raw of this.nativeModels) {
      if (!raw._ptr || raw.parameters.values.buffer === buffer) continue;
      raw.parameters =
        raw === probe ? fresh : new this.Core.Parameters(raw._ptr);
      raw.parts = new this.Core.Parts(raw._ptr);
      raw.drawables = new this.Core.Drawables(raw._ptr);
      this.repairs++;
      for (const [owner, notify] of this.owners.get(raw) || []) {
        this.bindOwner(owner, raw);
        notify();
      }
    }
  }
}
export function cubismMemoryGuard(Core: any) {
  let guard = guards.get(Core);
  if (!guard) {
    guard = new CubismMemoryGuard(Core);
    guards.set(Core, guard);
  }
  return guard;
}
