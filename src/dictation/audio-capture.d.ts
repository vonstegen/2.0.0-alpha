// Type definitions for audio-capture.js.

export const WORKLET_URL: string;

export interface CaptureOptions {
  stream: MediaStream;
  sampleRate?: number;
  chunkFrames?: number;
  onChunk: (pcm: Float32Array) => void;
  onError?: (error: Error) => void;
  workletUrl?: string;
}

export interface CaptureHandle {
  stop: () => void;
  isWorklet: () => boolean;
}

export function startCapture(options: CaptureOptions): Promise<CaptureHandle>;
