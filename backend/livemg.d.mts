import type { Montage } from "../src/theater/montage";
import type { Scene } from '../src/theater/schema';
export function saveLivemg(project: Scene | Montage, data: string, thumbnail?: string, options?:{container?:boolean;embedCanvases?:boolean;includeAssets?:boolean}): Promise<Uint8Array>;
export function openLivemg(bytes: Uint8Array, data: string): Promise<Scene | Montage>;
export function volumeEnvelope(file: string, duration: number, points: {t:number,v:number}[]): Promise<void>;
