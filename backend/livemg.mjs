import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
function safe(root, p) {
  const dest = path.resolve(root, p);
  if (dest !== root && !dest.startsWith(root + path.sep))
    throw Error("工程资源路径越界");
  return dest;
}
async function walk(root, prefix = "") {
  const out = [];
  for (const f of await fs.readdir(root, { withFileTypes: true })) {
    const p = prefix + f.name;
    if (f.isDirectory())
      out.push(...(await walk(path.join(root, f.name), p + "/")));
    else out.push(p);
  }
  return out;
}
const hash = (v) => createHash("sha256").update(v).digest("hex");
export async function saveLivemg(project, data, thumbnail) {
  if (project.format !== "livemg" || project.version !== 2)
    throw Error("无效的 .livemg 工程");
  const files = { "project.json": strToU8(JSON.stringify(project)) };
  const modelIds = [...new Set(project.models.map((m) => m.modelId))];
  for (const id of modelIds) {
    const dir = safe(path.join(data, "models"), id);
    for (const f of await walk(dir))
      files["models/" + id + "/" + f] = new Uint8Array(
        await fs.readFile(safe(dir, f)),
      );
  }
  for (const asset of project.assets) {
    if (!asset.path) continue;
    files["assets/" + asset.path] = new Uint8Array(
      await fs.readFile(safe(data, asset.path)),
    );
  }
  if (thumbnail && /^data:image\/png;base64,/.test(thumbnail))
    files["thumbnail.png"] = Buffer.from(thumbnail.split(",")[1], "base64");
  files["manifest.json"] = strToU8(
    JSON.stringify(
      {
        format: "livemg",
        schemaVersion: 2,
        appVersion: "2.7.2",
        savedAt: new Date().toISOString(),
        files: Object.entries(files).map(([file, bytes]) => ({
          file,
          bytes: bytes.length,
          sha256: hash(bytes),
        })),
        embeddedFonts: project.assets
          .filter((a) => a.kind === "font")
          .map((a) => a.fontFamily),
      },
      null,
      2,
    ),
  );
  return zipSync(files, { level: 1 });
}
export async function openLivemg(bytes, data) {
  const files = unzipSync(bytes);
  if (!files["manifest.json"] || !files["project.json"])
    throw Error("缺少 .livemg 工程清单");
  const manifest = JSON.parse(strFromU8(files["manifest.json"])),
    p = JSON.parse(strFromU8(files["project.json"]));
  if (
    manifest.format !== "livemg" ||
    manifest.schemaVersion !== 2 ||
    p.version !== 2 ||
    !Array.isArray(p.layers) ||
    !Array.isArray(p.tracks)
  )
    throw Error("工程格式或版本不支持");
  let total = 0;
  const listed = new Set(manifest.files.map((v) => v.file));
  if (
    listed.size !== manifest.files.length ||
    Object.keys(files).some(
      (n) => !n.endsWith("/") && n !== "manifest.json" && !listed.has(n),
    )
  )
    throw Error("工程包含未校验或重复的资源");
  for (const v of manifest.files) {
    const f = files[v.file];
    if (!f || f.length !== v.bytes || hash(f) !== v.sha256)
      throw Error("工程资源损坏或缺失：" + v.file);
    total += f.length;
    if (total > 1024 * 1024 * 1024) throw Error("工程资源超过 1 GB");
  }
  const prefix = "livemg-" + randomUUID().slice(0, 8),
    remap = new Map();
  for (const m of p.models) {
    if (!remap.has(m.modelId))
      remap.set(
        m.modelId,
        prefix + "-" + m.modelId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50),
      );
  }
  for (const [old, id] of remap) {
    const key = "models/" + old + "/";
    for (const [n, v] of Object.entries(files)) {
      if (!n.startsWith(key) || n.endsWith("/")) continue;
      const dest = safe(path.join(data, "models", id), n.slice(key.length));
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, v);
    }
  }
  for (const m of p.models) m.modelId = remap.get(m.modelId);
  for (const a of p.assets) {
    const file = files["assets/" + a.path];
    if (!file) throw Error("缺少媒体资源：" + a.name);
    const next = "media/" + prefix + "/" + a.id + path.extname(a.path),
      dest = safe(data, next);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, file);
    a.path = next;
  }
  return p;
}
export async function volumeEnvelope(file, duration, points) {
  const rate = 48000,
    count = Math.ceil(duration * rate),
    header = Buffer.alloc(44);
  header.write("RIFF");
  header.writeUInt32LE(36 + count * 2, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(count * 2, 40);
  const handle = await fs.open(file, "w");
  try {
    await handle.write(header);
    let cursor = 0;
    for (let start = 0; start < count; start += 8192) {
      const n = Math.min(8192, count - start),
        b = Buffer.alloc(n * 2);
      for (let i = 0; i < n; i++) {
        const t = (start + i) / rate;
        while (cursor < points.length - 2 && points[cursor + 1].t <= t)
          cursor++;
        const a = points[cursor] || { t: 0, v: 1 },
          z = points[cursor + 1] || a,
          ratio =
            z.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (z.t - a.t))) : 0,
          v = a.v + (z.v - a.v) * ratio;
        b.writeInt16LE(Math.round(Math.max(0, Math.min(1, v)) * 32767), i * 2);
      }
      await handle.write(b);
    }
  } finally {
    await handle.close();
  }
}
