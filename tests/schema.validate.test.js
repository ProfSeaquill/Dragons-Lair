// tests/schema.validate.test.js
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';

test('waves.json conforms to schema', async (t) => {
  if (!fs.existsSync(new URL('../waves.json', import.meta.url))) {
    await t.test('waves.json optional', () => assert.ok(true));
    return; // skip if file absent
  }
  const raw = await readFile(new URL('../waves.json', import.meta.url), 'utf8');
  const data = JSON.parse(raw);
  const schema = /* your existing schema object */;
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);
  const ok = validate(data);
  assert.equal(ok, true, 'waves.json does not match schema\n' + JSON.stringify(validate.errors, null, 2));
});


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
