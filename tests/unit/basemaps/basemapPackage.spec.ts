import jsZip from 'jszip';
import { describe, it, expect } from 'vitest';
import { ProductType } from '@map-colonies/types';
import { writeBasemapPackage } from '@src/basemaps/packaging/basemapPackageWriter';
import { readBasemapPackage } from '@src/basemaps/packaging/basemapPackageReader';
import type { IPortableBasemap } from '@src/basemaps/models/types';

const DIMENSION = 128;

function buildPngBuffer(): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunkLength = Buffer.alloc(4);
  chunkLength.writeUInt32BE(13);
  const chunkType = Buffer.from('IHDR', 'ascii');
  const width = Buffer.alloc(4);
  width.writeUInt32BE(DIMENSION);
  const height = Buffer.alloc(4);
  height.writeUInt32BE(DIMENSION);
  const rest = Buffer.alloc(9);
  return Buffer.concat([signature, chunkLength, chunkType, width, height, rest]);
}

function buildPortable(overrides: Partial<IPortableBasemap> = {}): IPortableBasemap {
  return {
    name: 'Satellite Europe',
    isCurrent: true,
    isForPreview: false,
    thumbnail: { file: 'thumbnail.png', width: DIMENSION, height: DIMENSION },
    layers: [
      {
        id: 'layer-1',
        order: 0,
        opacity: 1,
        shouldBeUsedInModelDraping: true,
        source: { type: 'RASTER_RESOURCE', productId: '12345', productType: ProductType.ORTHOPHOTO },
      },
      {
        id: 'layer-2',
        order: 1,
        opacity: 0.7,
        source: { type: 'EXTERNAL', details: { protocol: 'XYZ', name: 'Google Satellite', url: 'https://example.com/{z}/{x}/{y}' } },
      },
    ],
    ...overrides,
  };
}

describe('basemap package write/read round-trip', () => {
  it('writes a package and reads back the same portable basemap and thumbnail', async () => {
    const portable = buildPortable();
    const pngBuffer = buildPngBuffer();

    const zipBuffer = await writeBasemapPackage(portable, pngBuffer);
    const parsed = await readBasemapPackage(zipBuffer);

    expect(parsed.portable).toEqual(portable);
    expect(parsed.thumbnail.buffer).toEqual(pngBuffer);
    expect(parsed.thumbnail.mimeType).toBe('image/png');
    expect(parsed.thumbnail.width).toBe(DIMENSION);
    expect(parsed.thumbnail.height).toBe(DIMENSION);
  });

  it('rejects an archive that is not a valid ZIP', async () => {
    await expect(readBasemapPackage(Buffer.from('not a zip'))).rejects.toThrow(/not a valid ZIP/);
  });

  it('rejects an archive missing basemap.json', async () => {
    const zip = new jsZip();
    zip.file('thumbnail.png', buildPngBuffer());
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(readBasemapPackage(buffer)).rejects.toThrow(/missing basemap\.json/);
  });

  it('rejects a nested-directory entry name (not a bare file name)', async () => {
    // A `..`-prefixed entry does not survive a real ZIP round-trip (jszip itself normalizes it away
    // on read, which is reassuring but means it can't be used to exercise our own check) - a nested
    // path does survive, and must still be rejected by `isSafeEntryName`.
    const zip = new jsZip();
    zip.file('basemap.json', JSON.stringify(buildPortable()));
    zip.file('nested/evil.txt', 'nope');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(readBasemapPackage(buffer)).rejects.toThrow(/unsafe entry path/);
  });

  it('rejects a thumbnail whose declared dimensions are not 128x128', async () => {
    const zip = new jsZip();
    const portable = buildPortable();
    zip.file('basemap.json', JSON.stringify(portable));

    const oversizedPng = Buffer.alloc(buildPngBuffer().length);
    buildPngBuffer().copy(oversizedPng);
    const biggerSize = 256;
    oversizedPng.writeUInt32BE(biggerSize, 16);
    oversizedPng.writeUInt32BE(biggerSize, 20);
    zip.file('thumbnail.png', oversizedPng);

    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(readBasemapPackage(buffer)).rejects.toThrow(/128x128/);
  });

  it('rejects malformed JSON in basemap.json', async () => {
    const zip = new jsZip();
    zip.file('basemap.json', '{ not valid json');
    zip.file('thumbnail.png', buildPngBuffer());
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(readBasemapPackage(buffer)).rejects.toThrow(/not valid JSON/);
  });

  it('rejects an archive with too many entries', async () => {
    const zip = new jsZip();
    zip.file('basemap.json', JSON.stringify(buildPortable()));
    zip.file('thumbnail.png', buildPngBuffer());
    const tooManyExtraFiles = 15;
    for (let index = 0; index < tooManyExtraFiles; index++) {
      zip.file(`extra-${index}.txt`, 'padding');
    }
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(readBasemapPackage(buffer)).rejects.toThrow(/too many entries/);
  });

  it('rejects an archive missing the thumbnail file referenced by basemap.json', async () => {
    const zip = new jsZip();
    zip.file('basemap.json', JSON.stringify(buildPortable()));
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(readBasemapPackage(buffer)).rejects.toThrow(/missing the thumbnail file/);
  });

  it('rejects an archive whose total uncompressed size exceeds the safety limit', async () => {
    const zip = new jsZip();
    const portable = buildPortable();
    zip.file('basemap.json', JSON.stringify(portable));
    const oversizedBytes = 11 * 1024 * 1024;
    zip.file('thumbnail.png', Buffer.concat([buildPngBuffer(), Buffer.alloc(oversizedBytes)]));
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(readBasemapPackage(buffer)).rejects.toThrow(/too large/);
  });

  it('rejects a thumbnail file that is not a valid image at all', async () => {
    const zip = new jsZip();
    zip.file('basemap.json', JSON.stringify(buildPortable()));
    zip.file('thumbnail.png', Buffer.from('definitely not an image'));
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(readBasemapPackage(buffer)).rejects.toThrow(/not a valid PNG or WebP/);
  });

  it('rejects a layer missing id/order', async () => {
    const portable = buildPortable();
    const zip = new jsZip();
    zip.file('basemap.json', JSON.stringify({ ...portable, layers: [{ opacity: 1, source: portable.layers[0]?.source }] }));
    zip.file('thumbnail.png', buildPngBuffer());
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(readBasemapPackage(buffer)).rejects.toThrow(/missing id/);
  });

  it('rejects an EXTERNAL layer with an unrecognized protocol', async () => {
    const portable = buildPortable();
    const badLayer = {
      id: 'l1',
      order: 0,
      opacity: 1,
      source: { type: 'EXTERNAL', details: { protocol: 'FTP', name: 'n', url: 'https://example.com' } },
    };
    const zip = new jsZip();
    zip.file('basemap.json', JSON.stringify({ ...portable, layers: [badLayer] }));
    zip.file('thumbnail.png', buildPngBuffer());
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(readBasemapPackage(buffer)).rejects.toThrow(/unknown protocol/);
  });

  it('rejects a layer with an unrecognized source.type', async () => {
    const portable = buildPortable();
    const badLayer = { id: 'l1', order: 0, opacity: 1, source: { type: 'SOMETHING_ELSE' } };
    const zip = new jsZip();
    zip.file('basemap.json', JSON.stringify({ ...portable, layers: [badLayer] }));
    zip.file('thumbnail.png', buildPngBuffer());
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(readBasemapPackage(buffer)).rejects.toThrow(/not a recognized source type/);
  });
});
