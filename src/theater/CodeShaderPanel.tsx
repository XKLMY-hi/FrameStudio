import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { type CodeShader } from "../../backend/shader-format.mjs";
import type { Scene } from "./schema";
import type { EffectGraph } from "./effect-graph";

export type ShaderTarget = { id: string; name: string; kind: string; available: boolean };
export type ShaderContext = {
  document: string; width: number; height: number; time: number; busy: boolean;
  sharePreview: boolean; targets: ShaderTarget[]; selected?: string;
};
type Candidate = {
  id: string; document: string; target: string; name: string; shader?: CodeShader; edits?: unknown; revision?: string;
  status: "queued" | "ready" | "failed" | "publishing" | "applied" | "canceled";
  error?: string;
};
type Result = { id: string; status: "ready" | "failed" | "applied"; error?: string; image?: string };
type ReadRequest = { id: string; target: string; document: string };
type GraphRead = { graph: EffectGraph; revision: string };
export type ShaderDraft = { target: string; graph: EffectGraph; name: string; revision: string };
type Callbacks = {
  context: () => Omit<ShaderContext, "sharePreview">;
  version: (target: string) => string;
  read: (target: string) => GraphRead;
  preview: (candidate: Candidate) => EffectGraph;
  apply: (target: string, graph: EffectGraph) => void;
  clear: (graph: EffectGraph) => void;
  capture: () => string;
};
const message = (e: unknown) => e instanceof Error ? e.message : String(e);

export function shaderTargets(scene: Scene): ShaderTarget[] {
  return [
    { id: "output", name: "画布最终输出", kind: "output", available: true },
    ...scene.layers.filter(l => l.kind !== "audio" && l.kind !== "light").map(l => ({
      id: l.id, name: l.name, kind: l.kind, available: !l.locked,
    })),
  ];
}

export function useShaderAgent(callbacks: Callbacks) {
  const [enabled, setEnabled] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [status, setStatus] = useState<Candidate>();
  const [error, setError] = useState("");
  const latest = useRef({ callbacks, sharing });
  latest.current = { callbacks, sharing };
  const client = useRef(crypto.randomUUID());
  const active = useRef<{ id: string; base: string; graph: EffectGraph } | undefined>(undefined);
  const desired = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    let action = "enable";
    let result: Result | undefined;
    let read: ({ id: string } & (GraphRead | { error: string })) | undefined;
    let timer: ReturnType<typeof setTimeout>;
    let inFlight: Promise<unknown> | undefined;
    const request = (body: object) => api<{ enabled: boolean; candidate?: Candidate; read?: ReadRequest }>("shader-agent", { client: client.current, ...body });
    async function tick() {
      const current = latest.current;
      const context = { ...current.callbacks.context(), sharePreview: current.sharing };
      try {
        inFlight = request({ action, context, result, read });
        const reply = await inFlight as Awaited<ReturnType<typeof request>>;
        if (stop || !desired.current) return;
        if (!reply.enabled) throw Error("另一个编辑窗口已接管着色器 MCP");
        action = "sync";
        result = undefined;
        read = undefined;
        const c = reply.candidate;
        if (!c || c.id !== active.current?.id || ["canceled", "failed", "applied"].includes(c.status)) {
          if (active.current) latest.current.callbacks.clear(active.current.graph);
          active.current = undefined;
        }
        setStatus(old => old?.id === c?.id && old?.status === c?.status && old?.error === c?.error ? old : c);
        setError("");
        const currentContext = latest.current.callbacks.context();
        if (reply.read?.document === currentContext.document) {
          const { id, target } = reply.read;
          try { read = { id, ...latest.current.callbacks.read(target) }; }
          catch (e) { read = { id, error: message(e) }; }
        }
        if (c && c.document === currentContext.document && !currentContext.busy) {
          const cb = latest.current.callbacks;
          try {
            if (c.status === "queued") {
              const base = cb.version(c.target);
              if (c.revision && c.revision !== base) throw Error("节点图已变更，请重新读取");
              const graph = cb.preview(c);
              active.current = { id: c.id, base, graph };
              const image = latest.current.sharing ? cb.capture() : undefined;
              result = { id: c.id, status: "ready", image };
            } else if (c.status === "publishing") {
              if (!active.current || cb.version(c.target) !== active.current.base)
                throw Error("目标着色器已变更，请重新提交预览");
              cb.apply(c.target, active.current.graph);
              result = { id: c.id, status: "applied" };
            }
          } catch (e) {
            if (active.current) cb.clear(active.current.graph);
            result = { id: c.id, status: "failed", error: message(e) };
          }
        }
      } catch (e) {
        if (!stop) setError(message(e));
      } finally {
        if (!stop) timer = setTimeout(tick, result || read ? 40 : 520);
      }
    }
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
      // Disable after the last request to avoid a late enable leaving the bridge open.
      void Promise.resolve(inFlight).catch(() => {}).then(() => {
        if (!desired.current) return request({ action: "disable" }).catch(() => {});
      });
    };
  }, [enabled]);

  return {
    enabled, sharing, status, error, setSharing,
    async resolve(action: "apply" | "discard", id: string) {
      try {
        await api("shader-agent", { client: client.current, action, id });
      } catch (err) {
        setError(message(err));
      }
    },
    toggle(value: boolean) {
      desired.current = value;
      if (!value) {
        if (active.current) callbacks.clear(active.current.graph);
        active.current = undefined;
        setStatus(undefined);
        setError("");
        setSharing(false);
      }
      setEnabled(value);
    },
  };
}

export function McpControls({agent,openGraph}:{agent:ReturnType<typeof useShaderAgent>;openGraph:(id:string)=>void}) {
  const remote=agent.status;
  return <div className="studio-mcp-controls" aria-label="本地 MCP">
    <label><input type="checkbox" checked={agent.enabled} onChange={e=>agent.toggle(e.target.checked)}/> 启用本地 MCP</label>
    {agent.enabled && <label><input type="checkbox" checked={agent.sharing} onChange={e=>agent.setSharing(e.target.checked)}/> 允许 Agent 读取预览画面</label>}
    {remote && <p role="status">{remote.name} · {{
      queued:"等待试渲染",ready:"草稿待确认",failed:"试渲染失败",publishing:"正在应用",applied:"已应用",canceled:"已取消",
    }[remote.status]}</p>}
    {remote?.status==="ready" && <div className="shader-actions">
      <button onClick={()=>openGraph(remote.target)}>查看 Agent 节点</button>
      <button onClick={()=>void agent.resolve("apply",remote.id)}>应用 Agent 草稿</button>
      <button onClick={()=>void agent.resolve("discard",remote.id)}>取消 Agent 预览</button>
    </div>}
    {(agent.error||remote?.error) && <p role="alert">{agent.error||remote?.error}</p>}
  </div>;
}
