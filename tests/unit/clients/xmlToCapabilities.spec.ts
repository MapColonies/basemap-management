import type { Logger } from '@map-colonies/js-logger';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { xmlToCapabilities } from '@src/clients/mapServer/xmlToCapabilities';

const mockLogger = { warn: vi.fn(), error: vi.fn() } as unknown as Logger;

const CAPABILITIES_XML = `<?xml version="1.0"?>
<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1" version="1.0.0">
  <Contents>
    <Layer>
      <ows:Identifier>12345-Orthophoto</ows:Identifier>
      <Style isDefault="true"><ows:Identifier>default</ows:Identifier></Style>
      <Format>image/jpeg</Format>
      <TileMatrixSetLink>
        <TileMatrixSet>WorldCRS84</TileMatrixSet>
        <TileMatrixSetLimits>
          <TileMatrixLimits><TileMatrix>0</TileMatrix></TileMatrixLimits>
          <TileMatrixLimits><TileMatrix>1</TileMatrix></TileMatrixLimits>
        </TileMatrixSetLimits>
      </TileMatrixSetLink>
      <ResourceURL format="image/jpeg" resourceType="tile" template="https://mapproxy/wmts/12345-Orthophoto/{TileMatrixSet}/{TileMatrix}/{TileCol}/{TileRow}.jpeg"/>
      <ResourceURL format="application/xml" resourceType="FeatureInfo" template="https://mapproxy/info"/>
    </Layer>
    <Layer>
      <ows:Identifier>osm</ows:Identifier>
      <Style><ows:Identifier>default</ows:Identifier></Style>
      <Format>image/png</Format>
      <TileMatrixSetLink><TileMatrixSet>webmercator</TileMatrixSet></TileMatrixSetLink>
      <ResourceURL format="image/png" resourceType="tile" template="https://mapproxy/wmts/osm/{TileMatrix}.png"/>
    </Layer>
    <TileMatrixSet>
      <ows:Identifier>webmercator</ows:Identifier>
      <TileMatrix><ows:Identifier>00</ows:Identifier></TileMatrix>
      <TileMatrix><ows:Identifier>01</ows:Identifier></TileMatrix>
    </TileMatrixSet>
  </Contents>
</Capabilities>`;

const INVALID_MISSING_FORMAT_XML = `<?xml version="1.0"?>
<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1" version="1.0.0">
  <Contents>
    <Layer>
      <ows:Identifier>invalid-missing-format</ows:Identifier>
      <Style><ows:Identifier>default</ows:Identifier></Style>
      <TileMatrixSetLink><TileMatrixSet>webmercator</TileMatrixSet></TileMatrixSetLink>
      <ResourceURL format="image/png" resourceType="tile" template="https://mapproxy/wmts/invalid/{TileMatrix}.png"/>
    </Layer>
    <TileMatrixSet>
      <ows:Identifier>webmercator</ows:Identifier>
      <TileMatrix><ows:Identifier>00</ows:Identifier></TileMatrix>
    </TileMatrixSet>
  </Contents>
</Capabilities>`;

describe('xmlToCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps every WMTS layer to the BFF Capability shape, including a non-default style as isDefault: null (not omitted) - matches CapabilitySchema', () => {
    expect(xmlToCapabilities(CAPABILITIES_XML, mockLogger)).toEqual([
      {
        id: '12345-Orthophoto',
        style: [{ value: 'default', isDefault: 'true' }],
        format: ['image/jpeg'],
        tileMatrixSet: [{ tileMatrixSetID: 'WorldCRS84', tileMatrixLabels: ['0', '1'] }],
        url: [
          {
            format: 'image/jpeg',
            resourceType: 'tile',
            template: 'https://mapproxy/wmts/12345-Orthophoto/{TileMatrixSet}/{TileMatrix}/{TileCol}/{TileRow}.jpeg',
          },
        ],
      },
      {
        id: 'osm',
        style: [{ value: 'default', isDefault: null }],
        format: ['image/png'],
        // no TileMatrixSetLimits: labels come from the document-level TileMatrixSet, kept as strings
        tileMatrixSet: [{ tileMatrixSetID: 'webmercator', tileMatrixLabels: ['00', '01'] }],
        url: [{ format: 'image/png', resourceType: 'tile', template: 'https://mapproxy/wmts/osm/{TileMatrix}.png' }],
      },
    ]);
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('returns an empty list for a document without layers, without warning or erroring', () => {
    expect(xmlToCapabilities('<Capabilities><Contents/></Capabilities>', mockLogger)).toEqual([]);
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('drops an individual capability that fails schema validation, logging a warning with its id, while keeping the valid ones', () => {
    const combinedXml = CAPABILITIES_XML.replace('</Contents>', `${INVALID_MISSING_FORMAT_XML.match(/<Layer>[\s\S]*?<\/Layer>/)![0]}</Contents>`);

    const result = xmlToCapabilities(combinedXml, mockLogger);

    expect(result.map((capability) => capability.id)).toEqual(['12345-Orthophoto', 'osm']);
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.objectContaining({ id: 'invalid-missing-format' }));
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('emits a single error summary (in addition to the per-item warning) when every capability in the batch fails validation', () => {
    const result = xmlToCapabilities(INVALID_MISSING_FORMAT_XML, mockLogger);

    expect(result).toEqual([]);
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledWith(expect.objectContaining({ failedCount: 1, total: 1 }));
  });
});
