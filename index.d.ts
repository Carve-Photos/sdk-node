export class CarveError extends Error {
  statusCode: number | null;
  detail: unknown;
  constructor(message: string, statusCode?: number | null, detail?: unknown);
}

export class ImageResult {
  imageId: string;
  url: string;
  data: Buffer;
  readonly size: number;
  save(filePath: string): Promise<string>;
}

export class VideoResult {
  videoId: string;
  url: string;
  previewUrl: string | null;
  data: Buffer;
  readonly size: number;
  save(filePath: string): Promise<string>;
}

export interface RemoveBackgroundParams {
  format?: "png" | "webp" | "jpg" | "zip";
  size?: "preview" | "medium" | "hd" | "full" | "auto" | string;
  bgColor?: string;
  crop?: boolean;
  cropMargin?: string;
  cropThreshold?: number;
  roi?: string;
  scale?: string;
  position?: string;
  pollInterval?: number;
  timeout?: number;
}

export interface RemoveBackgroundVideoParams {
  format?: "mp4" | "pro_bundle";
  processingType?: "human" | "object";
  backgroundColor?: string;
  startTimeSec?: number;
  endTimeSec?: number;
  pollInterval?: number;
  timeout?: number;
}

export interface Balance {
  total: number;
  details: {
    api_calls: number;
    points: number;
  };
}

export class CarveClient {
  constructor(apiKey: string, options?: { baseUrl?: string });
  removeBackground(image: string | Buffer, params?: RemoveBackgroundParams): Promise<ImageResult>;
  removeBackgroundVideo(video: string | Buffer, params?: RemoveBackgroundVideoParams): Promise<VideoResult>;
  getBalance(): Promise<Balance>;
}
