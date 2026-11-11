import { randomBytes, randomUUID } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { shaderBytes, validateCodeShader } from "./shader-format.mjs";

export const agentBodyLimit = 5 * shaderBytes;
export function createShaderAgent(data) {
  const token = randomBytes(32).toString("hex");
  const discovery = path.join(data, "shader-mcp.json");
  let owner, context, seen = 0, candidate;
  const reads = new Map();
  const clearReads = () => {
    for (const request of reads.values()) request.finish({ error: "编辑会话已变更" });
  };
  const clear = () => {
    clearReads();
    owner = context = candidate = undefined;
    seen = 0;
  };
  const active = () => {
    if (Date.now() - seen > 12000) clear();
    return !!owner;
  };
  const status = () => {
    if (!candidate) return { status: "idle" };
    const { id, status, target, error, name, image } = candidate;
    return { id, status, target, name, error, image };
  };
  function update(body) {
    if (!candidate || body.id !== candidate.id) throw Error("此预览已过期，请重新提交着色器");
    if (body.action === "apply") {
      if (candidate.status === "ready") candidate.status = "publishing";
      else if (!["publishing", "applied"].includes(candidate.status)) throw Error("请先等待着色器试渲染通过");
    } else if (body.action === "discard") {
      if (!["queued", "ready", "failed", "canceled"].includes(candidate.status))
        throw Error("此版本已进入应用流程，可在编辑器中撤销");
      candidate.status = "canceled";
      candidate.image = undefined;
    } else if (body.action !== "status") throw Error("未知着色器操作");
    return status();
  }

  return {
    token,
    async listen(port) {
      const temp = `${discovery}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify({ port, token }), { mode: 0o600 });
      await rename(temp, discovery);
    },
    editor(body) {
      if (typeof body.client !== "string" || body.client.length > 80) throw Error("无效编辑器会话");
      if (body.action === "disable") {
        if (owner === body.client) clear();
        return {};
      }
      if (body.action === "enable") {
        if (owner !== body.client) clear();
        owner = body.client;
      }
      if (owner !== body.client) return { enabled: false };
      if (["apply", "discard"].includes(body.action)) return update(body);
      const before = context?.document;
      context = body.context;
      seen = Date.now();
      if (before && before !== context?.document) {
        candidate = undefined;
        clearReads();
      }
      if (body.read && reads.has(body.read.id)) reads.get(body.read.id).finish(body.read);
      if (candidate && body.result?.id === candidate.id) {
        const { status, error, image } = body.result;
        if ((candidate.status === "queued" && ["ready", "failed"].includes(status)) ||
            (candidate.status === "publishing" && ["applied", "failed"].includes(status))) {
          candidate.status = status;
          candidate.error = typeof error === "string" ? error.slice(0, 4000) : undefined;
          candidate.image = context?.sharePreview && typeof image === "string" && image.length <= 48000 &&
            /^data:image\/jpeg;base64,[a-zA-Z0-9+/=]+$/.test(image) ? image : undefined;
        }
      }
      if (candidate && !context?.sharePreview) candidate.image = undefined;
      const next = reads.values().next().value;
      return { enabled: true, candidate: candidate ? { ...candidate, image: undefined } : null,
        read: next && {id:next.id, target:next.target, document:context.document} };
    },
    agent(body) {
      if (!active() || !context?.document) throw Error("请打开 FrameStudio，并在「代码着色器」启用 MCP");
      if (body.action === "context") return context;
      if (["submit", "graph_edit", "graph_read"].includes(body.action)) {
        if (context.busy) throw Error("编辑器正在加载或导出，请稍后重试");
        const target = body.target;
        if (!context.targets.some(t => t.id === target && t.available)) throw Error("目标不存在或已锁定，请重新读取 shader_context");
        if (body.action === "graph_read") {
          if (reads.size >= 4) throw Error("已有多条图读取请求");
          const id = randomUUID();
          return new Promise((resolve,reject) => {
            const finish = result => {
              clearTimeout(timer);
              reads.delete(id);
              if (result.error) reject(Error(result.error));
              else resolve({target, graph:result.graph, revision:result.revision});
            };
            const timer = setTimeout(() => finish({error:"等待编辑器读取节点超时"}), 3500);
            reads.set(id,{id,target,finish});
          });
        }
        if (candidate?.status === "publishing") throw Error("正在应用上一版着色器");
        const payload = body.action === "submit" ? {shader:validateCodeShader(body.shader)} : {edits:body.edits, revision:body.revision};
        if (body.action === "graph_edit" && (!Array.isArray(payload.edits) || !payload.edits.length || payload.edits.length > 24))
          throw Error("需要 1–24 项节点操作");
        candidate = { id: randomUUID(), document: context.document, target, ...payload,
          name: payload.shader?.name ?? "节点图调整", status: "queued" };
      } else return update(body);
      return status();
    },
  };
}
