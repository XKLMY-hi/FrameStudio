import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shaderBytes } from "./shader-format.mjs";
import { graphTools, graphInstructions } from "./graph-tools.mjs";

const argv = process.argv.slice(2);
const dataDir = argv[0] === "--data-dir" && argv[1]
  ? path.resolve(argv[1])
  : fileURLToPath(new URL("../data/", import.meta.url));
const object = (properties, required = Object.keys(properties)) => ({
  type: "object", properties, required, additionalProperties: false,
});
const id = { type: "string", description: "The candidate ID returned by shader_submit." };
const scalar = { type: "number" };
const shader = object({
  format: { const: "framestudio-glsl", type: "string" },
  version: { const: 1, type: "integer" },
  name: { type: "string", maxLength: 80 },
  enabled: { type: "boolean", default: true },
  parameters: { type: "object", additionalProperties: object({
    label: { type: "string" }, min: scalar, max: scalar, value: scalar,
  }) },
  passes: { type: "array", minItems: 1, maxItems: 4, items: object({
    id: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]{0,23}$" },
    source: { type: "string", maxLength: 12000, description: "GLSL ES 1.00 helpers and vec4 shade(vec2 uv)." },
    scale: { type: "number", enum: [1, 0.5, 0.25] },
  }, ["id", "source"]) },
}, ["format", "version", "name", "passes"]);
const definitions = [
  ["shader_context", "context", "Read the active FrameStudio canvas size, playhead, shader ABI and available output/layer targets.", object({}), true],
  ["shader_submit", "submit", "Compile and preview a GLSL candidate. No project changes until shader_apply. Poll shader_status for diagnostics or a preview image when sharing is enabled.", object({
    target: { type: "string", description: "Use output for the completed canvas or a layer ID from shader_context." }, shader,
  }), false],
  ["shader_status", "status", "Read candidate status, compilation/preview errors and an optional user-enabled JPEG preview.", object({ id }), true],
  ["shader_apply", "apply", "Apply a ready candidate to the project as one undoable change. Poll shader_status until applied. Use when the user wants the candidate applied.", object({ id }), false],
  ["shader_discard", "discard", "Discard the temporary preview and show the project's current shader.", object({ id }), false],
  ...graphTools.map(t => [t.name,t.action,t.description,t.name === "graph_edit" ? {
    ...t.inputSchema, properties:{...t.inputSchema.properties,revision:{type:"string",description:"Optional revision returned by graph_read."}},
  } : t.inputSchema,t.readOnlyHint]),
];
const instructions = `FrameStudio GLSL ES 1.00. Each pass implements vec4 shade(vec2 uv).
UV origin is top-left. Functions source(uv), inputColor(uv), and sample_<earlier_pass_id>(uv) return straight RGBA, transparent outside 0–1. Return straight RGBA. Preserve source alpha unless the requested effect adds coverage.
Uniforms: float uTime (timeline seconds), vec2 uResolution (canvas pixels), vec2 uTexel (1/uResolution), float p_<parameter_id>. Final pass scale 1; intermediates 1, 0.5, 0.25. No declarations of uniforms, preprocessor directives, while/do, or dynamic loops. Use for(int i=0; i<9; i++) and at most 128 total loop iterations including nested loops.
Call shader_context, shader_submit, then shader_status. Fix reported GLSL errors and resubmit. Use shader_apply when requested. Drafts never enter video exports.
${graphInstructions}
For MCP use shader_context in place of graph_context. graph_edit returns a draft ID; follow with shader_status.`;

async function call(action, args) {
  const { port, token } = JSON.parse(await readFile(path.join(dataDir, "shader-mcp.json"), "utf8").catch(() => {
    throw Error("FrameStudio connection file missing. Launch the app or configure --data-dir.");
  }));
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[a-f0-9]{64}$/.test(token)) throw Error("Invalid FrameStudio connection file.");
  const response = await fetch(`http://127.0.0.1:${port}/agent/shader`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(4500),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...args, action }),
  }).catch(() => { throw Error("FrameStudio is not reachable. Open the app and enable its shader MCP."); });
  const result = await response.json();
  if (!response.ok) throw Error(result.error);
  const { image, ...data } = result;
  if (action === "context") data.shaderABI = instructions;
  const content = [{ type: "text", text: JSON.stringify(data) }];
  if (action === "status" && image) content.push({ type: "image", mimeType: "image/jpeg", data: image.split(",")[1] });
  return { structuredContent: data, content };
}

const send = (id, value, error = false) => process.stdout.write(JSON.stringify({
  jsonrpc: "2.0", id, [error ? "error" : "result"]: value,
}) + "\n");
const lines = createInterface({ input: process.stdin, terminal: false });
let initialized = false;
for await (const line of lines) {
  let req;
  try {
    if (Buffer.byteLength(line) > 5 * shaderBytes) throw Error("Request too large");
    req = JSON.parse(line);
  } catch (err) {
    send(null, { code: -32700, message: err.message }, true);
    continue;
  }
  if (!req || req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    send(req?.id ?? null, { code: -32600, message: "Invalid request" }, true);
    continue;
  }
  if (req.id === undefined) continue;
  if (req.method === "initialize") {
    const requested = req.params?.protocolVersion;
    const protocolVersion = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"].includes(requested)
      ? requested : "2025-11-25";
    initialized = true;
    send(req.id, { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "framestudio-shaders", version: "1.0.0" }, instructions });
  } else if (req.method === "ping") send(req.id, {});
  else if (!initialized) send(req.id, { code: -32002, message: "MCP session not initialized" }, true);
  else if (req.method === "tools/list") send(req.id, {
    tools: definitions.map(([name, , description, inputSchema, readOnlyHint]) => ({
      name, description, inputSchema, annotations: { readOnlyHint, openWorldHint: false },
    })),
  });
  else if (req.method === "tools/call") {
    const definition = definitions.find(([name]) => name === req.params?.name);
    if (!definition) send(req.id, { code: -32602, message: "Unknown shader tool" }, true);
    else {
      try { send(req.id, await call(definition[1], req.params?.arguments)); }
      catch (err) { send(req.id, { isError: true, content: [{ type: "text", text: err.message }] }); }
    }
  } else send(req.id, { code: -32601, message: "Method not found" }, true);
}
