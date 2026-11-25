import { describe, it, expect } from 'vitest';
import { findCollectionConflicts, findLayerConflicts } from '@src/basemaps/models/basemapInvariants';

const layer = (id: string, order: number): { id: string; order: number } => ({ id, order });
const basemap = (id: string, isCurrent = false, isForPreview = false): Record<string, unknown> => ({ id, isCurrent, isForPreview });

describe('basemapInvariants', () => {
  describe('#findLayerConflicts', () => {
    it('accepts unique layer ids and orders', () => {
      expect(findLayerConflicts([layer('a', 0), layer('b', 1), layer('c', 5)])).toEqual([]);
    });

    it('accepts an empty layer list', () => {
      expect(findLayerConflicts([])).toEqual([]);
    });

    it('reports a duplicate layer id with the positions of the conflicting layers', () => {
      expect(findLayerConflicts([layer('a', 0), layer('b', 1), layer('a', 2)])).toEqual(['duplicate layer id "a" (layers at positions 0, 2)']);
    });

    it('reports a duplicate layer order with the ids of the conflicting layers', () => {
      expect(findLayerConflicts([layer('a', 3), layer('b', 1), layer('c', 3)])).toEqual(['duplicate layer order 3 (layers "a", "c")']);
    });

    it('reports every conflict at once', () => {
      expect(findLayerConflicts([layer('a', 0), layer('a', 0)])).toEqual([
        'duplicate layer id "a" (layers at positions 0, 1)',
        'duplicate layer order 0 (layers "a", "a")',
      ]);
    });
  });

  describe('#findCollectionConflicts', () => {
    it('accepts unique basemap ids', () => {
      expect(findCollectionConflicts([basemap('a'), basemap('b')])).toEqual([]);
    });

    it('accepts an empty collection', () => {
      expect(findCollectionConflicts([])).toEqual([]);
    });

    it('reports a duplicate basemap id', () => {
      expect(findCollectionConflicts([basemap('a'), basemap('b'), basemap('a')])).toEqual(['duplicate basemap id "a" (2 entries)']);
    });

    it.each([
      ['isCurrent', [basemap('a', true), basemap('b', false, true)], []],
      ['isForPreview', [basemap('a', false, true), basemap('b', true)], []],
    ])('accepts exactly one basemap with %s=true', (_flag, basemaps, expected) => {
      expect(findCollectionConflicts(basemaps)).toEqual(expected);
    });

    it('accepts no current and no preview basemap', () => {
      expect(findCollectionConflicts([basemap('a'), basemap('b')])).toEqual([]);
    });

    it('accepts the same basemap being both current and for preview', () => {
      expect(findCollectionConflicts([basemap('a', true, true), basemap('b')])).toEqual([]);
    });

    it('reports multiple current basemaps, naming them', () => {
      expect(findCollectionConflicts([basemap('a', true), basemap('b'), basemap('c', true)])).toEqual([
        'multiple basemaps have isCurrent=true: "a", "c"',
      ]);
    });

    it('reports multiple preview basemaps, naming them', () => {
      expect(findCollectionConflicts([basemap('a', false, true), basemap('b', false, true)])).toEqual([
        'multiple basemaps have isForPreview=true: "a", "b"',
      ]);
    });

    it('checks the two roles independently', () => {
      expect(findCollectionConflicts([basemap('a', true, true), basemap('b', true, false), basemap('c', false, false)])).toEqual([
        'multiple basemaps have isCurrent=true: "a", "b"',
      ]);
    });

    it('takes structurally invalid raw entries into account, describing entries without an id by index', () => {
      const entries = [basemap('a', true), { id: 'a', name: 42 }, { isCurrent: true }, null, 'garbage'];

      expect(findCollectionConflicts(entries)).toEqual([
        'duplicate basemap id "a" (2 entries)',
        'multiple basemaps have isCurrent=true: "a", <entry at index 2 without an id>',
      ]);
    });

    it('does not treat truthy non-boolean flags as set', () => {
      expect(findCollectionConflicts([basemap('a', true), { id: 'b', isCurrent: 'true' }])).toEqual([]);
    });
  });
});
