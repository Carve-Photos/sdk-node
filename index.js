/**
 * Carve.Photos — Node.js SDK for background removal API.
 *
 * @example
 * const { CarveClient } = require("carvesdk");
 * const client = new CarveClient("YOUR_API_KEY");
 *
 * // Remove background from image
 * const result = await client.removeBackground("photo.jpg");
 * await result.save("result.png");
 *
 * Full documentation: https://carve.photos/help/api-docs
 */

const fs = require("fs");
const path = require("path");

const BASE_URL = "https://api.carve.photos/api/v1";

class CarveError extends Error {
  constructor(message, statusCode, detail) {
    super(message);
    this.name = "CarveError";
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

class CarveClient {
  /**
   * @param {string} apiKey - Your Carve.Photos API key
   * @param {object} [options]
   * @param {string} [options.baseUrl] - Custom API base URL
   */
  constructor(apiKey, options = {}) {
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl || BASE_URL).replace(/\/$/, "");
  }

  /**
   * Remove background from an image.
   *
   * @param {string|Buffer|ReadableStream} image - Path to image or Buffer
   * @param {object} [params]
   * @param {string} [params.format="png"] - png, webp, jpg, zip
   * @param {string} [params.size="auto"] - preview, medium, hd, full, auto
   * @param {string} [params.bgColor] - Background hex color
   * @param {boolean} [params.crop=false] - Crop to object bounds
   * @param {string} [params.cropMargin] - Margin, e.g. "10%"
   * @param {string} [params.scale] - Object scale, e.g. "75%"
   * @param {string} [params.position] - Position, e.g. "center"
   * @param {number} [params.pollInterval=2000] - Poll interval in ms
   * @param {number} [params.timeout=120000] - Timeout in ms
   * @returns {Promise<ImageResult>}
   */
  async removeBackground(image, params = {}) {
    const {
      format = "png",
      size = "auto",
      bgColor,
      crop = false,
      cropMargin,
      cropThreshold,
      roi,
      scale,
      position,
      pollInterval = 2000,
      timeout = 120000,
    } = params;

    const formData = new FormData();
    formData.append("image", await this._toBlob(image));
    formData.append("format", format);
    formData.append("size", size);
    if (bgColor) formData.append("bg_color", bgColor);
    if (crop) formData.append("crop", "true");
    if (cropMargin) formData.append("crop_margin", cropMargin);
    if (cropThreshold != null) formData.append("crop_threshold", String(cropThreshold));
    if (roi) formData.append("roi", roi);
    if (scale) formData.append("scale", scale);
    if (position) formData.append("position", position);

    const resp = await this._fetch(`/images/remove_bg`, {
      method: "POST",
      body: formData,
    });
    await this._check(resp, 202);
    const { image_id } = await resp.json();

    return this._pollImage(image_id, pollInterval, timeout);
  }

  /**
   * Remove background from a video.
   *
   * @param {string|Buffer|ReadableStream} video - Path to video or Buffer
   * @param {object} [params]
   * @param {string} [params.format="mp4"] - mp4 or pro_bundle
   * @param {string} [params.processingType="human"] - human or object
   * @param {string} [params.backgroundColor="#00B140"] - Hex color
   * @param {number} [params.startTimeSec=0] - Trim start
   * @param {number} [params.endTimeSec=0] - Trim end (0 = full)
   * @param {number} [params.pollInterval=5000] - Poll interval in ms
   * @param {number} [params.timeout=600000] - Timeout in ms
   * @returns {Promise<VideoResult>}
   */
  async removeBackgroundVideo(video, params = {}) {
    const {
      format = "mp4",
      processingType = "human",
      backgroundColor = "#00B140",
      startTimeSec = 0,
      endTimeSec = 0,
      pollInterval = 5000,
      timeout = 600000,
    } = params;

    // 1. Create task
    const createResp = await this._fetch(`/videos/remove_bg`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        format,
        processing_type: processingType,
        background_color: backgroundColor,
        start_time_sec: startTimeSec,
        end_time_sec: endTimeSec,
      }),
    });
    await this._check(createResp, 202);
    const task = await createResp.json();
    const { video_id, upload_data } = task;

    // 2. Upload
    const uploadForm = new FormData();
    for (const [k, v] of Object.entries(upload_data.fields)) {
      uploadForm.append(k, v);
    }
    uploadForm.append("file", await this._toBlob(video));
    const uploadResp = await fetch(upload_data.url, { method: "POST", body: uploadForm });
    if (uploadResp.status !== 200 && uploadResp.status !== 204) {
      throw new CarveError(`Upload failed: ${uploadResp.status}`, uploadResp.status);
    }

    // 3. Confirm
    const confirmResp = await this._fetch(`/videos/${video_id}/source`, { method: "PUT" });
    if (confirmResp.status !== 204) {
      throw new CarveError(`Confirm failed: ${confirmResp.status}`, confirmResp.status);
    }

    // 4. Poll
    return this._pollVideo(video_id, pollInterval, timeout);
  }

  /**
   * Get account balance.
   * @returns {Promise<{total: number, details: {api_calls: number, points: number}}>}
   */
  async getBalance() {
    const resp = await this._fetch(`/account/balance`);
    await this._check(resp, 200);
    return resp.json();
  }

  // ── Internal ──

  async _pollImage(imageId, interval, timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const resp = await this._fetch(`/images/images/${imageId}`);
      if (resp.status === 200) {
        const { image_url } = await resp.json();
        const dataResp = await fetch(image_url);
        const data = Buffer.from(await dataResp.arrayBuffer());
        return new ImageResult(imageId, image_url, data);
      }
      if (resp.status !== 201 && resp.status !== 202) {
        throw new CarveError(`Processing failed: ${resp.status}`, resp.status, await resp.json());
      }
      await this._sleep(interval);
    }
    throw new CarveError("Timeout waiting for image processing");
  }

  async _pollVideo(videoId, interval, timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const resp = await this._fetch(`/videos/${videoId}`);
      const body = await resp.json();
      if (body.status === "completed") {
        const dataResp = await fetch(body.result_url);
        const data = Buffer.from(await dataResp.arrayBuffer());
        return new VideoResult(videoId, body.result_url, body.preview_url, data);
      }
      if (body.status === "failed") {
        throw new CarveError(`Video failed: ${body.error?.reason || "unknown"}`, null, body);
      }
      await this._sleep(interval);
    }
    throw new CarveError("Timeout waiting for video processing");
  }

  async _fetch(path, options = {}) {
    const headers = { "X-API-Key": this.apiKey, ...(options.headers || {}) };
    return fetch(`${this.baseUrl}${path}`, { ...options, headers });
  }

  async _toBlob(input) {
    if (Buffer.isBuffer(input)) return new Blob([input]);
    if (typeof input === "string") {
      const buf = fs.readFileSync(input);
      return new Blob([buf]);
    }
    return input;
  }

  async _check(resp, expected) {
    if (resp.status !== expected) {
      let detail;
      try { detail = await resp.json(); } catch { detail = await resp.text(); }
      throw new CarveError(`API error ${resp.status}`, resp.status, detail);
    }
  }

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

class ImageResult {
  constructor(imageId, url, data) {
    this.imageId = imageId;
    this.url = url;
    this.data = data;
  }

  async save(filePath) {
    fs.writeFileSync(filePath, this.data);
    return filePath;
  }

  get size() {
    return this.data.length;
  }
}

class VideoResult {
  constructor(videoId, url, previewUrl, data) {
    this.videoId = videoId;
    this.url = url;
    this.previewUrl = previewUrl;
    this.data = data;
  }

  async save(filePath) {
    fs.writeFileSync(filePath, this.data);
    return filePath;
  }

  get size() {
    return this.data.length;
  }
}

module.exports = { CarveClient, CarveError, ImageResult, VideoResult };
