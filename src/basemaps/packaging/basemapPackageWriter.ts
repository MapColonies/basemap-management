import jsZip from 'jszip';
import type { IPortableBasemap } from '../models/types';

const JSON_INDENT_SPACES = 2;

/** Builds the export ZIP buffer: `basemap.json` + the thumbnail binary, referenced by its package-local file name. */
export async function writeBasemapPackage(portable: IPortableBasemap, thumbnailBuffer: Buffer): Promise<Buffer> {
  const zip = new jsZip();
  zip.file('basemap.json', JSON.stringify(portable, undefined, JSON_INDENT_SPACES));
  zip.file(portable.thumbnail.file, thumbnailBuffer);
  return zip.generateAsync({ type: 'nodebuffer' });
}
