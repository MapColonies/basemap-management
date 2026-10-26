import { describe, it, expect } from 'vitest';
import { xmlToCapabilities } from '@src/clients/mapServer/xmlToCapabilities';

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

describe('xmlToCapabilities', () => {
  it('maps every WMTS layer to the BFF Capability shape', () => {
    expect(xmlToCapabilities(CAPABILITIES_XML)).toEqual([
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
        style: [{ value: 'default' }],
        format: ['image/png'],
        // no TileMatrixSetLimits: labels come from the document-level TileMatrixSet, kept as strings
        tileMatrixSet: [{ tileMatrixSetID: 'webmercator', tileMatrixLabels: ['00', '01'] }],
        url: [{ format: 'image/png', resourceType: 'tile', template: 'https://mapproxy/wmts/osm/{TileMatrix}.png' }],
      },
    ]);
  });

  it('returns an empty list for a document without layers', () => {
    expect(xmlToCapabilities('<Capabilities><Contents/></Capabilities>')).toEqual([]);
  });
});
