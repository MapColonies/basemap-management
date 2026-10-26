/* eslint-disable @typescript-eslint/naming-convention -- field names dictated by the OGC WMTS capabilities XML schema */
import { XMLParser } from 'fast-xml-parser';
import type { CapabilityModelType } from '@src/basemaps/models/catalogTypes';

interface IXmlAttr {
  attr?: Record<string, string>;
}

interface IXmlStyle extends IXmlAttr {
  'ows:Identifier'?: string;
}

interface IXmlTileMatrixSetLink {
  TileMatrixSet?: string;
  TileMatrixSetLimits?: { TileMatrixLimits?: { TileMatrix?: string }[] };
}

interface IXmlLayer {
  'ows:Identifier'?: string;
  Style?: IXmlStyle[];
  Format?: string[];
  TileMatrixSetLink?: IXmlTileMatrixSetLink[];
  ResourceURL?: IXmlAttr[];
}

interface IXmlTileMatrixSet {
  'ows:Identifier'?: string;
  TileMatrix?: { 'ows:Identifier'?: string }[];
}

interface IXmlCapabilities {
  Capabilities?: { Contents?: { Layer?: IXmlLayer[]; TileMatrixSet?: IXmlTileMatrixSet[] } };
}

const ARRAY_PATHS = [
  'Contents.Layer',
  'Contents.TileMatrixSet',
  'Contents.TileMatrixSet.TileMatrix',
  'Layer.Style',
  'Layer.Format',
  'Layer.TileMatrixSetLink',
  'Layer.ResourceURL',
  'TileMatrixSetLimits.TileMatrixLimits',
];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  attributesGroupName: 'attr',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (_tagName: string, jPath: unknown): boolean => typeof jPath === 'string' && ARRAY_PATHS.some((path) => jPath.endsWith(path)),
});

export function xmlToCapabilities(xmlData: string): CapabilityModelType[] {
  const json = parser.parse(xmlData) as IXmlCapabilities;
  const contents = json.Capabilities?.Contents;

  const tileMatrixLabelsBySet = new Map<string, string[]>();
  contents?.TileMatrixSet?.forEach((tileMatrixSet) => {
    const id = tileMatrixSet['ows:Identifier'];
    if (id !== undefined) {
      tileMatrixLabelsBySet.set(
        id,
        (tileMatrixSet.TileMatrix ?? []).map((tileMatrix) => String(tileMatrix['ows:Identifier']))
      );
    }
  });

  return (contents?.Layer ?? []).flatMap((layer): CapabilityModelType[] => {
    const id = layer['ows:Identifier'];
    if (id === undefined) {
      return [];
    }
    return [
      {
        id,
        style: (layer.Style ?? []).map((style) => {
          const isDefault = style.attr?.isDefault;
          return { value: String(style['ows:Identifier']), ...(isDefault === 'true' ? { isDefault } : {}) };
        }),
        format: layer.Format ?? [],
        tileMatrixSet: (layer.TileMatrixSetLink ?? []).flatMap((link) => {
          const tileMatrixSetID = link.TileMatrixSet;
          if (tileMatrixSetID === undefined) {
            return [];
          }
          const limits = link.TileMatrixSetLimits?.TileMatrixLimits;
          const tileMatrixLabels =
            limits !== undefined ? limits.map((limit) => String(limit.TileMatrix)) : (tileMatrixLabelsBySet.get(tileMatrixSetID) ?? []);
          return [{ tileMatrixSetID, tileMatrixLabels }];
        }),
        url: (layer.ResourceURL ?? [])
          .map((resourceUrl) => resourceUrl.attr ?? {})
          .filter((attr) => attr.resourceType === 'tile')
          .map((attr) => ({ format: attr.format ?? '', resourceType: attr.resourceType ?? '', template: attr.template ?? '' })),
      },
    ];
  });
}
