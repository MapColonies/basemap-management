/* eslint-disable @typescript-eslint/naming-convention */
import { z } from 'zod';

const IMPORT_THUMBNAIL_MIME_TYPES = ['image/png', 'image/webp'] as const;

export const ImportReviewRoleConflictSchema = z.object({
  basemapId: z.string(),
  basemapName: z.string(),
});

export const ImportReviewThumbnailSchema = z.discriminatedUnion('included', [
  z.object({
    included: z.literal(true),
    width: z.number().int(),
    height: z.number().int(),
    mimeType: z.enum(IMPORT_THUMBNAIL_MIME_TYPES),
    dataBase64: z.string().describe('The thumbnail binary, base64-encoded, for direct use as in-memory editor state.'),
  }),
  z.object({ included: z.literal(false) }),
]);

export const ImportReviewBaseSchema = z.object({
  name: z.string(),
  isCurrent: z.boolean(),
  isForPreview: z.boolean(),
  currentRoleConflict: ImportReviewRoleConflictSchema.optional().describe(
    'Present when isCurrent=true and another Basemap currently owns that role.'
  ),
  previewRoleConflict: ImportReviewRoleConflictSchema.optional().describe(
    'Present when isForPreview=true and another Basemap currently owns that role.'
  ),
  thumbnail: ImportReviewThumbnailSchema,
});
