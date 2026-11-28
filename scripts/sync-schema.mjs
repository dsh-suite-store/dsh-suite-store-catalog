#!/usr/bin/env node
/**
 * Regenerate the category section of `schema/bundle.schema.json`.
 *
 * `schema/categories.json` is the single source of truth for the primary slugs
 * and, under each, its secondary slugs. The schema cannot `$ref` a JSON data
 * file, so the enums have to be written out — but hand-maintained copies drift,
 * and a stale enum silently rejects valid bundles or accepts renamed slugs.
 * This script writes them from the data file, and `--check` fails when the
 * committed schema no longer matches.
 *
 * Usage:
 *   node scripts/sync-schema.mjs           # rewrite the generated blocks
 *   node scripts/sync-schema.mjs --check   # exit 1 when they are stale (CI)
 */

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { LOCALIZED_TEXT_MAX } from './limits.mjs'

const root = resolve(import.meta.dirname, '..')
const CATEGORIES = resolve(root, 'schema/categories.json')
const SCHEMA = resolve(root, 'schema/bundle.schema.json')

/** Marker around the generated region, so a human knows not to edit it. */
const BEGIN = '    "category": {'
const END = '    "tags": {'
const LOCALIZED_BEGIN = '    "localized": {'
const LOCALIZED_END = '    "member": {'

/**
 * The `category` property, with the primary enum and one if/then block per
 * primary that pins its secondaries.
 *
 * @param {{ categories: Array<{slug: string, secondary: Array<{slug: string}>}> }} data
 * @returns {string} the JSON text of the property, indented to `properties` depth.
 */
function categorySection(data) {  const primaries = data.categories.map((entry) => entry.slug)
  const blocks = data.categories.map((entry) => ({
    if: {
      properties: { primary: { const: entry.slug } },
      required: ['primary'],
    },
    then: {
      properties: {
        secondary: { enum: entry.secondary.map((second) => second.slug) },
      },
    },
  }))
  const property = {
    type: 'object',
    additionalProperties: false,
    required: ['primary'],
    properties: {
      primary: {
        type: 'string',
        description: 'A scenario category: one of the primaries in schema/categories.json.',
        enum: primaries,
      },
      secondary: {
        type: 'string',
        description: 'Optional chip. When present it must be one of the secondary slugs under the chosen primary (see schema/categories.json).',
      },
    },
    allOf: blocks,
  }
  // `BEGIN` already opens the object, so only the member lines are emitted, one
  // level in from the `"category"` key; the closing brace sits at the key's
  // indentation. Depth is fixed because the schema is pretty-printed at 2.
  const lines = JSON.stringify(property, null, 2).split('\n')
  const body = lines.slice(1, -1).map((line) => `    ${line}`).join('\n')
  return `${BEGIN}\n${body}\n    }`
}

/**
 * The shared bilingual string definition. Every user-authored localized
 * field references this one, so its maxLength is the single schema-side cap.
 */
function localizedSection(max) {
  const property = {
    type: 'object',
    additionalProperties: false,
    required: ['en'],
    description: `Every user-authored localized string is capped at ${String(max)} characters.`,
    properties: {
      zh: { type: 'string', minLength: 1, maxLength: max },
      en: { type: 'string', minLength: 1, maxLength: max },
    },
  }
  const lines = JSON.stringify(property, null, 2).split('\n')
  const body = lines.slice(1, -1).map((line) => `    ${line}`).join('\n')
  return `${LOCALIZED_BEGIN}\n${body}\n    }`
}

/** Replace the region between the two markers, keeping the rest byte-identical. */
function regenerate(source, section, beginMarker = BEGIN, endMarker = END) {
  const begin = source.indexOf(beginMarker)
  const end = source.indexOf(endMarker)
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(`cannot find the generated region in ${SCHEMA} (looked for ${beginMarker} ? ${endMarker})`)
  }
  return `${source.slice(0, begin)}${section},\n${source.slice(end)}`
}

/**
 * The schema source with the category section regenerated from `data`.
 *
 * Line-ending agnostic: git checks this file out as CRLF on Windows and as LF
 * in CI, so both are normalized before the comparison. Returns the new text in
 * LF form plus the line ending the input used, so the caller can write back in
 * the file's own convention and a no-op run stays a no-op.
 *
 * @param {string} raw - the current schema file.
 * @param {{ categories: Array<{slug: string, secondary: Array<{slug: string}>}> }} data
 * @returns {{ text: string, eol: string, changed: boolean }}
 */
export function syncSchema(raw, data) {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const source = raw.replace(/\r\n/gu, '\n')
  const text = regenerate(
    regenerate(source, categorySection(data), BEGIN, END),
    localizedSection(LOCALIZED_TEXT_MAX),
    LOCALIZED_BEGIN,
    LOCALIZED_END,
  )
  // Round-trip: a broken generator must not be able to commit invalid JSON.
  JSON.parse(text)
  return { text, eol, changed: text !== source }
}

if (import.meta.main) {
  const check = process.argv.includes('--check')
  const data = JSON.parse(await readFile(CATEGORIES, 'utf8'))
  const raw = await readFile(SCHEMA, 'utf8')
  const { text, eol, changed } = syncSchema(raw, data)

  if (!changed) {
    console.log(`schema/bundle.schema.json is in sync with schema/categories.json (${String(data.categories.length)} primaries)`)
    process.exitCode = 0
  } else if (check) {
    console.error('schema/bundle.schema.json is stale — run `node scripts/sync-schema.mjs` and commit the result')
    process.exitCode = 1
  } else {
    // Write back in the file's own line ending, so a Windows run does not turn
    // the whole file into a diff.
    await writeFile(SCHEMA, eol === '\n' ? text : text.replace(/\n/gu, '\r\n'), 'utf8')
    console.log(`schema/bundle.schema.json updated from schema/categories.json (${String(data.categories.length)} primaries)`)
  }
}
