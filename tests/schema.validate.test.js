// tests/schema.validate.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(process.cwd());

async function loadJson(p) {
  const txt = await fs.readFile(path.join(ROOT, p), 'utf8');
  return JSON.parse(txt);
}

test('enemies.json conforms to schema', async () => {
  const [schema, data] = await Promise.all([
    loadJson('schemas/enemies.schema.json'),
    loadJson('enemies.json').catch(() => ({})) // allow missing file => empty object
  ]);

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const ok = validate(data);
  if (!ok) {
    console.error(validate.errors);
  }
  assert.ok(ok, 'enemies.json does not match schema');
});

test('waves.json conforms to schema', async () => {
  const [schema, data] = await Promise.all([
    loadJson('schemas/waves.schema.json'),
    loadJson('waves.json').catch(() => ([])) // allow missing file => empty array
  ]);

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const ok = validate(data);
  if (!ok) {
    console.error(validate.errors);
  }
  assert.ok(ok, 'waves.json does not match schema');
});
