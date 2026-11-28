/**
 * Validate one submission file against G1–G12.
 *
 * Everything here is decidable from the file *plus a catalogue lookup*: no
 * network, no filesystem. Member facts (npm name, install spec, description)
 * come from the catalogue, so a submission carries only what a human knows
 * and nothing a machine already does.
 */

import { installSpecOf, lookupPlugin, parsePluginRef } from './catalogue.mjs'
import { assertCategory } from './categories.mjs'
import { LOCALIZED_TEXT_MAX } from './limits.mjs'

/** Where a contributor finds a plugin and what the gates enforce. */
const SITE_URL = 'https://awesome-dsh-plugin.com'

/** The member window. A one-member suite is not a suite; ten is the cost ceiling. */
const MIN_MEMBERS = 2
const MAX_MEMBERS = 10

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}$/
// A GitHub login: alphanumerics and single hyphens, not starting or ending with
// a hyphen. Deliberately as strict as the owner group in `parsePluginRef`, so
// the path check and the member check cannot disagree.
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/
const VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/
const TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,23}$/

/**
 * The keys a submission may carry, mirrored from
 * `schema/bundle.schema.json`'s `additionalProperties: false`.
 *
 * Duplicated here on purpose: the schema is the published contract, but nothing
 * EXECUTES a JSON Schema in this repository, and the two entry points that gate
 * a submission both call `validateSubmission` instead. Keeping the list only in
 * the schema meant a member could carry `npm: attacker-controlled`, pass
 * `catalog.mjs check` in CI, and be refused only by a human reviewer.
 */
const TOP_LEVEL_FIELDS = new Set([
  'id', 'owner', 'version', 'title', 'summary', 'description',
  'category', 'tags', 'cover', 'icon', 'postInstall', 'capabilityRedLines', 'members',
])

/**
 * The keys a member may carry. Everything else (`npm`, `version`, `stars`,
 * `repo`, …) is filled in from the plugin index at build time, so writing one by
 * hand either duplicates data the build owns or injects a value it would
 * otherwise derive.
 */
const MEMBER_FIELDS = new Set(['plugin', 'reason', 'requires'])


/**
 * The only hosts `icon`/`cover` may point at.
 *
 * GitHub serves a repository's files from raw.githubusercontent.com, and its
 * own `github.com/<owner>/<repo>/raw/...` and `/releases/download/...` URLs
 * redirect there. Restricting the host is what keeps the listing from making a
 * visitor fetch an image from a host this project cannot vouch for.
 */
const GITHUB_IMAGE_HOSTS = new Set(['github.com', 'raw.githubusercontent.com'])

/** A raster format the card can render in an `<img>`. */
const RASTER_IMAGE_PATH = /\.(?:png|jpe?g|webp)$/iu

export class GateError extends Error {
  constructor(gate, path, message) {
    super(`${gate} ${path}: ${message}`)
    this.gate = gate
    this.path = path
  }
}

/** Raise one gate failure. Exported for cross-document checks in the builder. */
export function fail(gate, path, message) {
  throw new GateError(gate, path, message)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireString(value, gate, path, { min = 1, max = 4096 } = {}) {
  if (typeof value !== 'string') fail(gate, path, 'expected a string')
  if (value.length < min) fail(gate, path, `shorter than ${String(min)} characters`)
  if (value.length > max) fail(gate, path, `longer than ${String(max)} characters`)
  return value
}

/**
 * A `{ zh, en }` pair. `en` is required; `zh` is optional and falls back to it.
 *
 * The fallback is applied here, once, so every consumer downstream can rely on
 * both keys being present: the client looks a locale up without knowing which
 * one the author wrote, and `build.mjs` reads `summary.zh` directly.
 *
 * @returns {{ zh: string, en: string }} the pair, with `zh` filled in.
 */
function requireLocalized(value, gate, path, max = LOCALIZED_TEXT_MAX) {
  if (!isObject(value)) fail(gate, path, 'expected { zh, en }')
  const extra = Object.keys(value).filter((key) => key !== 'zh' && key !== 'en')
  if (extra.length > 0) fail(gate, `${path}.${extra[0]}`, 'unexpected language')
  const en = requireString(value.en, gate, `${path}.en`, { max })
  // An explicit but empty `zh` is a mistake, not an omission: fall back only
  // when the key is absent.
  if (value.zh !== undefined) {
    return { zh: requireString(value.zh, gate, `${path}.zh`, { max }), en }
  }
  return { zh: en, en }
}

/**
 * The same pair, from an upstream index record: missing locales are dropped and
 * an object with none is absent rather than empty.
 *
 * @param {unknown} value - `entry.description` from the index.
 * @returns {{ zh?: string, en?: string } | undefined}
 */
function localizedOrUndefined(value) {
  if (!isObject(value)) return undefined
  const pair = {
    ...(typeof value.zh === 'string' ? { zh: value.zh } : {}),
    ...(typeof value.en === 'string' ? { en: value.en } : {}),
  }
  return Object.keys(pair).length === 0 ? undefined : pair
}

/**
 * Validate the whole document.
 *
 * @param {unknown} doc - parsed YAML.
 * @param {{ owner: string, id: string, version: string }} expected - what the
 *   PATH claims. Checked by G1 because the path is what a reviewer reads.
 * @param {{ byRepo: Map<string, object> }} catalogue - the upstream index.
 * @param {import('./categories.mjs').Category[]} categories - the category tree.
 * @returns {object} the normalized document, members resolved.
 */
export function validateSubmission(doc, expected, catalogue, categories) {
  if (!isObject(doc)) fail('G2', '$', 'expected a mapping')

  // Schema `additionalProperties: false`, ENFORCED here. The same set lives in
  // schema/bundle.schema.json, but that file documents the rule and nothing
  // executes it: the two entry points that gate a submission (catalog.mjs check
  // in CI, check-pr.mjs locally) both call this function instead. Without this
  // a member could carry `npm: attacker-controlled`, pass CI, and only be
  // refused by a human reviewer.
  for (const key of Object.keys(doc)) {
    if (TOP_LEVEL_FIELDS.has(key)) continue
    if (key === 'schema') {
      fail('G2', '$.schema', 'the "schema: 1" line was removed from the format - delete it; nothing else changes')
    }
    fail('G2', `$.${key}`, `unsupported field "${key}"; see schema/bundle.schema.json for the allowed set`)
  }

  // G1: identity fields must agree with the path.
  const id = requireString(doc.id, 'G1', '$.id', { max: 39 })
  if (!ID_PATTERN.test(id)) fail('G1', '$.id', 'must be lowercase letters, digits and dashes')
  if (id !== expected.id) fail('G1', '$.id', `must equal the directory name "${expected.id}"`)

  const owner = requireString(doc.owner, 'G1', '$.owner', { max: 39 })
  if (!OWNER_PATTERN.test(owner)) fail('G1', '$.owner', 'is not a GitHub login')
  if (owner !== expected.owner) fail('G1', '$.owner', `must equal the directory name "${expected.owner}"`)

  const version = requireString(doc.version, 'G1', '$.version', { max: 64 })
  if (!VERSION_PATTERN.test(version)) fail('G3', '$.version', 'must be a plain MAJOR.MINOR.PATCH')
  if (version !== expected.version) fail('G1', '$.version', `must equal the file name "${expected.version}.yml"`)

  const title = requireLocalized(doc.title, 'G2', '$.title')
  const summary = requireLocalized(doc.summary, 'G2', '$.summary')

  // Category is required; secondary is optional but, when present, must be one
  // of the choices under that primary. The tree comes from schema/categories.json
  // rather than a hard-coded list, so adding a category is a data change.
  if (doc.category !== undefined && !isObject(doc.category)) fail('G2', '$.category', 'expected a mapping')
  // `assertCategory` checks the VALUES (a known primary, a valid secondary),
  // not the SHAPE. Without this, `category: {primary: productivity, evil: true}`
  // passed `catalog.mjs check` — CI's only validator — while `check-pr.mjs`
  // and the schema both rejected it. The published contract allows only these
  // two keys, so reject anything else here where both entry points see it.
  if (isObject(doc.category)) {
    for (const key of Object.keys(doc.category)) {
      if (key === 'primary' || key === 'secondary') continue
      fail('G2', `$.category.${key}`,
        `unsupported category field "${key}"; only primary and secondary are allowed`)
    }
  }
  try {
    assertCategory(doc.category, categories)
  } catch (error) {
    // Only a gate failure describes the submission; anything else is a bug in
    // this tool and must not be reported to the contributor as a G7 problem.
    if (error?.gate === undefined) throw error
    const message = String(error.message ?? '').replace(/^\$\.category(?:\.\w+)?:\s*/u, '')
    fail(error.gate, '$.category', message)
  }
  const primary = doc.category.primary
  const secondary = doc.category.secondary

  let tags = []
  if (doc.tags !== undefined) {
    if (!Array.isArray(doc.tags)) fail('G2', '$.tags', 'expected a list')
    if (doc.tags.length > 8) fail('G2', '$.tags', 'at most 8 tags')
    tags = doc.tags.map((tag, index) => {
      const value = requireString(tag, 'G2', `$.tags[${String(index)}]`, { max: 24 })
      if (!TAG_PATTERN.test(value)) fail('G2', `$.tags[${String(index)}]`, 'lowercase letters, digits and dashes')
      return value
    })
    if (new Set(tags).size !== tags.length) fail('G2', '$.tags', 'duplicate tag')
  }

  // Both image fields share one rule, so it lives in one place: an http URL, a
  // bare host, or `https://?x` all render as a broken image on the card, and a
  // second copy of this check would eventually disagree with the first.
  //
  // The host is restricted to GitHub's own image hosts on purpose: a listing
  // must not make a visitor's client fetch an image from a host this project
  // cannot vouch for (tracking pixels, dead domains, content that changes after
  // review). A raster extension is required as well, because the card cannot
  // render an SVG or an HTML page in an <img>.
  const githubBitmap = (value, gate, field, max) => {
    const text = requireString(value, gate, field, { max })
    let url
    try {
      url = new URL(text)
    } catch {
      fail(gate, field, 'must be an absolute https URL')
    }
    if (url.protocol !== 'https:' || url.hostname === '') {
      fail(gate, field, 'must be an https URL on a GitHub host')
    }
    if (!GITHUB_IMAGE_HOSTS.has(url.hostname.toLowerCase())) {
      fail(gate, field, `must be hosted on GitHub (github.com or raw.githubusercontent.com), not "${url.hostname}"`)
    }
    if (!RASTER_IMAGE_PATH.test(url.pathname)) {
      fail(gate, field, 'must point at a raster image (png, jpg, jpeg or webp) — SVG and other formats are not accepted')
    }
    return text
  }

  let cover = null
  if (doc.cover !== undefined && doc.cover !== null) {
    cover = githubBitmap(doc.cover, 'G11', '$.cover', 2048)
  }

  // Optional, and deliberately SEPARATE from `cover`: the icon is a small square
  // with an avatar fallback, while `cover` is a wide banner that has no such
  // fallback. Folding them together would put an author's avatar on a hero image.
  let icon = null
  if (doc.icon !== undefined && doc.icon !== null) {
    icon = githubBitmap(doc.icon, 'G11', '$.icon', 2048)
  }

  const description = doc.description === undefined ? undefined : requireLocalized(doc.description, 'G2', '$.description')
  const postInstall = doc.postInstall === undefined ? undefined : requireLocalized(doc.postInstall, 'G2', '$.postInstall')

  // G4/G5/G6: members, resolved through the catalogue.
  if (!Array.isArray(doc.members)) fail('G2', '$.members', 'expected a list')
  if (doc.members.length < MIN_MEMBERS) fail('G4', '$.members', `at least ${String(MIN_MEMBERS)} members`)
  if (doc.members.length > MAX_MEMBERS) {
    fail('G4', '$.members', `at most ${String(MAX_MEMBERS)} members, got ${String(doc.members.length)}`)
  }

  const seen = new Set()
  const members = doc.members.map((member, index) => {
    const path = `$.members[${String(index)}]`
    if (!isObject(member)) fail('G2', path, 'expected a mapping')

    // Schema `additionalProperties: false` for members. `npm`, `version`,
    // `stars` and the rest are filled in from the plugin index at build time,
    // so writing one by hand either duplicates data the build owns or injects a
    // value it would otherwise derive — and before this, no gate looked.
    for (const key of Object.keys(member)) {
      if (MEMBER_FIELDS.has(key)) continue
      fail('G2', `${path}.${key}`,
        `unsupported member field "${key}"; allowed fields are plugin, reason and requires `
        + '(npm/version/stars/repo are filled in automatically - do not write them)')
    }

    // The one required field. Everything else about a member is looked up.
    if (member.plugin === undefined) {
      fail('G2', path, `needs \`plugin: owner/name\` (find it at ${SITE_URL})`)
    }
    const ref = parsePluginRef(member.plugin)
    if (ref === undefined) fail('G5', `${path}.plugin`, 'expected a GitHub repository as owner/name')

    if (seen.has(ref.key)) fail('G4', `${path}.plugin`, `duplicate member "${ref.key}"`)
    seen.add(ref.key)

    // G6: the member must exist in the index. Not in it means the plugin is
    // not curated, installable and versioned by anyone — a suite that lists it
    // would install something nobody has verified. A casing difference is not
    // a different repository, so the lookup folds case.
    const entry = lookupPlugin(catalogue, ref)
    if (entry === undefined) {
      fail('G6', `${path}.plugin`, `"${ref.key}" is not in the plugin index — search it at ${SITE_URL}. Only indexed plugins can be a member.`)
    }

    let reason
    if (member.reason !== undefined) {
      reason = requireLocalized(member.reason, 'G2', `${path}.reason`)
    }

    // G4: `requires` names a member by its repository pair. Stored as the
    // canonical key, because the emitted document's contract says `requires`
    // refers to a member `key` — a raw URL here would break any consumer that
    // does not re-parse it.
    let requires
    if (member.requires !== undefined) {
      if (!Array.isArray(member.requires)) fail('G4', `${path}.requires`, 'expected a list')
      requires = member.requires.map((other, at) => {
        const value = requireString(other, 'G4', `${path}.requires[${String(at)}]`, { max: 100 })
        return parsePluginRef(value)?.key ?? value
      })
      // A dependency listed twice is a typo that inflates the edge count and
      // makes the acyclic check walk the same node twice. `check-pr.mjs`
      // rejected it; CI's `catalog.mjs check` did not. Same rule, one source.
      if (new Set(requires).size !== requires.length) {
        fail('G4', `${path}.requires`, 'duplicate entries in requires')
      }
    }

    const install = installSpecOf(entry)
    // The submission carried ONE value per member — `plugin: owner/name`. Every
    // field below is mapped from the curated index at build time; none of it is
    // authored, and none of it is stored in the repository. `key` is the stable
    // identifier (also what `requires` and the sheet's rows refer to), and
    // `repo` is the link the sheet renders — one field, one meaning.
    return {
      key: ref.key,
      name: typeof entry.name === 'string' ? entry.name : ref.name,
      repo: typeof entry.url === 'string' && entry.url !== ''
        ? entry.url
        : `https://github.com/${ref.key}`,
      npm: install.npm,
      version: install.version,
      spec: install.spec,
      floating: install.floating,
      category: typeof entry.category === 'string' ? entry.category : undefined,
      // Absent unless at least one locale is present: `description: {}` reads as
      // "has a description" to every consumer and renders an empty block.
      description: localizedOrUndefined(entry.description),
      stars: typeof entry.stars === 'number' ? entry.stars : undefined,
      // Present only when the registry could be asked and the package declares
      // one. A missing value means "unknown", never "no requirement".
      engines: catalogue.engines?.get(install.npm ?? '') ?? undefined,
      downloads: typeof entry.downloads === 'number' ? entry.downloads : undefined,
      capabilities: Array.isArray(entry.capabilities) ? entry.capabilities : [],
      capabilityRedLines: Array.isArray(entry.capabilityRedLines) ? entry.capabilityRedLines : [],
      ...(reason === undefined ? {} : { reason }),
      ...(requires === undefined ? {} : { requires }),
    }
  })

  // `requires` names a member by its repository pair.
  for (const [index, member] of members.entries()) {
    for (const other of member.requires ?? []) {
      const ref = parsePluginRef(other)
      const key = ref?.key ?? other
      if (!seen.has(key)) {
        fail('G4', `$.members[${String(index)}].requires`, `references unknown member "${other}" (use its owner/name)`)
      }
    }
  }
  assertAcyclic(members)

  let capabilityRedLines
  if (doc.capabilityRedLines !== undefined) {
    if (!Array.isArray(doc.capabilityRedLines)) fail('G2', '$.capabilityRedLines', 'expected a list')
    capabilityRedLines = doc.capabilityRedLines.map((line, index) => {
      const path = `$.capabilityRedLines[${String(index)}]`
      if (!isObject(line)) fail('G2', path, 'expected a mapping')
      // The schema allows only `text` and `members` on a red line. Without
      // this, an item with an extra key passed CI's `catalog.mjs check` and
      // was refused only by the local checker / schema contract.
      for (const key of Object.keys(line)) {
        if (key === 'text' || key === 'members') continue
        fail('G2', `${path}.${key}`,
          `unsupported red-line field "${key}"; only text and members are allowed`)
      }
      const text = requireLocalized(line.text, 'G2', `${path}.text`)
      let named
      if (line.members !== undefined) {
        if (!Array.isArray(line.members)) fail('G2', `${path}.members`, 'expected a list')
        named = line.members.map((value, at) => {
          const ref = parsePluginRef(value)
          const key = ref?.key ?? String(value)
          if (!seen.has(key)) fail('G4', `${path}.members[${String(at)}]`, `unknown member "${String(value)}"`)
          return key
        })
        // The schema declares `uniqueItems: true`, and nothing enforced it:
        // the same member twice survived both catalog.mjs check and check-pr.
        if (new Set(named).size !== named.length) {
          fail('G4', `${path}.members`, 'duplicate entries in a red line')
        }
      }
      return { text, ...(named === undefined ? {} : { members: named }) }
    })
  }

  return {
    id,
    owner,
    version,
    title,
    summary,
    ...(description === undefined ? {} : { description }),
    category: { primary, ...(secondary === undefined ? {} : { secondary }) },
    tags,
    cover,
    icon,
    ...(postInstall === undefined ? {} : { postInstall }),
    ...(capabilityRedLines === undefined ? {} : { capabilityRedLines }),
    members,
  }
}


function assertAcyclic(members) {
  const byKey = new Map(members.map((member) => [member.key, member]))
  const state = new Map()

  const visit = (key, trail) => {
    if (state.get(key) === 'done') return
    if (state.get(key) === 'visiting') {
      fail('G4', '$.members', `dependency cycle: ${[...trail, key].join(' -> ')}`)
    }
    state.set(key, 'visiting')
    const member = byKey.get(key)
    for (const next of member?.requires ?? []) {
      const ref = parsePluginRef(next)
      visit(ref?.key ?? next, [...trail, key])
    }
    state.set(key, 'done')
  }

  for (const member of members) visit(member.key, [])
}

/**
 * Split `suites/<owner>/<suite_id>/<version>.yml` into its parts.
 *
 * The VERSION in the file name is checked here as well as in the document, and
 * both must be a plain `MAJOR.MINOR.PATCH`. The file name is what a contributor
 * actually types, so a rejection has to point at it: `1.0.yml` used to pass this
 * function and fail later as "the document disagrees with the file name", which
 * reads as a contradiction rather than "your version is missing its patch".
 *
 * @throws {GateError} when the path is not the shape the repository requires.
 */
export function parseSubmissionPath(relativePath) {
  const parts = relativePath.replace(/\\/gu, '/').split('/')
  if (parts.length !== 4 || parts[0] !== 'suites') {
    fail('G1', relativePath, 'expected suites/<owner>/<suite_id>/<version>.yml')
  }
  const [, owner, id, file] = parts
  if (!file.endsWith('.yml')) fail('G1', relativePath, 'must end in .yml')
  const version = file.slice(0, -4)
  // Named `version` in the message, not "file name": the remedy is to rename
  // the file AND its `version:` line, and a contributor sees both in one place.
  if (!VERSION_PATTERN.test(version)) {
    fail('G1', relativePath, `file name must be <major>.<minor>.<patch>.yml, not "${file}"`)
  }
  return { owner, id, version }
}

/**
 * Compare this version against the bundle's history (G3).
 *
 * @throws {GateError} when the version is not newer than the newest existing one.
 */
export function assertVersionAdvances(version, history) {
  // Validate the argument too: a caller that skipped `validateSubmission` (the
  // PR checker, the builder) would otherwise get no G3 protection at all, and a
  // non-semver history entry became `NaN`, which `sort` treats as 0 and which
  // makes the monotonic comparison silently false.
  if (!VERSION_PATTERN.test(version)) fail('G3', '$.version', 'must be a plain MAJOR.MINOR.PATCH')
  if (history.includes(version)) {
    fail('G3', '$.version', `version ${version} already exists in this bundle's history`)
  }
  const newest = history
    .filter((entry) => VERSION_PATTERN.test(entry))
    .map((entry) => ({ entry, order: parseOrder(entry) }))
    .sort((left, right) => compareOrder(left.order, right.order))
    .at(-1)
  if (newest === undefined) return
  if (compareOrder(parseOrder(version), newest.order) <= 0) {
    fail('G3', '$.version', `must be greater than the existing ${newest.entry}`)
  }
}

/** `1.2.3` → `[1, 2, 3]`. Only called on a value that matched `VERSION_PATTERN`. */
function parseOrder(version) {
  return version.split('.').map(Number)
}

/**
 * Compare two parsed versions. Exported so the builder sorts its per-bundle
 * history with the same rule the G3 gate uses instead of a second copy.
 *
 * @param {number[]} left - e.g. `[1, 2, 3]`.
 * @param {number[]} right - e.g. `[1, 3, 0]`.
 * @returns {number} negative when `left` is older.
 */
export function compareOrder(left, right) {
  for (const at of [0, 1, 2]) {
    const difference = (left[at] ?? 0) - (right[at] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}
