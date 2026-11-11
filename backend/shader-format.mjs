export const shaderFormat = "framestudio-glsl";
export const shaderBytes = 64 * 1024;
const idPattern = /^[a-z][a-z0-9_]{0,23}$/i;
const object = v => v && typeof v === "object" && !Array.isArray(v);
const requireField = (condition, message) => {
  if (!condition) throw Error(message);
};
const title = v => typeof v === "string" && v.trim().length > 0 && v.length <= 80;

function checkSource(source, id) {
  requireField(typeof source === "string" && source.length <= 12000, `通道 ${id} 的 GLSL 需小于 12,000 字符`);
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, " ");
  requireField(/\bvec4\s+shade\s*\(\s*vec2\s+\w+\s*\)/.test(code), `通道 ${id} 需要 vec4 shade(vec2 uv)`);
  requireField(!/#|\\|\b(?:while|do|uniform|varying|attribute|inout|out|discard|main|gl_\w+)\b/.test(code),
    `通道 ${id} 使用了宿主保留语法或不受支持的 GLSL 语法`);
  const loop = /\bfor\s*\(\s*int\s+([a-zA-Z_]\w*)\s*=\s*0\s*;\s*\1\s*<\s*(\d{1,2})\s*;\s*(?:\+\+\s*\1|\1\s*\+\+)\s*\)/g;
  let budget = 1;
  const counters = new Set();
  const body = code.replace(loop, (_, counter, count) => {
    counters.add(counter);
    budget *= Math.max(1, Number(count));
    return "";
  });
  requireField(!/\bfor\b/.test(body) && budget <= 128, `通道 ${id} 的 for 循环必须从 0 开始，以整数常量为上限，总循环预算为 128`);
  for (const counter of counters) {
    const write = new RegExp(`\\b${counter}\\s*(?:=(?!=)|[+*/%-]=|\\+\\+|--)|(?:\\+\\+|--)\\s*${counter}\\b`);
    requireField(!write.test(body), `通道 ${id} 不可修改循环计数器 ${counter}`);
  }
}

export function validateCodeShader(value) {
  requireField(object(value) && value.format === shaderFormat && value.version === 1, "需要 framestudio-glsl v1 着色器文件");
  requireField(title(value.name), "着色器名称需为 1–80 字符");
  requireField(value.enabled === undefined || typeof value.enabled === "boolean", "enabled 必须为布尔值");
  const entries = Object.entries(value.parameters ?? {});
  requireField(object(value.parameters ?? {}) && entries.length <= 16, "parameters 需要对象且最多有 16 项");
  const parameters = Object.fromEntries(entries.map(([id, p]) => {
    requireField(idPattern.test(id) && object(p) && title(p.label) &&
      [p.min, p.max, p.value].every(n => Number.isFinite(n) && Math.abs(n) <= 100000) &&
      p.min < p.max && p.value >= p.min && p.value <= p.max, `无效的参数 ${id}`);
    return [id, { label: p.label.trim(), min: p.min, max: p.max, value: p.value }];
  }));
  requireField(Array.isArray(value.passes) && value.passes.length >= 1 && value.passes.length <= 4, "需要 1–4 个 GLSL 通道");
  const ids = new Set();
  const passes = value.passes.map((p, i) => {
    requireField(object(p) && typeof p.id === "string" && idPattern.test(p.id) && !ids.has(p.id), "通道 id 必须有效且唯一");
    const scale = p.scale ?? 1;
    requireField([1, 0.5, 0.25].includes(scale) && (i < value.passes.length - 1 || scale === 1), "通道 scale 必须为 1、0.5 或 0.25，最终通道须为 1");
    ids.add(p.id);
    checkSource(p.source, p.id);
    return { id: p.id, source: p.source, scale };
  });
  const shader = { format: shaderFormat, version: 1, name: value.name.trim(), enabled: value.enabled !== false, parameters, passes };
  requireField(new TextEncoder().encode(JSON.stringify(shader)).length <= shaderBytes, "着色器文件超过 64 KiB");
  return shader;
}
