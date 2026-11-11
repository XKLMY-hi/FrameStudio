import type { AssistantMessage, AgentProgress } from "../src/theater/agent-turn";
export function readAgentJson(response: Response, onActivity?:()=>void, limit?:number): Promise<any>;
export function readAgentResponse(response: Response, key?: string, publish?: (event: Omit<AgentProgress,"requestId">)=>void, onActivity?:()=>void): Promise<AssistantMessage>;
