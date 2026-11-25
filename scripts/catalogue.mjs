/**
 * The member catalogue: one lookup over the awesome-dsh-plugin index.
 *
 * A submission names a member by its repository (`owner/name`), never by npm
 * package, install spec, version or description. All of that already exists
 * upstream, and asking a contributor to repeat it is asking them to be wrong
 * about data a machine already knows.
 *
 * `owner/name` rather than `name` alone: 977 repository names in the index are
 * used by more than one owner (603 groups), and two of those resolve to
 * DIFFERENT npm packages — `MichengAI/dsh-pua` is `@michengai/dsh-pua` while
 * `panando/dsh-pua` is `@panando/dsh-pua`. The bare name is not a key.
 */

/**
 * Normalize a `owner/name` reference.
 *
 * Accepts what a contributor actually pastes: a bare pair, the GitHub URL, or
 * the URL with a trailing slash. Rejecting a full URL because it is "not the
 * expected form" would be a gate that punishes correctness.
 *
 * The `name` may carry a monorepo subpath (`owner/repo#packages/sub`). The
 * upstream index stores those as literal `owner` + `name` values too — e.g.
 * `tt-a1i` / `archify#integrations/deepseek-harness` — so they ARE exact
 * `owner/name` keys and must round-trip through this parser. G6 still decides
 * whether a reference is actually indexed; this function only normalizes its
 * shape. Without the `#` branch, 1,187 indexed plugins become unusable.
 *
 * @param {unknown} value - the raw member reference.
 * @returns {{ key: string, owner: string, name: string } | undefined} the
 *   normalized pair, or undefined when it is not a repository reference.
 */
export function parsePluginRef(value) {
  if (typeof value !== 'string') return undefined
  // Order matters: trailing slashes go before `.git`, or `…/repo.git/` keeps
  // the suffix and becomes the key `owner/repo.git`. The `/tree/<branch>` strip
  // makes the subpath optional so `…/repo/tree/main` still names the repo.
  const raw = value.trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//iu, '')
    .replace(/^git@github\.com:/iu, '')
    .replace(/\/+$/u, '')
    .replace(/\/tree\/[^/]+(?:\/.*)?$/u, '')
    .replace(/\.git$/iu, '')
    .replace(/\/+$/u, '')
  const match = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100}(?:#[A-Za-z0-9._/-]+)?)$/u.exec(raw)
  if (match === null) return undefined
  const [, owner, name] = match
  return { key: `${owner}/${name}`, owner, name }
}

/**
 * Build the catalogue from the upstream index.
 *
 * @param {unknown} index - parsed `plugins.json`.
 * @returns {{ byRepo: Map<string, object>, byNpm: Map<string, object>, count: number }}
 */
export function buildCatalogue(index) {
  const raw = index?.plugins ?? index
  // A partial or errored payload (`{"plugins": {}}`) must not turn into a
  // TypeError inside a `for…of`; an empty list is the honest reading.
  const plugins = Array.isArray(raw) ? raw : []
  /** @type {Map<string, object>} */
  const byRepo = new Map()
  /** @type {Map<string, object>} */
  const byNpm = new Map()
  /** @type {Map<string, object>} */
  const byRepoFolded = new Map()
  let duplicates = 0
  for (const entry of plugins) {
    if (entry === null || typeof entry !== 'object') continue
    const owner = typeof entry.owner === 'string' ? entry.owner : undefined
    const name = typeof entry.name === 'string' ? entry.name : undefined
    if (owner === undefined || name === undefined) continue
    const key = `${owner}/${name}`
    // byNpm is first-wins so a lookup is stable across builds; repo keys must
    // follow the same policy, or an index duplicate silently shadows the
    // earlier record with no diagnostic.
    if (byRepo.has(key)) duplicates += 1
    else byRepo.set(key, entry)
    if (!byRepoFolded.has(key.toLowerCase())) byRepoFolded.set(key.toLowerCase(), entry)
    if (typeof entry.npm === 'string' && entry.npm !== '' && !byNpm.has(entry.npm)) {
      byNpm.set(entry.npm, entry)
    }
  }
  return { byRepo, byRepoFolded, byNpm, count: byRepo.size, duplicates }
}

/** An empty catalogue, for a build that cannot reach the index. */
export function emptyCatalogue() {
  return { byRepo: new Map(), byRepoFolded: new Map(), byNpm: new Map(), count: 0, duplicates: 0 }
}

/**
 * The index record for a normalized reference.
 *
 * GitHub owner and repository names are case-insensitive, so a contributor
 * pasting `MichengAI/Dsh-PUA` names the same repository as the index's
 * `MichengAI/dsh-pua`. An exact hit wins; the case-folded pass only catches a
 * casing difference, never a different repository.
 *
 * @param {{ byRepo: Map<string, object>, byRepoFolded?: Map<string, object> }} catalogue
 * @param {{ key: string }} ref - output of {@link parsePluginRef}.
 * @returns {object | undefined} the upstream record.
 */
export function lookupPlugin(catalogue, ref) {
  return catalogue.byRepo.get(ref.key) ?? catalogue.byRepoFolded?.get(ref.key.toLowerCase())
}

/**
 * The install spec a member resolves to.
 *
 * Two shapes exist upstream and the submission does not choose between them:
 * a package on npm is pinned to the version the index recorded (reproducible
 * install), while a GitHub-only entry has nothing to pin and installs the
 * default branch (marked `floating` so the card can say "latest").
 *
 * @param {object} entry - one index record.
 * @returns {{ spec: string, floating: boolean, npm: string | null, version: string | null }}
 */
export function installSpecOf(entry) {
  if (entry === null || typeof entry !== 'object') {
    throw new TypeError('installSpecOf: expected an index record (the member is not in the index)')
  }
  const npm = typeof entry.npm === 'string' && entry.npm !== '' ? entry.npm : null
  const version = typeof entry.version === 'string' && entry.version !== '' ? entry.version : null
  if (npm !== null && version !== null) {
    return { spec: `npm:${npm}@${version}`, floating: false, npm, version }
  }
  if (npm !== null) return { spec: `npm:${npm}`, floating: true, npm, version }
  // `git:` carries owner/name, never the raw fields: an incomplete record used
  // to become the undetectable spec `git:undefined/undefined`.
  if (typeof entry.owner !== 'string' || typeof entry.name !== 'string'
    || entry.owner === '' || entry.name === '') {
    throw new TypeError('installSpecOf: index record has neither an npm package nor owner/name')
  }
  const repo = `${entry.owner}/${entry.name}`
  return { spec: `git:${repo}`, floating: true, npm: null, version }
}

/**
 * Fetch and parse the upstream plugin index.
 *
 * Two sources, tried in this order and for a measured reason:
 *
 * 1. **The official site** (`awesome-dsh-plugin.com/plugins.json`) — freshest.
 *    CI runs on GitHub's infrastructure, which reaches it directly.
 * 2. **The npm package** (`dsh-plugin-catalog/plugins.json`) — a published
 *    snapshot, roughly a day behind, reached through jsDelivr and every China
 *    mirror. dsh-market reads this same package for the same reason: the
 *    project domain answers 403 through the GitHub proxies used in mainland
 *    China, so a catalog served only from the site is unreachable there.
 *
 * Building from (1) and publishing to npm therefore gives the app fresh data
 * AND a source its users can actually reach.
 *
 * @param {{ timeoutMs?: number }} options - per-request timeout.
 * @returns {Promise<{ index: object, source: string, catalogue: object }>}
 * @throws when neither source answers; a catalog cannot be built blind.
 */
export async function fetchIndex(options = {}) {
  const timeoutMs = options.timeoutMs ?? 120_000
  const sources = [
    'https://awesome-dsh-plugin.com/plugins.json',
    'https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/plugins.json',
  ]
  const failures = []
  for (const url of sources) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'application/json', 'user-agent': 'dsh-suite-store-catalog' },
      })
      if (!response.ok) {
        failures.push(`${url}: HTTP ${String(response.status)}`)
        continue
      }
      const index = await response.json()
      const catalogue = buildCatalogue(index)
      if (catalogue.count === 0) {
        failures.push(`${url}: parsed zero plugins`)
        continue
      }
      return { index, source: url, catalogue }
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`could not read the plugin index\n  ${failures.join('\n  ')}`)
}

/**
 * The `engines.dsh` range each member declares, read from the registry.
 *
 * Why bother: the host refuses a member whose declared range this dsh does not
 * satisfy, and it only says so AFTER the install has started. A card that names
 * the range lets a reader see "needs dsh >=0.2.2" before clicking, instead of
 * watching a four-member run fail on the first one.
 *
 * Cached per build: 42 distinct packages across the current 85 member slots, so
 * one request each rather than one per bundle. A package that answers 404 or
 * times out contributes nothing — "we could not ask" must not render as
 * "no requirement", so absent stays absent and the card simply omits the line.
 *
 * @param {Iterable<string>} names - npm package names to ask about.
 * @param {{ concurrency?: number, timeoutMs?: number }} [options] - worker
 *   count (clamped to at least 1) and per-request timeout.
 * @returns {Promise<Map<string, string>>} name → range, for the ones that have one.
 */
export async function fetchEngines(names, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15_000
  // Sequential on purpose. Six parallel readers made the public registry
  // throttle, turning 1.8s responses into full timeouts; one at a time is
  // slower per request and much faster overall. Clamped: `0` used to spawn no
  // worker at all, and the build then read every member as "no requirement".
  const concurrency = Math.max(1, options.concurrency ?? 1)
  const known = new Map()
  const queue = [...new Set(names)]

  // `/pkg/latest` rather than `/pkg`: the full manifest of a mature package is
  // ~940 KB and takes seconds, while the single-version document is ~4 KB. With
  // 42 distinct members the difference is a 40 MB, multi-minute build versus a
  // few seconds.
  const worker = async () => {
    while (queue.length > 0) {
      const name = queue.shift()
      // The name comes from the upstream index — trusted, but not owned here.
      // Encoding every segment keeps a hostile or malformed entry from becoming
      // a different URL: a bare `../`, `?` or `#` would otherwise reach the
      // path instead of naming a package. Anything that is not a plain package
      // name after encoding is skipped rather than requested.
      const path = name.replace(/^@/u, '%40').replace(/\//gu, '%2f')
      // `%` is legal only as a complete escape, and no segment may be a dot
      // sequence: `..` / `%2e%2e` would otherwise be resolved by the server
      // into a different path than the one meant.
      if (!/^[A-Za-z0-9%][A-Za-z0-9%._-]*$/u.test(path) || /(^|[/.%])\.\.(?:[/.%]|$)/u.test(name)) continue
      if (/%(?![0-9A-Fa-f]{2})/u.test(path)) continue
      try {
        const response = await fetch(`https://registry.npmjs.org/${path}/latest`, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: { accept: 'application/json', 'user-agent': 'dsh-suite-store-catalog' },
        })
        if (!response.ok) continue
        const manifest = await response.json()
        const range = manifest?.engines?.dsh
        if (typeof range === 'string' && range !== '') known.set(name, range)
      } catch {
        // Offline, rate-limited, or gone: the member simply carries no range.
        continue
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))
  return known
}
