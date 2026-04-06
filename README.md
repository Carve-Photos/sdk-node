# @carve.photos/sdk

Remove backgrounds from images and videos with the [Carve.Photos](https://carve.photos) API. Node.js SDK with TypeScript support, zero dependencies, and automatic polling — pass a file, get the result.

[![npm](https://img.shields.io/npm/v/@carve.photos%2Fsdk)](https://www.npmjs.com/package/@carve.photos/sdk)
[![Node](https://img.shields.io/node/v/@carve.photos%2Fsdk)](https://www.npmjs.com/package/@carve.photos/sdk)
[![License](https://img.shields.io/npm/l/@carve.photos%2Fsdk)](https://github.com/Carve-Photos/sdk-node/blob/main/LICENSE)
[![CI](https://github.com/Carve-Photos/sdk-node/actions/workflows/ci.yml/badge.svg)](https://github.com/Carve-Photos/sdk-node/actions/workflows/ci.yml)

## Installation

```bash
npm install @carve.photos/sdk
```

## Quick Start

### Remove background from image

```javascript
const { CarveClient } = require("@carve.photos/sdk");

const client = new CarveClient("YOUR_API_KEY");

// Simple usage
const result = await client.removeBackground("photo.jpg");
await result.save("result.png");

// With parameters
const result = await client.removeBackground("photo.jpg", {
  format: "webp",
  size: "hd",
  bgColor: "#FFFFFF",
  crop: true,
  cropMargin: "5%",
});
await result.save("result.webp");
```

### Remove background from video

```javascript
const { CarveClient } = require("@carve.photos/sdk");

const client = new CarveClient("YOUR_API_KEY");

// Simple usage
const result = await client.removeBackgroundVideo("video.mp4");
await result.save("result.mp4");

// With parameters
const result = await client.removeBackgroundVideo("video.mp4", {
  format: "mp4",
  processingType: "human",
  backgroundColor: "#00B140",
  startTimeSec: 2.0,
  endTimeSec: 8.5,
});
await result.save("result.mp4");
```

### Check balance

```javascript
const balance = await client.getBalance();
console.log(`Balance: ${balance.total} credits`);
```

## API Key

Get your API key at [carve.photos/profile](https://carve.photos/profile?tab=api-key).  
Free credits are included with registration.

## Features

- **Images**: PNG, JPEG, WebP, AVIF — up to 25 megapixels
- **Video**: MP4, MOV, WEBM — up to 4K, 30 seconds
- **TypeScript**: Full type definitions included
- **Zero dependencies**: Uses native `fetch` (Node 18+)
- **Automatic polling**: SDK handles status polling internally

## Error Handling

```javascript
const { CarveClient, CarveError } = require("@carve.photos/sdk");

const client = new CarveClient("YOUR_API_KEY");

try {
  const result = await client.removeBackground("photo.jpg");
  await result.save("result.png");
} catch (error) {
  if (error instanceof CarveError) {
    console.error(`Error: ${error.message}`);
    console.error(`Status: ${error.statusCode}`);
    console.error(`Detail: ${JSON.stringify(error.detail)}`);
  }
}
```

## Documentation

- [API Documentation](https://carve.photos/help/api-docs)
- [Swagger](https://api.carve.photos/api/docs)
- [Pricing](https://carve.photos/pricing)

## License

MIT
