export const deepseekPreset: {endpoint: string; model: string; models: string[]};
export function isDeepSeekEndpoint(endpoint: string): boolean;
export function supportsAgentVision(endpoint: string, model: string): boolean;
export function chatCompletionPayload<T, U>(
  endpoint: string, model: string, thinking: boolean, messages: T[], tools: U[],
): {model: string; messages: T[]; tools: U[]; tool_choice?: "auto"; thinking?: {type: "enabled" | "disabled"}};
