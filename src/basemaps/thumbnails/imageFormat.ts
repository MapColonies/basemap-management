/**
 * Minimal, dependency-free image-container sniffing for PNG and WebP.
 *
 * Only reads the magic bytes and the (small, fixed-offset) dimension fields each format stores in its
 * header - it never decodes pixel data. That is enough to validate "is this actually a PNG/WebP, and
 * is it exactly 128x128" without a native image-processing dependency, and without trusting the
 * client-supplied multipart MIME type.
 */

interface ISniffedImage {
  mimeType: 'image/png' | 'image/webp';
  width: number;
  height: number;
}

// eslint-disable-next-line @typescript-eslint/no-magic-numbers -- the PNG file signature is a fixed, well-known byte sequence (not an arbitrary magic number)
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IHDR_WIDTH_OFFSET = 16;
const PNG_IHDR_HEIGHT_OFFSET = 20;
const PNG_MIN_LENGTH = 24;

const RIFF_FOURCC_OFFSET = 0;
const WEBP_FOURCC_OFFSET = 8;
const WEBP_CHUNK_FOURCC_OFFSET = 12;
const WEBP_CHUNK_DATA_OFFSET = 20;
const WEBP_MIN_LENGTH = 21;

const ONE = 1;
const TWO_BYTES = 2;
const BITS_PER_BYTE = 8;
const BYTE_MASK_14_BIT = 0x3fff;
const VP8L_HEIGHT_SHIFT = 14;

function sniffPng(buffer: Buffer): ISniffedImage | undefined {
  if (buffer.length < PNG_MIN_LENGTH || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return undefined;
  }
  const width = buffer.readUInt32BE(PNG_IHDR_WIDTH_OFFSET);
  const height = buffer.readUInt32BE(PNG_IHDR_HEIGHT_OFFSET);
  return { mimeType: 'image/png', width, height };
}

/** Little-endian 24-bit unsigned integer, as used by WebP's VP8X chunk. */
function readUInt24LE(buffer: Buffer, offset: number): number {
  return (
    buffer.readUInt8(offset) |
    (buffer.readUInt8(offset + ONE) << BITS_PER_BYTE) |
    (buffer.readUInt8(offset + TWO_BYTES) << (BITS_PER_BYTE * TWO_BYTES))
  );
}

/** VP8X: extended format carrying an explicit canvas size, used by animated/alpha/extended WebP files. */
function sniffWebpVp8x(chunkData: Buffer): ISniffedImage | undefined {
  const widthOffset = 4;
  const heightOffset = 7;
  const minChunkLength = 10;
  if (chunkData.length < minChunkLength) {
    return undefined;
  }
  return {
    mimeType: 'image/webp',
    width: readUInt24LE(chunkData, widthOffset) + ONE,
    height: readUInt24LE(chunkData, heightOffset) + ONE,
  };
}

/** VP8 (lossy): a 3-byte frame tag followed by the start code and 2-byte little-endian width/height, each in the low 14 bits. */
function sniffWebpVp8(chunkData: Buffer): ISniffedImage | undefined {
  const widthOffset = 6;
  const heightOffset = 8;
  const minChunkLength = 10;
  if (chunkData.length < minChunkLength) {
    return undefined;
  }
  return {
    mimeType: 'image/webp',
    width: chunkData.readUInt16LE(widthOffset) & BYTE_MASK_14_BIT,
    height: chunkData.readUInt16LE(heightOffset) & BYTE_MASK_14_BIT,
  };
}

/** VP8L (lossless): a 1-byte signature followed by a 4-byte little-endian field packing 14-bit width-1/height-1. */
function sniffWebpVp8l(chunkData: Buffer): ISniffedImage | undefined {
  const packedOffset = 1;
  const minChunkLength = 5;
  if (chunkData.length < minChunkLength) {
    return undefined;
  }
  const packed = chunkData.readUInt32LE(packedOffset);
  return {
    mimeType: 'image/webp',
    width: (packed & BYTE_MASK_14_BIT) + ONE,
    height: ((packed >> VP8L_HEIGHT_SHIFT) & BYTE_MASK_14_BIT) + ONE,
  };
}

function sniffWebp(buffer: Buffer): ISniffedImage | undefined {
  if (buffer.length < WEBP_MIN_LENGTH) {
    return undefined;
  }
  if (buffer.toString('ascii', RIFF_FOURCC_OFFSET, RIFF_FOURCC_OFFSET + 'RIFF'.length) !== 'RIFF') {
    return undefined;
  }
  if (buffer.toString('ascii', WEBP_FOURCC_OFFSET, WEBP_FOURCC_OFFSET + 'WEBP'.length) !== 'WEBP') {
    return undefined;
  }

  const chunkFourCc = buffer.toString('ascii', WEBP_CHUNK_FOURCC_OFFSET, WEBP_CHUNK_FOURCC_OFFSET + 'VP8X'.length);
  const chunkData = buffer.subarray(WEBP_CHUNK_DATA_OFFSET);

  switch (chunkFourCc) {
    case 'VP8X':
      return sniffWebpVp8x(chunkData);
    case 'VP8L':
      return sniffWebpVp8l(chunkData);
    case 'VP8 ':
      return sniffWebpVp8(chunkData);
    default:
      return undefined;
  }
}

/** Returns the sniffed format/dimensions, or `undefined` if `buffer` is neither a valid PNG nor a valid WebP container. */
function sniffImage(buffer: Buffer): ISniffedImage | undefined {
  return sniffPng(buffer) ?? sniffWebp(buffer);
}

export { sniffImage };
export type { ISniffedImage };
