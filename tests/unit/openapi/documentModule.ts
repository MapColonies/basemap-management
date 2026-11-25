import { createRequire } from 'node:module';
import path from 'node:path';
import type { DocumentModule } from '../../../openapi/document.cjs';

export function loadDocumentModule(): DocumentModule {
  return createRequire(path.join(process.cwd(), 'package.json'))('./openapi/document.cts') as DocumentModule;
}
