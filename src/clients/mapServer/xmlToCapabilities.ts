/* eslint-disable @typescript-eslint/naming-convention -- field names dictated by the OGC WMTS capabilities XML schema */
import { XMLParser } from 'fast-xml-parser';
import type { Logger } from '@map-colonies/js-logger';
import { CapabilitySchema } from '@map-colonies/types';
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

export function xmlToCapabilities(xmlData: string, logger: Logger): CapabilityModelType[] {
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

  const candidates: unknown[] = (contents?.Layer ?? []).flatMap((layer) => {
    const id = layer['ows:Identifier'];
    if (id === undefined) {
      return [];
    }
    return [
      {
        id,
        style: (layer.Style ?? []).map((style) => {
          const isDefault = style.attr?.isDefault;
          return { value: String(style['ows:Identifier']), isDefault: isDefault === 'true' ? isDefault : null };
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

  const valid: CapabilityModelType[] = [];
  let failedCount = 0;
  candidates.forEach((candidate) => {
    const result = CapabilitySchema.safeParse(candidate);
    if (result.success) {
      valid.push(result.data);
    } else {
      failedCount += 1;
      logger.warn({
        msg: 'capability failed schema validation and was dropped',
        id: (candidate as { id?: unknown }).id,
        issues: result.error.message,
      });
    }
  });
  if (candidates.length > 0 && failedCount === candidates.length) {
    logger.error({
      msg: 'all capabilities failed schema validation - possible contract mismatch with @map-colonies/types',
      failedCount,
      total: candidates.length,
    });
  }

  return valid;
}
