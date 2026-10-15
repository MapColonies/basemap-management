import { describe, it, expect } from 'vitest';
import { sniffImage } from '@src/basemaps/thumbnails/imageFormat';

const DIMENSION = 128;

/** Builds a buffer with just enough of a real PNG header for our sniffer (signature + IHDR's width/height) - pixel data/CRC are irrelevant to it. */
function buildPngHeader(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunkLength = Buffer.alloc(4);
  chunkLength.writeUInt32BE(13); // IHDR's fixed data length
  const chunkType = Buffer.from('IHDR', 'ascii');
  const widthBuf = Buffer.alloc(4);
  widthBuf.writeUInt32BE(width);
  const heightBuf = Buffer.alloc(4);
  heightBuf.writeUInt32BE(height);
  const rest = Buffer.alloc(5 + 4); // bit depth/color type/compression/filter/interlace + a (fake) CRC
  return Buffer.concat([signature, chunkLength, chunkType, widthBuf, heightBuf, rest]);
}

/** Builds a minimal, valid-enough WebP/VP8X header for our sniffer. */
function buildWebpVp8xHeader(width: number, height: number): Buffer {
  const riff = Buffer.from('RIFF', 'ascii');
  const fileSize = Buffer.alloc(4);
  const webp = Buffer.from('WEBP', 'ascii');
  const vp8x = Buffer.from('VP8X', 'ascii');
  const chunkSize = Buffer.alloc(4);
  const flags = Buffer.from([0x00]);
  const reserved = Buffer.from([0x00, 0x00, 0x00]);
  const widthMinusOne = Buffer.alloc(3);
  widthMinusOne.writeUIntLE(width - 1, 0, 3);
  const heightMinusOne = Buffer.alloc(3);
  heightMinusOne.writeUIntLE(height - 1, 0, 3);
  return Buffer.concat([riff, fileSize, webp, vp8x, chunkSize, flags, reserved, widthMinusOne, heightMinusOne]);
}

/** Builds a minimal WebP/VP8L (lossless) header: 1-byte signature + packed 14-bit width-1/height-1. */
function buildWebpVp8lHeader(width: number, height: number): Buffer {
  const riff = Buffer.from('RIFF', 'ascii');
  const fileSize = Buffer.alloc(4);
  const webp = Buffer.from('WEBP', 'ascii');
  const vp8l = Buffer.from('VP8L', 'ascii');
  const chunkSize = Buffer.alloc(4);
  const signatureByte = Buffer.from([0x2f]);
  const widthBits = 14;
  const packed = (width - 1) | ((height - 1) << widthBits);
  const packedBuf = Buffer.alloc(4);
  packedBuf.writeUInt32LE(packed >>> 0);
  return Buffer.concat([riff, fileSize, webp, vp8l, chunkSize, signatureByte, packedBuf]);
}

/** Builds a minimal WebP/VP8 (lossy) header: 3-byte frame tag + start code + packed 14-bit width/height. */
function buildWebpVp8Header(width: number, height: number): Buffer {
  const riff = Buffer.from('RIFF', 'ascii');
  const fileSize = Buffer.alloc(4);
  const webp = Buffer.from('WEBP', 'ascii');
  const vp8 = Buffer.from('VP8 ', 'ascii');
  const chunkSize = Buffer.alloc(4);
  const frameTag = Buffer.alloc(3);
  const startCode = Buffer.from([0x9d, 0x01, 0x2a]);
  const widthBuf = Buffer.alloc(2);
  widthBuf.writeUInt16LE(width);
  const heightBuf = Buffer.alloc(2);
  heightBuf.writeUInt16LE(height);
  return Buffer.concat([riff, fileSize, webp, vp8, chunkSize, frameTag, startCode, widthBuf, heightBuf]);
}

describe('sniffImage', () => {
  it('recognizes a valid PNG and reports its declared dimensions', () => {
    const sniffed = sniffImage(buildPngHeader(DIMENSION, DIMENSION));

    expect(sniffed).toEqual({ mimeType: 'image/png', width: DIMENSION, height: DIMENSION });
  });

  it('recognizes a valid WebP (VP8X) and reports its declared dimensions', () => {
    const sniffed = sniffImage(buildWebpVp8xHeader(DIMENSION, DIMENSION));

    expect(sniffed).toEqual({ mimeType: 'image/webp', width: DIMENSION, height: DIMENSION });
  });

  it('reports non-128x128 PNG dimensions rather than rejecting outright - callers enforce the size policy', () => {
    const otherSize = 256;
    const sniffed = sniffImage(buildPngHeader(otherSize, otherSize));

    expect(sniffed).toEqual({ mimeType: 'image/png', width: otherSize, height: otherSize });
  });

  it('returns undefined for a buffer that is neither PNG nor WebP', () => {
    expect(sniffImage(Buffer.from('not an image, just some bytes that happen to be long enough'))).toBeUndefined();
  });

  it('returns undefined for a truncated/too-short buffer', () => {
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeUndefined();
  });

  it('returns undefined for an unsupported WebP chunk (e.g. an animated-only ANIM container without VP8X/VP8/VP8L)', () => {
    const riff = Buffer.from('RIFF', 'ascii');
    const fileSize = Buffer.alloc(4);
    const webp = Buffer.from('WEBP', 'ascii');
    const unknownChunk = Buffer.from('ANIM', 'ascii');
    const rest = Buffer.alloc(16);

    expect(sniffImage(Buffer.concat([riff, fileSize, webp, unknownChunk, rest]))).toBeUndefined();
  });

  it('returns undefined for a RIFF container that is not a WEBP (e.g. a WAV file)', () => {
    const riff = Buffer.from('RIFF', 'ascii');
    const fileSize = Buffer.alloc(4);
    const wave = Buffer.from('WAVE', 'ascii');
    const rest = Buffer.alloc(16);

    expect(sniffImage(Buffer.concat([riff, fileSize, wave, rest]))).toBeUndefined();
  });

  it('returns undefined for a VP8X chunk that is too short to contain its canvas-size fields', () => {
    const riff = Buffer.from('RIFF', 'ascii');
    const fileSize = Buffer.alloc(4);
    const webp = Buffer.from('WEBP', 'ascii');
    const vp8x = Buffer.from('VP8X', 'ascii');
    const truncatedChunk = Buffer.alloc(2);

    expect(sniffImage(Buffer.concat([riff, fileSize, webp, vp8x, truncatedChunk]))).toBeUndefined();
  });

  it('recognizes a valid WebP (VP8L lossless) and reports its declared dimensions', () => {
    const sniffed = sniffImage(buildWebpVp8lHeader(DIMENSION, DIMENSION));

    expect(sniffed).toEqual({ mimeType: 'image/webp', width: DIMENSION, height: DIMENSION });
  });

  it('recognizes a valid WebP (VP8 lossy) and reports its declared dimensions', () => {
    const sniffed = sniffImage(buildWebpVp8Header(DIMENSION, DIMENSION));

    expect(sniffed).toEqual({ mimeType: 'image/webp', width: DIMENSION, height: DIMENSION });
  });
});
