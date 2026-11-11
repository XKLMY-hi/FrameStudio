export type CodeShader = {
  format: "framestudio-glsl";
  version: 1;
  name: string;
  enabled: boolean;
  parameters: Record<string, { label: string; min: number; max: number; value: number }>;
  passes: { id: string; source: string; scale: 1 | 0.5 | 0.25 }[];
};
export const shaderFormat: "framestudio-glsl";
export const shaderBytes: number;
export function validateCodeShader(value: unknown): CodeShader;
