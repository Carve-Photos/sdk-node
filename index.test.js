const { describe, it, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { CarveClient, CarveError, ImageResult, VideoResult } = require("./index");

// ── helpers ──

function mockFetch(handler) {
  return mock.fn(async (url, opts) => handler(url, opts));
}

function jsonResponse(status, body) {
  return {
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

function binaryResponse(data) {
  const buf = Buffer.from(data);
  return {
    status: 200,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
}

// ── CarveError ──

describe("CarveError", () => {
  it("sets message, statusCode, detail", () => {
    const err = new CarveError("boom", 400, { key: "val" });
    assert.equal(err.message, "boom");
    assert.equal(err.statusCode, 400);
    assert.deepEqual(err.detail, { key: "val" });
    assert.equal(err.name, "CarveError");
  });

  it("defaults statusCode and detail to undefined", () => {
    const err = new CarveError("msg");
    assert.equal(err.statusCode, undefined);
    assert.equal(err.detail, undefined);
  });

  it("is instance of Error", () => {
    assert.ok(new CarveError("e") instanceof Error);
  });
});

// ── CarveClient constructor ──

describe("CarveClient constructor", () => {
  it("uses default base URL", () => {
    const c = new CarveClient("key");
    assert.equal(c.apiKey, "key");
    assert.equal(c.baseUrl, "https://api.carve.photos/api/v1");
  });

  it("accepts custom base URL", () => {
    const c = new CarveClient("key", { baseUrl: "https://custom.api/v2" });
    assert.equal(c.baseUrl, "https://custom.api/v2");
  });

  it("strips trailing slash", () => {
    const c = new CarveClient("key", { baseUrl: "https://custom.api/v2/" });
    assert.equal(c.baseUrl, "https://custom.api/v2");
  });

  it("defaults options to empty object", () => {
    const c = new CarveClient("key");
    assert.equal(c.baseUrl, "https://api.carve.photos/api/v1");
  });
});

// ── _check ──

describe("CarveClient._check", () => {
  it("does not throw on matching status", async () => {
    const c = new CarveClient("key");
    const resp = jsonResponse(200, { ok: true });
    await c._check(resp, 200); // should not throw
  });

  it("throws CarveError with json detail on mismatch", async () => {
    const c = new CarveClient("key");
    const resp = jsonResponse(400, { error: "bad" });
    await assert.rejects(() => c._check(resp, 200), (err) => {
      assert.ok(err instanceof CarveError);
      assert.equal(err.statusCode, 400);
      assert.deepEqual(err.detail, { error: "bad" });
      return true;
    });
  });

  it("throws CarveError with text detail when json fails", async () => {
    const c = new CarveClient("key");
    const resp = {
      status: 500,
      json: async () => { throw new Error("not json"); },
      text: async () => "Internal Server Error",
    };
    await assert.rejects(() => c._check(resp, 200), (err) => {
      assert.ok(err instanceof CarveError);
      assert.equal(err.statusCode, 500);
      assert.equal(err.detail, "Internal Server Error");
      return true;
    });
  });
});

// ── _toBlob ──

describe("CarveClient._toBlob", () => {
  it("converts Buffer to Blob", async () => {
    const c = new CarveClient("key");
    const result = await c._toBlob(Buffer.from("hello"));
    assert.ok(result instanceof Blob);
    const text = await result.text();
    assert.equal(text, "hello");
  });

  it("reads file from string path", async () => {
    const c = new CarveClient("key");
    const original = fs.readFileSync;
    mock.method(fs, "readFileSync", () => Buffer.from("filedata"));
    try {
      const result = await c._toBlob("/some/file.jpg");
      assert.ok(result instanceof Blob);
      const text = await result.text();
      assert.equal(text, "filedata");
    } finally {
      fs.readFileSync = original;
    }
  });

  it("returns non-buffer non-string as-is", async () => {
    const c = new CarveClient("key");
    const blob = new Blob(["test"]);
    const result = await c._toBlob(blob);
    assert.equal(result, blob);
  });
});

// ── _sleep ──

describe("CarveClient._sleep", () => {
  it("resolves after timeout", async () => {
    const c = new CarveClient("key");
    const start = Date.now();
    await c._sleep(10);
    assert.ok(Date.now() - start >= 5); // at least ~10ms (allowing some slack)
  });
});

// ── _fetch ──

describe("CarveClient._fetch", () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("adds X-API-Key header", async () => {
    let capturedHeaders;
    globalThis.fetch = async (url, opts) => {
      capturedHeaders = opts.headers;
      return jsonResponse(200, {});
    };
    const c = new CarveClient("secret-key");
    await c._fetch("/test");
    assert.equal(capturedHeaders["X-API-Key"], "secret-key");
  });

  it("merges custom headers", async () => {
    let capturedHeaders;
    globalThis.fetch = async (url, opts) => {
      capturedHeaders = opts.headers;
      return jsonResponse(200, {});
    };
    const c = new CarveClient("key");
    await c._fetch("/test", { headers: { "Content-Type": "application/json" } });
    assert.equal(capturedHeaders["X-API-Key"], "key");
    assert.equal(capturedHeaders["Content-Type"], "application/json");
  });

  it("prepends baseUrl", async () => {
    let capturedUrl;
    globalThis.fetch = async (url, opts) => {
      capturedUrl = url;
      return jsonResponse(200, {});
    };
    const c = new CarveClient("key", { baseUrl: "https://api.test.com/v1" });
    await c._fetch("/images/remove_bg");
    assert.equal(capturedUrl, "https://api.test.com/v1/images/remove_bg");
  });
});

// ── getBalance ──

describe("CarveClient.getBalance", () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("returns balance data on success", async () => {
    globalThis.fetch = async () => jsonResponse(200, { total: 100, details: { api_calls: 50, points: 50 } });
    const c = new CarveClient("key");
    const result = await c.getBalance();
    assert.deepEqual(result, { total: 100, details: { api_calls: 50, points: 50 } });
  });

  it("throws on error status", async () => {
    globalThis.fetch = async () => jsonResponse(401, { error: "unauthorized" });
    const c = new CarveClient("key");
    await assert.rejects(() => c.getBalance(), (err) => {
      assert.ok(err instanceof CarveError);
      assert.equal(err.statusCode, 401);
      return true;
    });
  });
});

// ── _pollImage ──

describe("CarveClient._pollImage", () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("returns ImageResult on immediate 200", async () => {
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(url);
      if (url.includes("/images/images/")) {
        return jsonResponse(200, { image_url: "https://cdn.test.com/r.png" });
      }
      // download
      return binaryResponse("IMG_DATA");
    };
    const c = new CarveClient("key");
    c._sleep = async () => {};
    const result = await c._pollImage("img-1", 100, 5000);
    assert.ok(result instanceof ImageResult);
    assert.equal(result.imageId, "img-1");
    assert.equal(result.url, "https://cdn.test.com/r.png");
  });

  it("polls on 201/202 then succeeds", async () => {
    let callCount = 0;
    globalThis.fetch = async (url) => {
      if (url.includes("/images/images/")) {
        callCount++;
        if (callCount < 3) return jsonResponse(202, { status: "processing" });
        return jsonResponse(200, { image_url: "https://cdn.test.com/done.png" });
      }
      return binaryResponse("DONE");
    };
    const c = new CarveClient("key");
    c._sleep = async () => {};
    const result = await c._pollImage("img-2", 100, 60000);
    assert.equal(callCount, 3);
    assert.ok(result instanceof ImageResult);
  });

  it("throws on error status (not 200/201/202)", async () => {
    globalThis.fetch = async () => jsonResponse(500, { error: "internal" });
    const c = new CarveClient("key");
    c._sleep = async () => {};
    await assert.rejects(() => c._pollImage("img-3", 100, 5000), (err) => {
      assert.ok(err instanceof CarveError);
      assert.equal(err.statusCode, 500);
      return true;
    });
  });

  it("throws on timeout", async () => {
    globalThis.fetch = async () => jsonResponse(202, { status: "processing" });
    const c = new CarveClient("key");
    c._sleep = async () => {};
    // Use very short timeout — Date.now() will advance naturally
    await assert.rejects(() => c._pollImage("img-4", 0, 0), (err) => {
      assert.ok(err instanceof CarveError);
      assert.match(err.message, /Timeout/);
      return true;
    });
  });

  it("handles 201 status as pending", async () => {
    let callCount = 0;
    globalThis.fetch = async (url) => {
      if (url.includes("/images/images/")) {
        callCount++;
        if (callCount === 1) return jsonResponse(201, {});
        return jsonResponse(200, { image_url: "https://cdn.test.com/x.png" });
      }
      return binaryResponse("X");
    };
    const c = new CarveClient("key");
    c._sleep = async () => {};
    const result = await c._pollImage("img-5", 100, 60000);
    assert.equal(callCount, 2);
  });
});

// ── _pollVideo ──

describe("CarveClient._pollVideo", () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("returns VideoResult on immediate completed", async () => {
    globalThis.fetch = async (url) => {
      if (url.includes("/videos/")) {
        return jsonResponse(200, {
          status: "completed",
          result_url: "https://cdn.test.com/v.mp4",
          preview_url: "https://cdn.test.com/p.jpg",
        });
      }
      return binaryResponse("VIDEO");
    };
    const c = new CarveClient("key");
    c._sleep = async () => {};
    const result = await c._pollVideo("vid-1", 100, 5000);
    assert.ok(result instanceof VideoResult);
    assert.equal(result.videoId, "vid-1");
    assert.equal(result.url, "https://cdn.test.com/v.mp4");
    assert.equal(result.previewUrl, "https://cdn.test.com/p.jpg");
  });

  it("polls processing then completed", async () => {
    let callCount = 0;
    globalThis.fetch = async (url) => {
      if (url.includes("/videos/vid")) {
        callCount++;
        if (callCount < 2) return jsonResponse(200, { status: "processing" });
        return jsonResponse(200, {
          status: "completed",
          result_url: "https://cdn.test.com/done.mp4",
          preview_url: null,
        });
      }
      return binaryResponse("DONE_VID");
    };
    const c = new CarveClient("key");
    c._sleep = async () => {};
    const result = await c._pollVideo("vid-2", 100, 60000);
    assert.equal(callCount, 2);
    assert.equal(result.previewUrl, null);
  });

  it("throws on failed with reason", async () => {
    globalThis.fetch = async () => jsonResponse(200, {
      status: "failed",
      error: { reason: "unsupported_format" },
    });
    const c = new CarveClient("key");
    c._sleep = async () => {};
    await assert.rejects(() => c._pollVideo("vid-3", 100, 5000), (err) => {
      assert.ok(err instanceof CarveError);
      assert.match(err.message, /unsupported_format/);
      return true;
    });
  });

  it("throws on failed without reason", async () => {
    globalThis.fetch = async () => jsonResponse(200, {
      status: "failed",
      error: {},
    });
    const c = new CarveClient("key");
    c._sleep = async () => {};
    await assert.rejects(() => c._pollVideo("vid-4", 100, 5000), (err) => {
      assert.match(err.message, /unknown/);
      return true;
    });
  });

  it("throws on failed with no error key", async () => {
    globalThis.fetch = async () => jsonResponse(200, { status: "failed" });
    const c = new CarveClient("key");
    c._sleep = async () => {};
    await assert.rejects(() => c._pollVideo("vid-5", 100, 5000), (err) => {
      assert.match(err.message, /unknown/);
      return true;
    });
  });

  it("throws on timeout", async () => {
    globalThis.fetch = async () => jsonResponse(200, { status: "processing" });
    const c = new CarveClient("key");
    c._sleep = async () => {};
    await assert.rejects(() => c._pollVideo("vid-6", 0, 0), (err) => {
      assert.match(err.message, /Timeout/);
      return true;
    });
  });
});

// ── removeBackground ──

describe("CarveClient.removeBackground", () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("sends minimal params and returns ImageResult", async () => {
    const capturedCalls = [];
    globalThis.fetch = async (url, opts) => {
      capturedCalls.push({ url, method: opts?.method });
      if (url.includes("/images/remove_bg")) {
        return jsonResponse(202, { image_id: "img-rb1" });
      }
      if (url.includes("/images/images/img-rb1")) {
        return jsonResponse(200, { image_url: "https://cdn.test.com/rb1.png" });
      }
      return binaryResponse("RESULT_IMG");
    };
    const c = new CarveClient("key");
    c._sleep = async () => {};
    const result = await c.removeBackground(Buffer.from("img"));
    assert.ok(result instanceof ImageResult);
    assert.equal(result.imageId, "img-rb1");
  });

  it("passes all optional params in FormData", async () => {
    let capturedBody;
    globalThis.fetch = async (url, opts) => {
      if (url.includes("/images/remove_bg")) {
        capturedBody = opts.body;
        return jsonResponse(202, { image_id: "img-ap" });
      }
      if (url.includes("/images/images/")) {
        return jsonResponse(200, { image_url: "https://cdn.test.com/ap.png" });
      }
      return binaryResponse("X");
    };
    const c = new CarveClient("key");
    c._sleep = async () => {};
    await c.removeBackground(Buffer.from("img"), {
      format: "webp",
      size: "hd",
      bgColor: "#FF0000",
      crop: true,
      cropMargin: "10%",
      cropThreshold: 0.5,
      roi: "10% 10% 90% 90%",
      scale: "75%",
      position: "center",
    });
    assert.ok(capturedBody instanceof FormData);
    assert.equal(capturedBody.get("format"), "webp");
    assert.equal(capturedBody.get("size"), "hd");
    assert.equal(capturedBody.get("bg_color"), "#FF0000");
    assert.equal(capturedBody.get("crop"), "true");
    assert.equal(capturedBody.get("crop_margin"), "10%");
    assert.equal(capturedBody.get("crop_threshold"), "0.5");
    assert.equal(capturedBody.get("roi"), "10% 10% 90% 90%");
    assert.equal(capturedBody.get("scale"), "75%");
    assert.equal(capturedBody.get("position"), "center");
  });

  it("does not include optional fields when not set", async () => {
    let capturedBody;
    globalThis.fetch = async (url, opts) => {
      if (url.includes("/images/remove_bg")) {
        capturedBody = opts.body;
        return jsonResponse(202, { image_id: "img-min" });
      }
      if (url.includes("/images/images/")) {
        return jsonResponse(200, { image_url: "https://cdn.test.com/min.png" });
      }
      return binaryResponse("M");
    };
    const c = new CarveClient("key");
    c._sleep = async () => {};
    await c.removeBackground(Buffer.from("img"));
    assert.equal(capturedBody.get("bg_color"), null);
    assert.equal(capturedBody.get("crop"), null);
    assert.equal(capturedBody.get("crop_margin"), null);
    assert.equal(capturedBody.get("crop_threshold"), null);
    assert.equal(capturedBody.get("roi"), null);
    assert.equal(capturedBody.get("scale"), null);
    assert.equal(capturedBody.get("position"), null);
  });

  it("handles cropThreshold=0", async () => {
    let capturedBody;
    globalThis.fetch = async (url, opts) => {
      if (url.includes("/images/remove_bg")) {
        capturedBody = opts.body;
        return jsonResponse(202, { image_id: "img-ct0" });
      }
      if (url.includes("/images/images/")) {
        return jsonResponse(200, { image_url: "https://cdn.test.com/ct0.png" });
      }
      return binaryResponse("C");
    };
    const c = new CarveClient("key");
    c._sleep = async () => {};
    await c.removeBackground(Buffer.from("img"), { cropThreshold: 0 });
    assert.equal(capturedBody.get("crop_threshold"), "0");
  });

  it("throws on API error", async () => {
    globalThis.fetch = async () => jsonResponse(400, { error: "bad image" });
    const c = new CarveClient("key");
    await assert.rejects(() => c.removeBackground(Buffer.from("bad")), (err) => {
      assert.ok(err instanceof CarveError);
      assert.equal(err.statusCode, 400);
      return true;
    });
  });

  it("reads file from path", async () => {
    const original = fs.readFileSync;
    mock.method(fs, "readFileSync", () => Buffer.from("fileimg"));
    try {
      globalThis.fetch = async (url, opts) => {
        if (url.includes("/images/remove_bg")) return jsonResponse(202, { image_id: "img-fp" });
        if (url.includes("/images/images/")) return jsonResponse(200, { image_url: "https://cdn.test.com/fp.png" });
        return binaryResponse("FP");
      };
      const c = new CarveClient("key");
      c._sleep = async () => {};
      const result = await c.removeBackground("/path/to/image.jpg");
      assert.ok(result instanceof ImageResult);
    } finally {
      fs.readFileSync = original;
    }
  });
});

// ── removeBackgroundVideo ──

describe("CarveClient.removeBackgroundVideo", () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("full flow with defaults", async () => {
    const capturedCalls = [];
    globalThis.fetch = async (url, opts) => {
      capturedCalls.push({ url, method: opts?.method });
      // Create task
      if (url.includes("/videos/remove_bg")) {
        return jsonResponse(202, {
          video_id: "vid-rb1",
          upload_data: {
            url: "https://s3.test.com/upload",
            fields: { key: "val", policy: "abc" },
          },
        });
      }
      // Upload
      if (url.includes("s3.test.com/upload")) {
        return jsonResponse(204, {});
      }
      // Confirm
      if (url.includes("/videos/vid-rb1/source")) {
        return { status: 204 };
      }
      // Poll
      if (url.includes("/videos/vid-rb1") && !url.includes("source")) {
        return jsonResponse(200, {
          status: "completed",
          result_url: "https://cdn.test.com/result.mp4",
          preview_url: "https://cdn.test.com/preview.jpg",
        });
      }
      // Download
      return binaryResponse("VIDEO_CONTENT");
    };
    const c = new CarveClient("key");
    c._sleep = async () => {};
    const result = await c.removeBackgroundVideo(Buffer.from("video"));
    assert.ok(result instanceof VideoResult);
    assert.equal(result.videoId, "vid-rb1");

    // Verify create call had correct JSON body
    const createCall = capturedCalls.find(c => c.url.includes("/videos/remove_bg"));
    assert.ok(createCall);
    assert.equal(createCall.method, "POST");
  });

  it("passes custom params in create request", async () => {
    let capturedBody;
    globalThis.fetch = async (url, opts) => {
      if (url.includes("/videos/remove_bg")) {
        capturedBody = JSON.parse(opts.body);
        return jsonResponse(202, {
          video_id: "vid-cp",
          upload_data: { url: "https://s3.test.com/u", fields: {} },
        });
      }
      if (url.includes("s3.test.com")) return { status: 200 };
      if (url.includes("/source")) return { status: 204 };
      if (url.includes("/videos/vid-cp")) {
        return jsonResponse(200, {
          status: "completed",
          result_url: "https://cdn.test.com/cp.mp4",
          preview_url: null,
        });
      }
      return binaryResponse("V");
    };
    const c = new CarveClient("key");
    c._sleep = async () => {};
    await c.removeBackgroundVideo(Buffer.from("v"), {
      format: "pro_bundle",
      processingType: "object",
      backgroundColor: "#000000",
      startTimeSec: 1.5,
      endTimeSec: 10.0,
    });
    assert.equal(capturedBody.format, "pro_bundle");
    assert.equal(capturedBody.processing_type, "object");
    assert.equal(capturedBody.background_color, "#000000");
    assert.equal(capturedBody.start_time_sec, 1.5);
    assert.equal(capturedBody.end_time_sec, 10.0);
  });

  it("throws on create API error", async () => {
    globalThis.fetch = async () => jsonResponse(400, { error: "bad" });
    const c = new CarveClient("key");
    await assert.rejects(() => c.removeBackgroundVideo(Buffer.from("v")), (err) => {
      assert.ok(err instanceof CarveError);
      assert.equal(err.statusCode, 400);
      return true;
    });
  });

  it("throws on upload failure", async () => {
    globalThis.fetch = async (url) => {
      if (url.includes("/videos/remove_bg")) {
        return jsonResponse(202, {
          video_id: "vid-uf",
          upload_data: { url: "https://s3.test.com/u", fields: { k: "v" } },
        });
      }
      if (url.includes("s3.test.com")) return { status: 403 };
      return jsonResponse(200, {});
    };
    const c = new CarveClient("key");
    await assert.rejects(() => c.removeBackgroundVideo(Buffer.from("v")), (err) => {
      assert.ok(err instanceof CarveError);
      assert.match(err.message, /Upload failed/);
      return true;
    });
  });

  it("throws on confirm failure", async () => {
    globalThis.fetch = async (url) => {
      if (url.includes("/videos/remove_bg")) {
        return jsonResponse(202, {
          video_id: "vid-cf",
          upload_data: { url: "https://s3.test.com/u", fields: {} },
        });
      }
      if (url.includes("s3.test.com")) return { status: 200 };
      if (url.includes("/source")) return { status: 500 };
      return jsonResponse(200, {});
    };
    const c = new CarveClient("key");
    await assert.rejects(() => c.removeBackgroundVideo(Buffer.from("v")), (err) => {
      assert.ok(err instanceof CarveError);
      assert.match(err.message, /Confirm failed/);
      return true;
    });
  });

  it("accepts upload 200", async () => {
    globalThis.fetch = async (url) => {
      if (url.includes("/videos/remove_bg")) {
        return jsonResponse(202, {
          video_id: "vid-200",
          upload_data: { url: "https://s3.test.com/u", fields: {} },
        });
      }
      if (url.includes("s3.test.com")) return { status: 200 };
      if (url.includes("/source")) return { status: 204 };
      if (url.includes("/videos/vid-200")) {
        return jsonResponse(200, {
          status: "completed",
          result_url: "https://cdn.test.com/200.mp4",
          preview_url: null,
        });
      }
      return binaryResponse("OK");
    };
    const c = new CarveClient("key");
    c._sleep = async () => {};
    const result = await c.removeBackgroundVideo(Buffer.from("v"));
    assert.ok(result instanceof VideoResult);
  });

  it("reads file from path", async () => {
    const original = fs.readFileSync;
    mock.method(fs, "readFileSync", () => Buffer.from("filevid"));
    try {
      globalThis.fetch = async (url) => {
        if (url.includes("/videos/remove_bg")) {
          return jsonResponse(202, {
            video_id: "vid-fp",
            upload_data: { url: "https://s3.test.com/u", fields: {} },
          });
        }
        if (url.includes("s3.test.com")) return { status: 200 };
        if (url.includes("/source")) return { status: 204 };
        if (url.includes("/videos/vid-fp")) {
          return jsonResponse(200, {
            status: "completed",
            result_url: "https://cdn.test.com/fp.mp4",
            preview_url: null,
          });
        }
        return binaryResponse("FPV");
      };
      const c = new CarveClient("key");
      c._sleep = async () => {};
      const result = await c.removeBackgroundVideo("/path/to/video.mp4");
      assert.ok(result instanceof VideoResult);
    } finally {
      fs.readFileSync = original;
    }
  });
});

// ── ImageResult ──

describe("ImageResult", () => {
  it("stores properties", () => {
    const r = new ImageResult("i1", "https://cdn.test.com/i.png", Buffer.from("data"));
    assert.equal(r.imageId, "i1");
    assert.equal(r.url, "https://cdn.test.com/i.png");
    assert.ok(Buffer.isBuffer(r.data));
  });

  it("size getter returns data length", () => {
    const r = new ImageResult("i2", "u", Buffer.from("hello"));
    assert.equal(r.size, 5);
  });

  it("size is 0 for empty data", () => {
    const r = new ImageResult("i3", "u", Buffer.alloc(0));
    assert.equal(r.size, 0);
  });

  it("save writes file", async () => {
    const original = fs.writeFileSync;
    let savedPath, savedData;
    mock.method(fs, "writeFileSync", (p, d) => { savedPath = p; savedData = d; });
    try {
      const r = new ImageResult("i4", "u", Buffer.from("PNG"));
      const result = await r.save("/tmp/out.png");
      assert.equal(result, "/tmp/out.png");
      assert.equal(savedPath, "/tmp/out.png");
      assert.deepEqual(savedData, Buffer.from("PNG"));
    } finally {
      fs.writeFileSync = original;
    }
  });
});

// ── VideoResult ──

describe("VideoResult", () => {
  it("stores properties", () => {
    const r = new VideoResult("v1", "https://cdn.test.com/v.mp4", "https://cdn.test.com/p.jpg", Buffer.from("vid"));
    assert.equal(r.videoId, "v1");
    assert.equal(r.url, "https://cdn.test.com/v.mp4");
    assert.equal(r.previewUrl, "https://cdn.test.com/p.jpg");
  });

  it("previewUrl can be null", () => {
    const r = new VideoResult("v2", "u", null, Buffer.from("v"));
    assert.equal(r.previewUrl, null);
  });

  it("size getter returns data length", () => {
    const r = new VideoResult("v3", "u", null, Buffer.from("abcdef"));
    assert.equal(r.size, 6);
  });

  it("size is 0 for empty data", () => {
    const r = new VideoResult("v4", "u", null, Buffer.alloc(0));
    assert.equal(r.size, 0);
  });

  it("save writes file", async () => {
    const original = fs.writeFileSync;
    let savedPath, savedData;
    mock.method(fs, "writeFileSync", (p, d) => { savedPath = p; savedData = d; });
    try {
      const r = new VideoResult("v5", "u", null, Buffer.from("MP4"));
      const result = await r.save("/tmp/out.mp4");
      assert.equal(result, "/tmp/out.mp4");
      assert.equal(savedPath, "/tmp/out.mp4");
      assert.deepEqual(savedData, Buffer.from("MP4"));
    } finally {
      fs.writeFileSync = original;
    }
  });
});

// ── module exports ──

describe("module exports", () => {
  it("exports CarveClient", () => {
    const m = require("./index");
    assert.ok(m.CarveClient);
    assert.equal(typeof m.CarveClient, "function");
  });

  it("exports CarveError", () => {
    const m = require("./index");
    assert.ok(m.CarveError);
  });

  it("exports ImageResult", () => {
    const m = require("./index");
    assert.ok(m.ImageResult);
  });

  it("exports VideoResult", () => {
    const m = require("./index");
    assert.ok(m.VideoResult);
  });
});
