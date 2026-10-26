import { describe, it, expect } from 'vitest';
import { applyDefaultRoles, assertSingleOwnerPerRole, findCurrentOwner, findPreviewOwner } from '@src/basemaps/models/defaultRolePolicy';
import type { IPersistedBasemap } from '@src/basemaps/models/types';

function makeBasemap(overrides: Partial<IPersistedBasemap> & Pick<IPersistedBasemap, 'id'>): IPersistedBasemap {
  return {
    name: overrides.id,
    thumbnail: { url: `https://example.com/${overrides.id}.png`, width: 128, height: 128 },
    isCurrent: false,
    isForPreview: false,
    layers: [],
    ...overrides,
  };
}

describe('defaultRolePolicy', () => {
  describe('#applyDefaultRoles', () => {
    it('sets isCurrent on the target and clears it from the previous owner', () => {
      const basemaps = [makeBasemap({ id: 'a', isCurrent: true }), makeBasemap({ id: 'b' })];

      const next = applyDefaultRoles(basemaps, 'b', { isCurrent: true });

      expect(findCurrentOwner(next)?.id).toBe('b');
      expect(next.find((basemap) => basemap.id === 'a')?.isCurrent).toBe(false);
    });

    it('sets isForPreview on the target and clears it from the previous owner, independently of isCurrent', () => {
      const basemaps = [makeBasemap({ id: 'a', isCurrent: true, isForPreview: true }), makeBasemap({ id: 'b' })];

      const next = applyDefaultRoles(basemaps, 'b', { isForPreview: true });

      expect(findPreviewOwner(next)?.id).toBe('b');
      // isCurrent is untouched - the roles are independent.
      expect(findCurrentOwner(next)?.id).toBe('a');
      expect(next.find((basemap) => basemap.id === 'a')?.isForPreview).toBe(false);
    });

    it('allows the same basemap to own both roles at once', () => {
      const basemaps = [makeBasemap({ id: 'a' })];

      const next = applyDefaultRoles(basemaps, 'a', { isCurrent: true, isForPreview: true });

      expect(next[0]).toMatchObject({ isCurrent: true, isForPreview: true });
    });

    it('releasing a role (false) only affects the target, never other basemaps', () => {
      const basemaps = [makeBasemap({ id: 'a', isCurrent: true }), makeBasemap({ id: 'b' })];

      const next = applyDefaultRoles(basemaps, 'a', { isCurrent: false });

      expect(findCurrentOwner(next)).toBeUndefined();
    });

    it('leaves both roles unowned when neither is requested - zero owners is valid', () => {
      const basemaps = [makeBasemap({ id: 'a' }), makeBasemap({ id: 'b' })];

      const next = applyDefaultRoles(basemaps, 'a', {});

      expect(findCurrentOwner(next)).toBeUndefined();
      expect(findPreviewOwner(next)).toBeUndefined();
    });
  });

  describe('#assertSingleOwnerPerRole', () => {
    it('does not throw when at most one basemap owns each role', () => {
      const basemaps = [makeBasemap({ id: 'a', isCurrent: true }), makeBasemap({ id: 'b', isForPreview: true })];

      expect(() => assertSingleOwnerPerRole(basemaps)).not.toThrow();
    });

    it('throws when two basemaps both have isCurrent=true', () => {
      const basemaps = [makeBasemap({ id: 'a', isCurrent: true }), makeBasemap({ id: 'b', isCurrent: true })];

      expect(() => assertSingleOwnerPerRole(basemaps)).toThrow(/isCurrent/);
    });

    it('throws when two basemaps both have isForPreview=true', () => {
      const basemaps = [makeBasemap({ id: 'a', isForPreview: true }), makeBasemap({ id: 'b', isForPreview: true })];

      expect(() => assertSingleOwnerPerRole(basemaps)).toThrow(/isForPreview/);
    });
  });
});
