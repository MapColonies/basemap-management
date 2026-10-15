import { describe, it, expect } from 'vitest';
import { ProductType } from '@map-colonies/types';
import { validateBasemapWriteInput } from '@src/basemaps/models/basemapValidation';
import type { IBasemapLayerInput, IBasemapWriteInput } from '@src/basemaps/models/types';

function baseInput(): IBasemapWriteInput {
  return {
    name: 'Satellite Europe',
    thumbnail: { url: 'https://example.com/thumb.png', width: 128, height: 128 },
    isCurrent: false,
    isForPreview: false,
    layers: [
      { id: 'layer-1', order: 0, opacity: 1, source: { type: 'RASTER_RESOURCE', productId: '12345', productType: ProductType.ORTHOPHOTO } },
      {
        id: 'layer-2',
        order: 1,
        opacity: 0.7,
        source: { type: 'EXTERNAL', details: { protocol: 'XYZ', name: 'Google Satellite', url: 'https://example.com/{z}/{x}/{y}' } },
      },
    ],
  };
}

/** `noUncheckedIndexedAccess` makes `input.layers[n]` possibly-undefined - these tests know better. */
function layerAt(input: IBasemapWriteInput, index: number): IBasemapLayerInput {
  const layer = input.layers[index];
  if (!layer) {
    throw new Error(`test setup error: no layer at index ${index}`);
  }
  return layer;
}

describe('validateBasemapWriteInput', () => {
  it('accepts a well-formed input', () => {
    expect(() => validateBasemapWriteInput(baseInput())).not.toThrow();
  });

  it('rejects an empty name', () => {
    const input = { ...baseInput(), name: '   ' };
    expect(() => validateBasemapWriteInput(input)).toThrow(/name/);
  });

  it('rejects a missing thumbnail url', () => {
    const input = { ...baseInput(), thumbnail: { url: '', width: 128 as const, height: 128 as const } };
    expect(() => validateBasemapWriteInput(input)).toThrow(/thumbnail/);
  });

  it('rejects opacity above 1', () => {
    const input = baseInput();
    layerAt(input, 0).opacity = 1.5;
    expect(() => validateBasemapWriteInput(input)).toThrow(/opacity/);
  });

  it('rejects opacity below 0', () => {
    const input = baseInput();
    layerAt(input, 0).opacity = -0.1;
    expect(() => validateBasemapWriteInput(input)).toThrow(/opacity/);
  });

  it('rejects a RASTER_RESOURCE layer missing productId', () => {
    const input = baseInput();
    input.layers[0] = { ...layerAt(input, 0), source: { type: 'RASTER_RESOURCE', productId: '', productType: ProductType.ORTHOPHOTO } };
    expect(() => validateBasemapWriteInput(input)).toThrow(/productId/);
  });

  it('rejects a RASTER_RESOURCE layer with an unrecognized productType', () => {
    const input = baseInput();
    input.layers[0] = {
      ...layerAt(input, 0),
      source: { type: 'RASTER_RESOURCE', productId: '12345', productType: 'NotARealProductType' as ProductType },
    };
    expect(() => validateBasemapWriteInput(input)).toThrow(/productType/);
  });

  it('rejects an EXTERNAL layer with an unrecognized protocol', () => {
    const input = baseInput();
    input.layers[1] = {
      ...layerAt(input, 1),
      source: { type: 'EXTERNAL', details: { protocol: 'FTP' as 'XYZ', name: 'n', url: 'https://example.com' } },
    };
    expect(() => validateBasemapWriteInput(input)).toThrow(/protocol/);
  });

  it('rejects an EXTERNAL layer missing details.name', () => {
    const input = baseInput();
    input.layers[1] = { ...layerAt(input, 1), source: { type: 'EXTERNAL', details: { protocol: 'XYZ', name: '', url: 'https://example.com' } } };
    expect(() => validateBasemapWriteInput(input)).toThrow(/name/);
  });

  it('rejects an EXTERNAL layer missing details.url', () => {
    const input = baseInput();
    input.layers[1] = { ...layerAt(input, 1), source: { type: 'EXTERNAL', details: { protocol: 'XYZ', name: 'n', url: '' } } };
    expect(() => validateBasemapWriteInput(input)).toThrow(/url/);
  });

  it('accepts EXTERNAL details carrying additional provider-specific keys', () => {
    const input = baseInput();
    input.layers[1] = {
      ...layerAt(input, 1),
      source: { type: 'EXTERNAL', details: { protocol: 'WMTS', name: 'n', url: 'https://example.com', layer: 'ortho', matrixSet: 'EPSG:3857' } },
    };
    expect(() => validateBasemapWriteInput(input)).not.toThrow();
  });

  it('rejects duplicate layer ids', () => {
    const input = baseInput();
    input.layers[1] = { ...layerAt(input, 1), id: layerAt(input, 0).id };
    expect(() => validateBasemapWriteInput(input)).toThrow(/duplicate layer id/);
  });

  it('rejects duplicate layer orders', () => {
    const input = baseInput();
    input.layers[1] = { ...layerAt(input, 1), order: layerAt(input, 0).order };
    expect(() => validateBasemapWriteInput(input)).toThrow(/duplicate layer order/);
  });
});
