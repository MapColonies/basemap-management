/* eslint-disable @typescript-eslint/naming-convention -- `$`/`_` are xml2js's fixed attribute/text-content keys, not ours to rename */
import type { IPropPYCSWMapping } from '@map-colonies/mc-model-types';
import type { LayerRasterRecordModelType, LinkModelType } from '@src/basemaps/models/catalogTypes';

interface IRawPycswLink {
  $?: { scheme?: string; name?: string; description?: string };
  _?: string;
}
/* eslint-enable @typescript-eslint/naming-convention */

function toLinkModel(raw: unknown): LinkModelType {
  const link = (raw ?? {}) as IRawPycswLink;
  return {
    protocol: link.$?.scheme,
    name: link.$?.name,
    description: link.$?.description,
    url: link._,
  };
}

export function mapPycswRecordToLayer(raw: Record<string, unknown>, pyCSWKeys: readonly IPropPYCSWMapping[]): LayerRasterRecordModelType {
  const renamed: Record<string, unknown> = {};
  for (const [xmlKey, value] of Object.entries(raw)) {
    const prop = pyCSWKeys.find((mapping) => mapping.xmlElement === xmlKey)?.prop ?? xmlKey;
    renamed[prop] = value;
  }

  const rawLinks = renamed.links;
  const links = rawLinks === undefined ? null : (Array.isArray(rawLinks) ? rawLinks : [rawLinks]).map(toLinkModel);

  return { ...renamed, links } as LayerRasterRecordModelType;
}
