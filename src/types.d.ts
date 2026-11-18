declare module "gifenc" {
  export function GIFEncoder(opts?: any): {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: any): void;
    finish(): void;
    bytes(): Uint8Array;
  };
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, opts?: any): number[][];
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: number[][], format?: string): Uint8Array;
}
