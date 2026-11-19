import type { CapabilityWMTS } from '@map-colonies/wmts-client';

export const MOCK_CAPABILITIES: CapabilityWMTS[] = [
  {
    id: 'Cyprus_BACKUP_RESTORE-Orthophoto',
    style: [
      {
        value: 'default',
        isDefault: 'true',
      },
    ],
    format: ['image/png'],
    tileMatrixSet: [
      {
        tileMatrixSetID: 'WorldCRS84',
        tileMatrixLabels: [
          '00',
          '01',
          '02',
          '03',
          '04',
          '05',
          '06',
          '07',
          '08',
          '09',
          '10',
          '11',
          '12',
          '13',
          '14',
          '15',
          '16',
          '17',
          '18',
          '19',
          '20',
          '21',
        ],
      },
    ],
    url: [
      {
        format: 'image/png',
        resourceType: 'tile',
        template:
          'https://raster-serving-mapproxy-nginx-route-manual-integration.apps.j1lk3njp.eastus.aroapp.io/api/raster/v1/wmts/Cyprus_BACKUP_RESTORE-Orthophoto/{TileMatrixSet}/{TileMatrix}/{TileCol}/{TileRow}.png',
      },
    ],
  },
];
