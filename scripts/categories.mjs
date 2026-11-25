/**
 * The category tree: one data file, read by both the validator and the builder.
 *
 * This is the awesome-dsh-plugin pattern — "the index is the schema". An
 * earlier version hard-coded seven category IDs in this codebase, which meant
 * adding a category required a code change and a release. Here the authority
 * is `schema/categories.json`; adding a category is a data PR, and the next
 * build publishes it in `dist/index.json` where the client renders tabs and
 * chips from it at runtime.
 *
 * Nothing outside this module and that JSON defines a category: the schema's
 * enum is generated from it (scripts/sync-schema.mjs) and the uniqueness gates
 * below run on it. Prose documents describe the tree; they are never an input.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const FILE = resolve(import.meta.dirname, '../schema/categories.json')

/** @typedef {{ slug: string, zh: string, en: string, secondary: {slug:string,zh:string,en:string}[] }} Category */

/**
 * The uniqueness gates on the JSON:
 *
 * 1. primary slugs are unique;
 * 2. a secondary slug is globally unique — no repeats across primaries, and
 *    no collision with a primary slug (a chip and a tab must not share a key,
 *    because `categoryLabels` flattens both into one lookup);
 * 3. every visible label is globally unique, per language, across both levels:
 *    two chips with the same name — or a chip and a tab — are indistinguishable
 *    to a reader even when their slugs differ.
 *
 * @param {Category[]} tree
 * @returns {void}
 * @throws {Error} listing every violation, when any gate fails.
 */
function assertTreeUnique(tree) {
  const problems = []
  const primarySlugs = new Set()
  for (const entry of tree) {
    if (primarySlugs.has(entry.slug)) {
      problems.push(`primary slug "${entry.slug}" appears more than once`)
    }
    primarySlugs.add(entry.slug)
  }
  const seenSlug = new Map()
  const seenZh = new Map()
  const seenEn = new Map()
  const claim = (seen, label, slug, where) => {
    const prior = seen.get(label)
    if (prior !== undefined) problems.push(`label "${label}" (${slug}) also names ${prior} under "${where}"`)
    else seen.set(label, `"${slug}"`)
  }
  for (const entry of tree) {
    claim(seenZh, entry.zh, entry.slug, 'primary')
    claim(seenEn, entry.en, entry.slug, 'primary')
    for (const second of entry.secondary) {
      if (primarySlugs.has(second.slug)) {
        problems.push(`secondary slug "${second.slug}" (${entry.slug}) collides with a primary slug`)
      }
      if (seenSlug.has(second.slug)) {
        problems.push(`secondary slug "${second.slug}" under both "${seenSlug.get(second.slug)}" and "${entry.slug}"`)
      } else {
        seenSlug.set(second.slug, entry.slug)
      }
      claim(seenZh, second.zh, second.slug, entry.slug)
      claim(seenEn, second.en, second.slug, entry.slug)
    }
  }
  if (problems.length > 0) {
    throw new Error(`schema/categories.json violates category uniqueness:\n  ${problems.join('\n  ')}`)
  }
}

/**
 * The category tree, uniqueness-gated.
 *
 * The count is whatever `schema/categories.json` holds — adding a category is a
 * data-only PR, so no number is repeated here.
 *
 * @returns {Promise<Category[]>} the categories, in the order of that file.
 */
export async function readCategories() {
  const raw = await readFile(FILE, 'utf8')
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`${FILE}: invalid JSON — ${error instanceof Error ? error.message : String(error)}`)
  }
  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.categories) || parsed.categories.length === 0) {
    throw new Error(`${FILE}: expected a non-empty categories array`)
  }
  // Shape before gates: a malformed entry would otherwise surface as a
  // `TypeError` from inside the uniqueness walk instead of naming the file.
  const SLUG = /^[a-z0-9-]+$/u
  for (const entry of parsed.categories) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)
      || !SLUG.test(String(entry.slug)) || typeof entry.zh !== 'string' || typeof entry.en !== 'string'
      || !Array.isArray(entry.secondary)) {
      throw new Error(`${FILE}: every category needs a slug, zh, en and a secondary array (got ${JSON.stringify(entry)?.slice(0, 80)})`)
    }
    for (const second of entry.secondary) {
      if (second === null || typeof second !== 'object'
        || !SLUG.test(String(second.slug)) || typeof second.zh !== 'string' || typeof second.en !== 'string') {
        throw new Error(`${FILE}: every secondary under "${entry.slug}" needs a slug, zh and en`)
      }
    }
  }
  assertTreeUnique(parsed.categories)
  return parsed.categories
}

/**
 * Validate a bundle's category against the tree.
 *
 * `primary` must be one of the slugs in schema/categories.json. `secondary` is
 * optional, but when present it MUST be one of the choices listed under that
 * primary — a bundle author cannot invent a chip slug, because chips are
 * navigational: a made-up value creates a tab with no siblings and no way back.
 *
 * @param {{primary?: string, secondary?: string}} category - from a submission.
 * @param {Category[]} tree - output of {@link readCategories}.
 * @returns {void}
 * @throws {Error} with a `gate` of G7 on failure.
 */
export function assertCategory(category, tree) {
  const fail = (message) => {
    const error = new Error(message)
    error.gate = 'G7'
    throw error
  }
  // `typeof null === 'object'`: without the explicit null test the next line
  // read a property of null and escaped as a bare TypeError.
  if (category === null || typeof category !== 'object' || Array.isArray(category)) {
    fail('$.category: required — choose one of the slugs in schema/categories.json')
  }
  const primary = category.primary
  if (typeof primary !== 'string' || primary === '') {
    fail('$.category.primary: required')
  }
  const chosen = tree.find((entry) => entry.slug === primary)
  if (chosen === undefined) {
    fail(`$.category.primary: "${primary}" is not one of the ${String(tree.length)} categories in schema/categories.json`)
  }
  if (category.secondary === undefined) return
  const secondary = category.secondary
  if (typeof secondary !== 'string' || secondary === '') {
    fail('$.category.secondary: expected a string')
  }
  if (!chosen.secondary.some((entry) => entry.slug === secondary)) {
    const allowed = chosen.secondary.map((entry) => entry.slug).join(', ')
    fail(`$.category.secondary: "${secondary}" is not under "${primary}". Choose one of: ${allowed}`)
  }
}

/**
 * The shape the client consumes: `{ <primary>: [<secondary slug>, ...] }`.
 *
 * Derived from the full tree rather than from the published cards, so a
 * category with no bundles yet still renders as a filter — an empty result
 * there says "nothing published here yet", which differs from a tab that
 * silently does not exist.
 */
export function categoryMap(tree) {
  return Object.fromEntries(tree.map((entry) => [entry.slug, entry.secondary.map((s) => s.slug)]))
}

/**
 * Bilingual names for every primary and secondary slug, keyed by slug.
 *
 * Flattened into one table because the client looks a slug up without knowing
 * whether it is a primary or a secondary — a chip and a tab label come from
 * the same lookup. The uniqueness gates in {@link readCategories} guarantee a
 * slug never appears twice in the tree, so there are no collisions to resolve:
 * every key here is the one label the reader sees.
 */
export function categoryLabels(tree) {
  // Null prototype: a slug such as `__proto__` (or any future non-`[a-z0-9-]`
  // value) would otherwise be assigned as the prototype instead of an own
  // property, silently losing that label.
  const labels = Object.create(null)
  for (const entry of tree) {
    labels[entry.slug] = { zh: entry.zh, en: entry.en }
    for (const second of entry.secondary) {
      labels[second.slug] = { zh: second.zh, en: second.en }
    }
  }
  return labels
}
