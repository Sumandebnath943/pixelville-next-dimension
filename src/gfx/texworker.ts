/* Texture worker: runs one procedural generator from textures.ts and hands
   its pixel arrays back to the page (see "off-thread generation" there). */
import { generateRaw, setTextureScale } from './textures';

self.onmessage = (e: MessageEvent<{ id: number; name: string; args: unknown[]; res: number }>) => {
  const { id, name, args, res } = e.data;
  setTextureScale(res);
  const data = generateRaw(name, args);
  (self as unknown as Worker).postMessage({ id, data }, data.map((d) => d.buffer));
};
