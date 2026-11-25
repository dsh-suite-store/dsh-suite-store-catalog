/**
 * Build the published catalog from `suites/**\/*.yml`.
 *
 * The client never reads YAML. It reads exactly the shape `parseCatalogIndex`
 * and `parseBundleDetail` already accept, so this file is the only place the
 * two formats meet: submissions are YAML (what a human writes in a PR), the
 * artifact is JSON (what a client downloads).
 *
 * Member facts come from the upstream plugin index, looked up once per build
 * and resolved during validation. Nothing about a member is copied into the
 * submission, which is what keeps a submission two lines per member and what
 * keeps its facts from going stale: the next build reads today's index.
 */

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

import { parse as parseYaml } from 'yaml'

import { buildCatalogue, parsePluginRef } from './catalogue.mjs'
import { categoryLabels, categoryMap, readCategories } from './categories.mjs'
import { explainYamlError } from './yaml-error.mjs'
import {
  assertVersionAdvances,
  compareOrder,
  fail,
  parseSubmissionPath,
  validateSubmission,
} from './validate.mjs'

/** Where submissions live. */
export const SUITES_DIR = 'suites'
/** The artifact every client downloads — the only one. */
export const INDEX_FILE = 'dist/index.json'

/** Submit order: byte-wise, not locale-dependent. */
const byCodeUnit = (left, right) => (left < right ? -1 : left > right ? 1 : 0)

/**
 * Read every submission under `suites/`.
 *
 * @param {string} root - repository root.
 * @param {{ byRepo: Map<string, object> }} catalogue - the upstream index.
 * @param {import('./categories.mjs').Category[]} categories - the category tree.
 * @param {{ only?: string, added?: ReadonlySet<string> }} [options] - `only`
 *   checks one repository-relative file; `added` names the files this change
 *   ADDS, which must each advance past their bundle's history. A release build
 *   passes neither: every file is simply present.
 * @returns {Promise<Map<string, Array<object>>>} one array per `<owner>/<id>`,
 *   oldest version first.
 */
export async function readSubmissions(root, catalogue, categories, options = {}) {
  const base = join(root, SUITES_DIR)
  /** @type {Map<string, Array<object>>} */
  const byBundle = new Map()
  // A single-path check must not fail because an UNRELATED submission is
  // broken: CI runs `check <changed file>` on a PR, and the author cannot fix
  // someone else's file. The full walk is still the default, because a release
  // must not publish over a broken sibling.
  const only = options.only === undefined ? undefined : options.only.replace(/\\/gu, '/')

  const paths = (await walk(base)).filter((path) => path.endsWith('.yml'))
    .map((path) => ({ path, relativePath: relative(root, path).split(sep).join('/') }))
  const wanted = only === undefined ? paths : paths.filter((item) => item.relativePath === only)
  if (only !== undefined && wanted.length === 0) {
    // A misspelled, absolute or differently-cased path used to match nothing and
    // report success without running a single gate.
    fail('G1', only, `no such submission under ${SUITES_DIR}/ (is the path repository-relative?)`)
  }

  // Independent files: read them together instead of serializing the disk.
  const texts = await Promise.all(wanted.map((item) => readFile(item.path, 'utf8')))
  for (const [at, item] of wanted.entries()) {
    const expected = parseSubmissionPath(item.relativePath)
    let raw
    try {
      raw = parseYaml(texts[at])
    } catch (error) {
      // Bilingual, located, and with the remedy: a parse error is the first
      // thing a contributor hits and the one message they must be able to act
      // on without opening the YAML spec.
      throw new Error(explainYamlError(error, item.relativePath))
    }
    const doc = validateSubmission(raw, expected, catalogue, categories)
    const key = `${doc.owner}/${doc.id}`
    const list = byBundle.get(key) ?? []
    list.push({ version: doc.version, path: item.relativePath, doc, owner: doc.owner, id: doc.id })
    byBundle.set(key, list)
  }

  // The cross-file invariants below need the rest of the tree, which a
  // single-file run does not validate: G3 must see the real history and G13 the
  // real member sets, or `check <one file>` passes what the release build
  // rejects. Siblings are read leniently — a broken sibling is its own problem.
  const rest = only === undefined ? [] : await readSiblings(paths, only)
  const history = new Map()
  for (const item of rest) {
    const list = history.get(item.key) ?? []
    list.push(item)
    history.set(item.key, list)
  }
  // Repository-relative paths this run knows to be NEW (added by the change
  // under test). Empty for a release build, where every file is simply present.
  const added = options.added ?? new Set()

  for (const [key, versions] of byBundle) {
    const ordered = [...versions].sort((left, right) => compareOrder(parseOrder(left.version), parseOrder(right.version)))
    const newest = ordered.at(-1)
    // A bundle's newest version has to advance past its history. This is the
    // release rule: the published card is the newest file, so that one must be
    // newer than everything already recorded.
    //
    // It is NOT enough on its own for a NEW file. Adding `0.9.0` beside an
    // existing `1.0.0` left the sort with `1.0.0` last, `1.0.0` advanced over
    // `0.9.0`, and the `0.9.0` file — the thing being submitted — was never
    // asked to advance at all. The loop below is what closes that: an ADDED
    // file must beat every other version of its bundle, wherever it sorts.
    for (const entry of ordered) {
      if (!added.has(entry.path)) continue
      const others = [...(history.get(key) ?? []), ...ordered.filter((other) => other.path !== entry.path)]
      assertVersionAdvances(entry.version, others.map((other) => other.version))
    }
    // Only an existing bundle's NEWEST version has to advance; an older file
    // passed explicitly (or by `--all`) is history, not a new release. The
    // history must include siblings even when they were not validated.
    const prior = [...(history.get(key) ?? []), ...ordered.slice(0, -1)]
      .filter((entry) => entry.path !== newest.path)
    assertVersionAdvances(newest.version, prior.map((entry) => entry.version))
    byBundle.set(key, ordered)
  }
  assertUniqueCompositions(byBundle, rest)
  // Bundle IDs must be unique across the whole catalog, not just within an
  // owner. The plugin rejects a document that repeats an id ("bundle id X
  // appears more than once") because every per-id route and every provenance
  // claim is keyed on it — so a collision is not a duplicate listing, it is a
  // document the client refuses to load.
  //
  // This check used to live only in `buildCatalog`, which `check` never calls:
  // a PR adding `alice/same-id` and `bob/same-id` went green, merged, and then
  // broke the release build — and with it every user's store. Enforcing it here
  // puts it on the path the PR actually runs.
  const ids = new Map()
  // A single-file check only validated one file, so its siblings come from
  // `rest`; without them the collision is invisible until the release build.
  for (const sibling of rest) {
    if (!ids.has(sibling.key.split('/')[1])) ids.set(sibling.key.split('/')[1], sibling.key.split('/')[0])
  }
  for (const versions of byBundle.values()) {
    const newest = versions.at(-1)
    const prior = ids.get(newest.id)
    if (prior !== undefined && prior !== newest.owner) {
      fail('G1', '$.id',
        `"${newest.owner}/${newest.id}" and "${prior}/${newest.id}" share an id; rename one bundle id`)
    }
    ids.set(newest.id, newest.owner)
  }
  return byBundle
}

/**
 * Path, version and member keys of every submission a single-file run skipped.
 *
 * @param {Array<{ path: string, relativePath: string }>} paths - the walk.
 * @param {string} only - the one file being validated.
 * @returns {Promise<Array<{ key: string, version: string, path: string, members?: string[] }>>}
 */
async function readSiblings(paths, only) {
  const found = []
  for (const item of paths) {
    if (item.relativePath === only) continue
    try {
      const expected = parseSubmissionPath(item.relativePath)
      const doc = parseYaml(await readFile(item.path, 'utf8'))
      found.push({
        key: `${expected.owner}/${expected.id}`,
        version: expected.version,
        path: item.relativePath,
        members: Array.isArray(doc?.members)
          ? doc.members.map((member) => parsePluginRef(member?.plugin)?.key).filter((key) => key !== undefined)
          : undefined,
      })
    } catch {
      // Unreadable or badly shaped: the full build reports it. Skipping keeps a
      // one-file check from blaming this run for someone else's file.
    }
  }
  return found
}

/**
 * G13: two bundles may not ship the same member set.
 *
 * A suite exists to say something a single plugin list cannot — a scenario, a
 * curation opinion. Two bundles whose members resolve to exactly the same set
 * say nothing distinct; the second one only fragments the reader's search
 * results and doubles the install traffic for identical content. Membership is
 * compared as the resolved KEY set (not YAML text), so reordering, comments and
 * `requires` edges do not fake a difference, while any real difference in
 * composition passes.
 *
 * Checked across the whole tree, not per file: the collision is between two
 * submissions, so a one-file check cannot see it — and a release build must
 * refuse to publish the duplicate even when only one of the pair changed.
 *
 * @param {Map<string, Array<object>>} byBundle - validated bundles.
 * @param {Array<{ key: string, version: string, path: string, members?: string[] }>} [rest]
 *   - siblings from a single-file run, so the pairwise check still sees them.
 */
function assertUniqueCompositions(byBundle, rest = []) {
  /** @type {Map<string, {owner: string, id: string, path: string}>} */
  const seen = new Map()
  const fingerprintOf = (keys) => [...keys].sort().join('\n')

  // Siblings first, so the error names the file the author did not touch as the
  // prior bundle and the changed one as the duplicate.
  const restNewest = new Map()
  for (const item of rest) {
    if (item.members === undefined) continue
    const prior = restNewest.get(item.key)
    if (prior === undefined || compareOrder(parseOrder(item.version), parseOrder(prior.version)) > 0) {
      restNewest.set(item.key, item)
    }
  }
  for (const [key, item] of restNewest) {
    const [owner, id] = key.split('/')
    seen.set(fingerprintOf(item.members), { owner, id, path: item.path })
  }

  for (const [key, versions] of byBundle) {
    const newest = versions.at(-1)
    const fingerprint = fingerprintOf(newest.doc.members.map((member) => member.key))
    const prior = seen.get(fingerprint)
    if (prior !== undefined) {
      fail('G13', '$.members', `"${newest.owner}/${newest.id}" (${newest.path}) has exactly the same member set as "${prior.owner}/${prior.id}" (${prior.path}). A bundle must curate — change at least one member, or submit your additions to the existing suite instead.`)
    }
    seen.set(fingerprint, { owner: newest.owner, id: newest.id, path: newest.path })
  }
}

/** `1.2.3` → `[1, 2, 3]`, for {@link compareOrder}. */
function parseOrder(version) {
  return version.split('.').map(Number)
}

async function walk(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    // Only a missing `suites/` means "nothing submitted". A permissions or IO
    // failure used to read the same way, and an empty catalog was then
    // published as a valid release.
    if (error?.code === 'ENOENT') return []
    throw new Error(`cannot read ${directory}: ${error?.code ?? 'error'} (${error instanceof Error ? error.message : String(error)})`)
  }
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    // Only descend into REAL directories and collect REAL files. A symlink is
    // neither: a PR tarball may contain one pointing outside the workspace
    // (`/dev/zero`, a runner path), and readFile() would happily follow it.
    // `Dirent.isDirectory()`/`isFile()` are lstat-based and do not follow.
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) files.push(...(await walk(path)))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

/**
 * Turn one resolved submission into the card and detail the client expects.
 *
 * Every member field here was filled by `validateSubmission` from the index,
 * so this function does no lookups of its own — it shapes, it does not decide.
 *
 * @param {{ doc: object, path: string }} submission - the newest version.
 * @param {object} derived - build-level facts (dates, hotness).
 * @returns {{ card: object, detail: object }}
 */
export function renderBundle(submission, derived) {
  const { doc } = submission

  const capabilitySummary = [...new Set(doc.members.flatMap((member) => member.capabilities))].sort()
  const capabilities = groupCapabilities(doc.members)
  // A member whose index record flags a red line needs a build approval in
  // practice: the same field is what the marketplace shows as "needs review".
  const needsBuildApproval = doc.members.some((member) => member.capabilityRedLines.length > 0)

  const members = doc.members.map((member) => ({
    key: member.key,
    // A git member's identity is `owner/name`, the same pair the host reports
    // back. Using `repo` here put the full https URL inside the id, which
    // `memberSpecId()` then stripped to a URL and the failure row printed
    // verbatim.
    id: member.npm === null ? `git:${member.key}` : `npm:${member.npm}`,
    name: member.name,
    spec: member.spec,
    ...(member.version === null ? {} : { version: member.version }),
    ...(member.npm === null ? {} : { npm: member.npm }),
    repo: member.repo,
    ...(member.stars === undefined ? {} : { stars: member.stars }),
    ...(member.reason === undefined ? {} : { reason: member.reason }),
    ...(member.description === undefined ? {} : { description: member.description }),
    // The declared dsh range, when the registry knew it. The sheet shows it so
    // a reader can spot an incompatible member before starting a run that would
    // otherwise fail on it (the host refuses these mid-install).
    ...(member.engines === undefined ? {} : { engines: { dsh: member.engines } }),
    // `floating` is the one property a client cannot infer from the spec: a
    // git spec has no version to pin, so its content can change under the same
    // install command. The card says "latest" when this is true.
    ...(member.floating ? { floating: true } : {}),
  }))

  const card = {
    id: doc.id,
    owner: doc.owner,
    version: doc.version,
    title: doc.title,
    summary: doc.summary,
    category: doc.category,
    tags: doc.tags ?? [],
    cover: doc.cover ?? null,
    // Resolved at BUILD time, not in the browser: which image a card shows is a
    // fact about the submission, and a client that had to guess would need to
    // know the avatar endpoint and the first-party owner. `null` means "no
    // image at all" and the card falls back to its member mosaic.
    icon: resolveIcon(doc),
    publishedAt: derived.addedAt.get(`${doc.owner}/${doc.id}`) ?? derived.now,
    updatedAt: derived.updatedAt.get(submission.path) ?? derived.now,
    memberCount: doc.members.length,
    capabilitySummary,
    needsBuildApproval,
    members,
    health: { status: 'ok', checkedAt: derived.now, missing: [], deprecated: [] },
    score: {
      hotness: weightedHotness(doc.members),
      freshnessDays: 0,
      coverage: coverageOf(doc.members),
    },
    // ── what used to live only in a per-bundle detail document ─────────────
    // The catalog is ONE published file, like awesome-dsh-plugin's data
    // package. A second tier of documents meant 103 more files in the tarball,
    // and 59% of their bytes were a copy of fields the card already carried
    // (`members` verbatim, `readme` equal to `summary` in all 103 cases).
    //
    // `readme` stays a separate field rather than being folded into `summary`:
    // a submission may declare a longer `description`, and the sheet renders
    // that as body text where the card shows a three-line summary.
    readme: doc.description ?? { zh: doc.summary.zh, en: doc.summary.en },
    // tag → member keys. The card's `capabilitySummary` is only the union of
    // tags; this says WHICH members a permission comes from, which is what the
    // sheet's permission rows are for.
    capabilities,
    ...(doc.postInstall === undefined ? {} : { postInstall: doc.postInstall }),
    ...(doc.capabilityRedLines === undefined ? {} : { capabilityRedLines: doc.capabilityRedLines }),
  }

  return { card }
}

/**
 * The owner whose submissions use the plugin's own default icon.
 *
 * Named here rather than inlined because it is the one owner that is not a
 * person: falling back to `github.com/dsh-suite-store.png` would show whatever
 * that account happens to have, which is not the store's mark.
 */
export const FIRST_PARTY_OWNER = 'dsh-suite-store'

/**
 * The icon a card should show, resolved from the submission.
 *
 * Three cases, in order:
 *  1. the submission names an `icon` → use it;
 *  2. the owner is the first-party one → `null`, meaning "the plugin's own
 *     default", which the client draws from its bundled asset. Emitting a URL
 *     here would point at a random account's avatar;
 *  3. anyone else → their GitHub avatars endpoint.
 *
 * `github.com/<login>.png` is GitHub's documented redirect to the current
 * avatar: no API call, no token, no rate limit, and it follows a changed
 * avatar automatically. A lookup through the API would need a token and would
 * freeze the URL on the day of the build.
 *
 * @param {{ icon?: string | null, owner: string }} doc - a validated submission.
 * @returns {string | null} an https URL, or null for "no image".
 */
export function resolveIcon(doc) {
  if (typeof doc.icon === 'string' && doc.icon !== '') return doc.icon
  // Case-insensitive: GitHub logins are, and `DSH-Suite-Store` is the same
  // account. A case difference must not send the reader to a stranger's avatar.
  if (doc.owner.toLowerCase() === FIRST_PARTY_OWNER) return null
  return `https://github.com/${encodeURIComponent(doc.owner)}.png?size=180`
}

/**
 * The bundle's hotness: the mean of its members' index scores.
 *
 * A mean rather than a sum so a ten-member suite is not automatically hotter
 * than a three-member one; §5.6's rule, applied to the numbers the index
 * actually carries. `null` when no member has a score — "no data" must not
 * read as "unpopular".
 */
function weightedHotness(members) {
  const scored = members.filter((member) => typeof member.downloads === 'number')
  if (scored.length === 0) return null
  const total = scored.reduce((sum, member) => sum + Math.log1p(member.downloads), 0)
  return Number((total / scored.length).toFixed(3))
}

/** The share of members that carry a popularity signal. */
function coverageOf(members) {
  if (members.length === 0) return 0
  const scored = members.filter((member) => typeof member.downloads === 'number')
  return Number((scored.length / members.length).toFixed(2))
}

/**
 * Group member capability tags into the sheet's `{tag, sources}` blocks.
 *
 * `sources` carries the member KEY, not its display name: the sheet looks the
 * key up in the member table, and a renamed plugin would otherwise leave a
 * tooltip pointing at a name no row shows.
 */
function groupCapabilities(members) {
  const byTag = new Map()
  for (const member of members) {
    for (const tag of member.capabilities) {
      const keys = byTag.get(tag) ?? []
      keys.push(member.key)
      byTag.set(tag, keys)
    }
  }
  return [...byTag.entries()]
    .sort(([left], [right]) => byCodeUnit(left, right))
    .map(([tag, sources]) => ({ tag, sources: [...new Set(sources)].sort(byCodeUnit) }))
}

/**
 * Assemble the whole catalog.
 *
 * @param {Map<string, Array<object>>} byBundle - output of {@link readSubmissions}.
 * @param {object} derived - build-level facts.
 * @param {import('./categories.mjs').Category[]} categories - the full tree.
 * @returns {{ index: object, details: Map<string, object> }}
 */
export function buildCatalog(byBundle, derived, categories) {
  const cards = []
  for (const versions of [...byBundle.values()]) {
    const newest = versions.at(-1)
    const { card } = renderBundle(newest, derived)
    cards.push(card)
  }
  // Deterministic output: a rebuild that changes nothing must produce a
  // byte-identical file, or every run looks like a change in review. Byte-wise,
  // not localeCompare: that one orders by the runtime's locale and ICU data.
  cards.sort((left, right) => byCodeUnit(left.id, right.id))

  // Two ids that flatten to the same `owner__id` used to collide on a detail
  // filename. There is no filename any more, but the collision itself is still
  // real — two cards would claim the same identity — so the check stays and now
  // compares the id directly.
  const claimed = new Map()
  for (const card of cards) {
    const key = `${card.owner}/${card.id}`
    const prior = claimed.get(card.id)
    if (prior !== undefined && prior !== card.owner) {
      fail('G1', '$.id', `"${key}" and "${prior}/${card.id}" share an id; rename one bundle id`)
    }
    claimed.set(card.id, card.owner)
  }

  const index = {
    format: 1,
    generatedAt: derived.now,
    catalogRef: { updated: derived.now.slice(0, 10), count: cards.length },
    // The FULL tree, not one inferred from published cards: an empty category
    // still renders as a filter saying "nothing here yet", which is different
    // from a tab that silently does not exist.
    categories: categoryMap(categories),
    // Both languages for every slug, so the page never has to invent a name.
    categoryLabels: categoryLabels(categories),
    bundles: cards,
  }
  return { index }
}

/**
 * Write the artifact tree, removing stale files first.
 *
 * ONE file. This used to emit `dist/index.json` plus `dist/suites/*.json`, and
 * the per-bundle documents were mostly a copy of their card: `members` was
 * byte-identical, and `readme` equalled `summary` in all 103 submissions. The
 * only thing they alone carried — the tag→member attribution in `capabilities`
 * — now rides on the card, so the published package is a single JSON document
 * like awesome-dsh-plugin's data package.
 */
export async function writeCatalog(root, { index }) {
  const dist = join(root, dirname(INDEX_FILE))
  await rm(dist, { recursive: true, force: true })
  await mkdir(dist, { recursive: true })
  await writeFile(join(root, INDEX_FILE), `${JSON.stringify(index, null, 2)}\n`, 'utf8')
  return { cards: index.bundles.length }
}

/** An empty `derived` bag, for a build that has no git history yet. */
export function emptyDerived(now) {
  return { now, addedAt: new Map(), updatedAt: new Map() }
}

export { buildCatalogue }
