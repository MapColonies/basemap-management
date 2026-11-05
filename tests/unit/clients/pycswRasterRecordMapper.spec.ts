/* eslint-disable @typescript-eslint/naming-convention -- `$`/`_` are xml2js's fixed attribute/text-content keys */
import { describe, it, expect } from 'vitest';
import type { IPropPYCSWMapping } from '@map-colonies/mc-model-types';
import { mapPycswRecordToLayer } from '@src/clients/rasterCatalog/pycswRasterRecordMapper';

const PYCSW_KEYS: IPropPYCSWMapping[] = [
  { prop: 'id', profile: 'mc_raster', xmlElement: 'mc:id', queryableField: 'mc:id' },
  { prop: 'productId', profile: 'mc_raster', xmlElement: 'mc:productId', queryableField: 'mc:productId' },
  { prop: 'productVersion', profile: 'mc_raster', xmlElement: 'mc:productVersion', queryableField: 'mc:productVersion' },
  { prop: 'productType', profile: 'mc_raster', xmlElement: 'mc:productType', queryableField: 'mc:productType' },
  { prop: 'productName', profile: 'mc_raster', xmlElement: 'mc:productName', queryableField: 'mc:productName' },
  { prop: 'links', profile: 'mc_raster', xmlElement: 'mc:links', queryableField: 'mc:links' },
];

describe('mapPycswRecordToLayer', () => {
  it('renames xmlElement keys to their mc-model-types prop names', () => {
    const raw = {
      'mc:id': 'record-1',
      'mc:productId': '12345',
      'mc:productVersion': '1.0',
      'mc:productType': 'Orthophoto',
      'mc:productName': 'Test Layer',
      'mc:links': { $: { scheme: 'WMTS', name: '12345-Orthophoto', description: 'wmts' }, _: 'https://mapproxy/wmts' },
    };

    const layer = mapPycswRecordToLayer(raw, PYCSW_KEYS);

    expect(layer).toEqual({
      id: 'record-1',
      productId: '12345',
      productVersion: '1.0',
      productType: 'Orthophoto',
      productName: 'Test Layer',
      links: [{ protocol: 'WMTS', name: '12345-Orthophoto', description: 'wmts', url: 'https://mapproxy/wmts' }],
    });
  });

  it('wraps a single raw links entry into an array, and passes an already-array links through', () => {
    const singleLinkLayer = mapPycswRecordToLayer({ 'mc:id': 'a', 'mc:links': { $: { scheme: 'WMTS', name: 'n' }, _: 'u' } }, PYCSW_KEYS);

    expect(singleLinkLayer.links).toEqual([{ protocol: 'WMTS', name: 'n', description: undefined, url: 'u' }]);

    const multiLinkLayer = mapPycswRecordToLayer(
      {
        'mc:id': 'a',
        'mc:links': [
          { $: { scheme: 'WMTS', name: 'n1' }, _: 'u1' },
          { $: { scheme: 'WMS', name: 'n2' }, _: 'u2' },
        ],
      },
      PYCSW_KEYS
    );

    expect(multiLinkLayer.links).toEqual([
      { protocol: 'WMTS', name: 'n1', description: undefined, url: 'u1' },
      { protocol: 'WMS', name: 'n2', description: undefined, url: 'u2' },
    ]);
  });

  it('leaves links null when the raw record has no links field', () => {
    const layer = mapPycswRecordToLayer({ 'mc:id': 'a', 'mc:productId': 'p' }, PYCSW_KEYS);

    expect(layer.links).toBeNull();
  });

  it('passes unmapped keys through unchanged', () => {
    const layer = mapPycswRecordToLayer({ 'mc:id': 'a', 'some:unknownField': 'x' }, PYCSW_KEYS);

    expect(layer).toMatchObject({ id: 'a', 'some:unknownField': 'x' });
  });
});
