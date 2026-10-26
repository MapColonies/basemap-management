import { ValidationError } from './errors';

/**
 * express-openapi-validator attaches uploaded multipart files to `req.files` via multer (configured
 * with in-memory storage in `serverBuilder.ts`). That isn't part of the OpenAPI-generated request
 * type - which only models the JSON-Schema view of the multipart body - so we read it through this
 * narrow, explicitly-typed accessor instead of broadening `TypedRequestHandlers` or reaching for `any`.
 *
 * Accepts anything carrying an optional `files` property (i.e. an Express `Request` after multer ran)
 * rather than the full `Request` type, since the generated per-operation request types differ in
 * their `params`/`body` generics and we only ever need this one property off of them. `files` is
 * typed as a union because `@types/multer` supports both `.any()` (array - what
 * express-openapi-validator actually uses) and `.fields()` (keyed object) call styles.
 */
export function getUploadedFile(
  req: { files?: Express.Multer.File[] | Record<string, Express.Multer.File[]> },
  fieldName: string
): Express.Multer.File {
  const files = Array.isArray(req.files) ? req.files : (req.files?.[fieldName] ?? []);
  const file = files.find((candidate) => candidate.fieldname === fieldName);
  if (!file) {
    throw new ValidationError(`missing required multipart field "${fieldName}"`);
  }
  return file;
}
