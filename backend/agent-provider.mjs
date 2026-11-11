export const deepseekPreset = {
  endpoint: "https://api.deepseek.com",
  model: "deepseek-flash",
  models: ["deepseek-flash", "deepseek-v4-pro"],
};

export function isDeepSeekEndpoint(endpoint) {
  try { return new URL(endpoint).origin === deepseekPreset.endpoint; }
  catch { return false; }
}

export function supportsAgentVision(endpoint, model) {
  return isDeepSeekEndpoint(endpoint) && ["deepseek-flash","deepseek-v4-flash","deepseek-v4-flash-vision-exp"].includes(model);
}

export function chatCompletionPayload(endpoint, model, thinking, messages, tools) {
  if (!isDeepSeekEndpoint(endpoint)) return {model, messages, tools, tool_choice:"auto"};
  const history = messages.map(message => {
    if (message.role !== "assistant") return message;
    const {reasoning_content, ...assistant} = message;
    if (assistant.tool_calls?.length && assistant.content === null) assistant.content = "";
    if (thinking && typeof reasoning_content === "string") assistant.reasoning_content = reasoning_content;
    return assistant;
  });
  // DeepSeek defaults to automatic tool selection when tools are present.
  return {model, messages:history, tools, thinking:{type:thinking ? "enabled" : "disabled"}};
}
