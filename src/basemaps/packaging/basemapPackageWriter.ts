import jsZip from 'jszip';
import type { PortableBasemap } from '../models/types';

const JSON_INDENT_SPACES = 2;

export async function writeBasemapPackage(portable: PortableBasemap, thumbnailBuffer: Buffer): Promise<Buffer> {
  const zip = new jsZip();
  zip.file('basemap.json', JSON.stringify(portable, undefined, JSON_INDENT_SPACES));
  zip.file(portable.thumbnail.file, thumbnailBuffer);
  return zip.generateAsync({ type: 'nodebuffer' });
}
