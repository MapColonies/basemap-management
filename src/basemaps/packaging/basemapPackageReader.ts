import jsZip from 'jszip';
import { ValidationError } from '@common/errors';
import { sniffImage } from '../thumbnails/imageFormat';
import { Domain } from '../models/catalogTypes';
import { PROTOCOLS, SourceTypeInput, THUMBNAIL_DIMENSION_PIXELS } from '../models/types';
import type { IBasemapLayerInput, IImportPackageThumbnail, IPortableBasemap } from '../models/types';

const MAX_ENTRIES = 10;
const BYTES_PER_KILOBYTE = 1024;
const MAX_TOTAL_UNCOMPRESSED_MEGABYTES = 10; // generous for a tiny JSON doc + one 128x128 image
const MAX_TOTAL_UNCOMPRESSED_BYTES = MAX_TOTAL_UNCOMPRESSED_MEGABYTES * BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
const MIN_OPACITY = 0;
const MAX_OPACITY = 1;

interface IParsedBasemapPackage {
  portable: IPortableBasemap;
  thumbnail: IImportPackageThumbnail;
}

function isSafeEntryName(name: string): boolean {
  if (name.length === 0 || name.includes('..') || name.includes('/') || name.includes('\\')) {
    return false;
  }
  return !name.startsWith('.');
}

function assertValidPortableLayer(layer: unknown, index: number): asserts layer is IBasemapLayerInput {
  if (typeof layer !== 'object' || layer === null) {
    throw new ValidationError(`layers[${index}] is not an object`);
  }
  const candidate = layer as { id?: unknown; order?: unknown; opacity?: unknown; source?: unknown };
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
    throw new ValidationError(`layers[${index}] is missing id`);
  }
  if (typeof candidate.order !== 'number') {
    throw new ValidationError(`layers[${index}] is missing order`);
  }
  if (typeof candidate.opacity !== 'number' || candidate.opacity < MIN_OPACITY || candidate.opacity > MAX_OPACITY) {
    throw new ValidationError(`layers[${index}].opacity must be a number between 0 and 1`);
  }
  if (typeof candidate.source !== 'object' || candidate.source === null) {
    throw new ValidationError(`layers[${index}].source is not an object`);
  }
  const source = candidate.source as { type?: unknown };
  switch (source.type) {
    case SourceTypeInput.CATALOG_RESOURCE: {
      const catalogSource = source as { domain?: unknown; uniqueness?: unknown };
      if (catalogSource.domain !== Domain.RASTER) {
        throw new ValidationError(`layers[${index}].source.domain must be ${Domain.RASTER}`);
      }
      const uniqueness = catalogSource.uniqueness as { productId?: unknown; productType?: unknown } | null | undefined;
      if (typeof uniqueness?.productId !== 'string' || typeof uniqueness.productType !== 'string') {
        throw new ValidationError(`layers[${index}].source is missing uniqueness.productId/productType`);
      }
      break;
    }
    case SourceTypeInput.EXTERNAL: {
      const externalSource = source as { details?: unknown };
      if (typeof externalSource.details !== 'object' || externalSource.details === null) {
        throw new ValidationError(`layers[${index}].source is missing details`);
      }
      const details = externalSource.details as { protocol?: unknown; name?: unknown; url?: unknown };
      if (typeof details.protocol !== 'string' || !(PROTOCOLS as readonly string[]).includes(details.protocol)) {
        throw new ValidationError(`layers[${index}].source.details has an unknown protocol`);
      }
      if (typeof details.name !== 'string' || details.name.length === 0) {
        throw new ValidationError(`layers[${index}].source.details is missing name`);
      }
      if (typeof details.url !== 'string' || details.url.length === 0) {
        throw new ValidationError(`layers[${index}].source.details is missing url`);
      }
      break;
    }
    default:
      throw new ValidationError(`layers[${index}].source.type is not a recognized source type`);
  }
}

function assertValidPortableBasemap(manifest: unknown): asserts manifest is IPortableBasemap {
  if (typeof manifest !== 'object' || manifest === null) {
    throw new ValidationError('basemap.json is not an object');
  }
  const candidate = manifest as { name?: unknown; isCurrent?: unknown; isForPreview?: unknown; thumbnail?: unknown; layers?: unknown };

  if (typeof candidate.name !== 'string' || candidate.name.trim().length === 0) {
    throw new ValidationError('basemap.json is missing a non-empty name');
  }
  if (typeof candidate.isCurrent !== 'boolean' || typeof candidate.isForPreview !== 'boolean') {
    throw new ValidationError('basemap.json is missing isCurrent/isForPreview');
  }
  if (typeof candidate.thumbnail !== 'object' || candidate.thumbnail === null) {
    throw new ValidationError('basemap.json is missing thumbnail.file');
  }
  const thumbnail = candidate.thumbnail as { file?: unknown };
  if (typeof thumbnail.file !== 'string') {
    throw new ValidationError('basemap.json is missing thumbnail.file');
  }
  if (!isSafeEntryName(thumbnail.file)) {
    throw new ValidationError('basemap.json references an unsafe thumbnail file name');
  }
  if (!Array.isArray(candidate.layers)) {
    throw new ValidationError('basemap.json is missing a layers array');
  }
  candidate.layers.forEach(assertValidPortableLayer);
}

async function readBasemapPackage(archiveBuffer: Buffer): Promise<IParsedBasemapPackage> {
  let zip: Awaited<ReturnType<typeof jsZip.loadAsync>>;
  try {
    zip = await jsZip.loadAsync(archiveBuffer);
  } catch {
    throw new ValidationError('the uploaded file is not a valid ZIP archive');
  }

  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length === 0) {
    throw new ValidationError('the archive is empty');
  }
  if (entries.length > MAX_ENTRIES) {
    throw new ValidationError('the archive contains too many entries');
  }
  for (const entry of entries) {
    if (!isSafeEntryName(entry.name)) {
      throw new ValidationError(`the archive contains an unsafe entry path: "${entry.name}"`);
    }
  }

  const manifestEntry = zip.file('basemap.json');
  if (!manifestEntry) {
    throw new ValidationError('the archive is missing basemap.json');
  }

  let totalBytes = 0;
  const manifestText = await manifestEntry.async('string');
  totalBytes += Buffer.byteLength(manifestText);

  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestText);
  } catch {
    throw new ValidationError('basemap.json is not valid JSON');
  }
  assertValidPortableBasemap(manifestJson);

  const thumbnailEntry = zip.file(manifestJson.thumbnail.file);
  if (!thumbnailEntry) {
    throw new ValidationError(`the archive is missing the thumbnail file referenced by basemap.json: "${manifestJson.thumbnail.file}"`);
  }

  const thumbnailBuffer = await thumbnailEntry.async('nodebuffer');
  totalBytes += thumbnailBuffer.length;
  if (totalBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
    throw new ValidationError('the archive is too large');
  }

  const sniffed = sniffImage(thumbnailBuffer);
  if (!sniffed) {
    throw new ValidationError('the thumbnail file is not a valid PNG or WebP image');
  }
  if (sniffed.width !== THUMBNAIL_DIMENSION_PIXELS || sniffed.height !== THUMBNAIL_DIMENSION_PIXELS) {
    throw new ValidationError(
      `the thumbnail must be exactly ${THUMBNAIL_DIMENSION_PIXELS}x${THUMBNAIL_DIMENSION_PIXELS} pixels, got ${sniffed.width}x${sniffed.height}`
    );
  }

  return {
    portable: manifestJson,
    thumbnail: { mimeType: sniffed.mimeType, buffer: thumbnailBuffer, width: sniffed.width, height: sniffed.height },
  };
}

export { readBasemapPackage };
export type { IParsedBasemapPackage };
