import type { Scene } from '../src/theater/schema';
export function saveLivemg(project: Scene, data: string, thumbnail?: string): Promise<Uint8Array>;
export function openLivemg(bytes: Uint8Array, data: string): Promise<Scene>;
export function volumeEnvelope(file: string, duration: number, points: {t:number,v:number}[]): Promise<void>;
