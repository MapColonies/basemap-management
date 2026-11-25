/* eslint-disable @typescript-eslint/no-require-imports */
import type * as nodeFs from 'node:fs';
import type * as nodePath from 'node:path';
import type { DocumentModule } from './document.cjs';

const fs = require('node:fs') as typeof nodeFs;
const path = require('node:path') as typeof nodePath;
const { buildOpenApiDocument, serializeOpenApiDocument } = require('./document.cts') as DocumentModule;

const OUTPUT_FILE = path.resolve(__dirname, '..', 'openapi3.yaml');

async function main(): Promise<void> {
  const text = await serializeOpenApiDocument(await buildOpenApiDocument(), OUTPUT_FILE);
  if (process.argv.includes('--check')) {
    const committed = fs.existsSync(OUTPUT_FILE) ? fs.readFileSync(OUTPUT_FILE, 'utf8') : '';
    if (committed !== text) {
      console.error('openapi3.yaml is out of date with the Zod schemas. Run `npm run generate:openapi` and commit the result.');
      process.exitCode = 1;
      return;
    }
    console.log('openapi3.yaml is up to date.');
    return;
  }
  fs.writeFileSync(OUTPUT_FILE, text);
  console.log(`wrote ${path.relative(process.cwd(), OUTPUT_FILE)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
