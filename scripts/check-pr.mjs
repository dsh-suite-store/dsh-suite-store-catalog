#!/usr/bin/env node
/**
 * PR 准入检验器 —— 验证待合入的 suites 下的 yml 是否符合合入要求。
 *
 * 规则来源：CONTRIBUTING.md §7 的 G1–G13、.github/pull_request_template.md
 * 的自查项、schema/bundle.schema.json。真正的 gate 判定复用 scripts/validate.mjs
 * 与 scripts/build.mjs（与 CI 使用同一份实现，不会和 CI 走偏）；本脚本在它们
 * 之外补上「一次性报告全部问题」「成员自动补全字段不得手写」「PR 模板自查」
 * 「变更文件必须落在 suites/ 且属于投稿者」这些 PR 层面的检查。
 *
 * 所有输出文案均为中英双语（zh / en），面向国际化项目。
 *
 * 用法：
 *   node scripts/check-pr.mjs <file.yml> [更多.yml ...] --index <plugins.json>
 *   node scripts/check-pr.mjs <file.yml> --actor <GitHub登录名> [--fork-owner <名>]
 *   node scripts/check-pr.mjs --diff [--base main] --index <plugins.json>
 *   node scripts/check-pr.mjs --all --index <plugins.json>   # 校验整棵树
 *
 * 兼容 catalog.mjs 的参数：--index <file> 缺省时会联网拉取最新插件索引；
 * --actor 指定 PR 投稿者时启用 owner 闸门（CI 对 fork PR 的检查）。
 * --diff 模式下只读取 git 相对 --base 的变更文件（默认变更检测）。
 * 退出码 0 = 符合合入要求，1 = 不符合，2 = 用法/环境错误。
 */

import { execFileSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

import { parse as parseYaml, parseDocument } from 'yaml'

import { buildCatalogue, fetchIndex } from './catalogue.mjs'
import { readCategories } from './categories.mjs'
import { assertVersionAdvances, parseSubmissionPath, validateSubmission } from './validate.mjs'
import { explainYamlError } from './yaml-error.mjs'

const root = resolve(import.meta.dirname, '..')

/** 统一成仓库相对路径的正斜杠形式。 */
const normalizePath = (path) => String(path).replace(/\\/gu, '/')

/**
 * 每个包只保留最新版本：`<owner>/<id>` → 成员集合已解析的 normalized 文档。
 *
 * @param {Map<string, object | undefined>} byPath - 路径 → normalized 文档。
 * @returns {Map<string, object | undefined>} 路径 → 最新版本的 normalized 文档。
 */
function newestPerBundle(byPath) {
  /** @type {Map<string, {path: string, version: string}>} */
  const newest = new Map()
  for (const [path, normalized] of byPath) {
    if (normalized === undefined) continue
    const key = `${normalized.owner}/${normalized.id}`
    const prior = newest.get(key)
    if (prior === undefined || compareVersionStrings(normalized.version, prior.version) > 0) {
      newest.set(key, { path, version: normalized.version })
    }
  }
  const result = new Map()
  for (const [key, item] of newest) result.set(item.path, byPath.get(item.path))
  return result
}

// schema/bundle.schema.json 中允许出现的字段（additionalProperties: false）。
// 校验器 validate.mjs 只检查已知字段，手写自动补全字段会被它放过，所以这里
// 按 schema 再查一遍。
const TOP_LEVEL_FIELDS = new Set([
  'id', 'owner', 'version', 'title', 'summary', 'description',
  'category', 'tags', 'cover', 'icon', 'postInstall', 'capabilityRedLines', 'members',
])
const MEMBER_FIELDS = new Set(['plugin', 'reason', 'requires'])
const LOCALIZED_FIELDS = new Set(['zh', 'en'])
const REDLINE_FIELDS = new Set(['text', 'members'])

const oneLine = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim()

/** 一条中英双语问题：gate + 路径 + zh/en 说明。 */
class Issue {
  constructor(gate, path, zh, en) {
    this.gate = gate
    this.path = path
    this.zh = oneLine(zh)
    this.en = oneLine(en)
  }
  text() {
    return `${this.gate} ${this.path}: zh: ${this.zh} | en: ${this.en}`
  }
}

/** explainYamlError 返回多行 zh/en 文本，拆成两种语言各一行。 */
function yamlIssue(gate, path, text) {
  const where = String(text).split('\n')[0]
  const zh = String(text).match(/^\s*zh:\s*(.+)$/mu)?.[1] ?? String(text)
  const en = String(text).match(/^\s*en:\s*(.+)$/mu)?.[1] ?? String(text)
  return new Issue(gate, path, `${where} ${zh}`, `${where} ${en}`)
}

/**
 * 复用 CI 校验器时，其文案是英文。这里按已知模式给出中文译文；
 * 未知文案也保留英文原文，并在 zh 行注明，保证每条输出都是双语。
 */
const GATE_ZH = [
  [/^expected a mapping$/, () => '应为映射对象'],
  [/^expected a string$/, () => '应为字符串'],
  [/^expected a list$/, () => '应为列表'],
  [/^expected \{ zh, en \}$/, () => '应包含 zh 和 en 两个语言字段'],
  [/^unexpected language$/, () => '出现不支持的语言字段，只允许 zh 和 en'],
  [/^shorter than (\d+) characters$/, (m) => `短于 ${m[1]} 个字符`],
  [/^longer than (\d+) characters$/, (m) => `长于 ${m[1]} 个字符`],
  [/^must be lowercase letters, digits and dashes$/, () => '只能使用小写字母、数字和连字符'],
  [/^lowercase letters, digits and dashes$/, () => '只能使用小写字母、数字和连字符'],
  [/^must equal the directory name "(.+)"$/, (m) => `必须等于目录名 "${m[1]}"`],
  [/^must equal the file name "(.+)"$/, (m) => `必须等于文件名 "${m[1]}"`],
  [/^is not a GitHub login$/, () => '不是合法的 GitHub 登录名'],
  [/^must be a plain MAJOR\.MINOR\.PATCH$/, () => '必须是标准的 MAJOR.MINOR.PATCH 版本号'],

  [/^required — choose one of the slugs in schema\/categories\.json$/, () => 'category 必填，必须从 schema/categories.json 的一级分类中选择'],
  [/^required$/, () => 'category.primary 必填'],
  [/^"(.+)" is not one of the \d+ categories in schema\/categories\.json$/, (m) => `一级分类 "${m[1]}" 不在 schema/categories.json 的分类列表中`],
  [/^"(.+)" is not under "(.+)"\. Choose one of: (.+)$/, (m) => `二级分类 "${m[1]}" 不属于一级分类 "${m[2]}"，可选：${m[3]}`],
  [/^at most 8 tags$/, () => '标签最多 8 个'],
  [/^duplicate tag$/, () => '标签重复'],
  [/^must be an absolute https URL$/, () => '必须是带主机名的绝对 https 链接'],
  [/^must be an https URL$/, () => '必须是 https 链接'],
  [/^must be an https URL on a GitHub host$/, () => '必须是 GitHub 上的 https 链接'],
  [/^must be hosted on GitHub \(github\.com or raw\.githubusercontent\.com\), not "(.+)"$/, (m) => `图片必须托管在 GitHub 上（github.com 或 raw.githubusercontent.com），当前是 "${m[1]}"`],
  [/^must point at a raster image \(png, jpg, jpeg or webp\) — SVG and other formats are not accepted$/, () => '必须指向位图（png/jpg/jpeg/webp），不接受 SVG 及其他格式'],
  [/^at least (\d+) members$/, (m) => `成员至少 ${m[1]} 个`],
  [/^at most (\d+) members, got (\d+)$/, (m) => `成员最多 ${m[1]} 个，当前 ${m[2]} 个`],
  [/^needs `plugin: owner\/name` \(find it at (.+)\)$/, (m) => `缺少 plugin: owner/name 字段（可在 ${m[1]} 查找）`],
  [/^expected a GitHub repository as owner\/name$/, () => '应为合法的 GitHub 仓库坐标 owner/name'],
  [/^duplicate member "(.+)"$/, (m) => `成员 "${m[1]}" 重复`],
  [/^"(.+)" is not in the plugin index — search it at (.+)\. Only indexed plugins can be a member\.$/, (m) => `"${m[1]}" 不在插件精选索引中，请在 ${m[2]} 查找；只有已收录的插件才能成为成员`],
  [/^references unknown member "(.+)" \(use its owner\/name\)$/, (m) => `引用了不存在的成员 "${m[1]}"（请使用其 owner/name）`],
  [/^dependency cycle: (.+)$/, (m) => `依赖关系存在环：${m[1]}`],
  [/^unknown member "(.+)"$/, (m) => `未知成员 "${m[1]}"`],
  [/^version (.+) already exists in this bundle's history$/, (m) => `版本 ${m[1]} 已在该整合包的历史版本中存在`],
  [/^must be greater than the existing (.+)$/, (m) => `版本号必须大于已有版本 ${m[1]}`],
  [/^expected suites\/<owner>\/<suite_id>\/<version>\.yml$/, () => '路径应为 suites/<owner>/<suite_id>/<version>.yml'],
  [/^must end in \.yml$/, () => '文件名必须以 .yml 结尾'],
]

function gateZh(en) {
  for (const [pattern, render] of GATE_ZH) {
    const match = pattern.exec(en)
    if (match !== null) return render(match)
  }
  return '校验未通过（原文见 en）'
}

/** 把 GateError / Error 转成一条双语 Issue。 */
function gateIssue(error, fallbackPath) {
  const en = String(error?.message ?? error).replace(/^\S+ \S+: /u, '')
  return new Issue(error?.gate ?? 'G2', error?.path ?? fallbackPath, gateZh(en), en)
}

/** PR 自查清单：.github/pull_request_template.md 中被勾选的项。 */
function checkTemplate(body) {
  const issues = []
  // 模板本身自带的固定文本（HTML 注释里的提示、自查清单里的路径）会命中任何关键词
  // 检查，投稿者原封不动提交也能通过。先剥掉注释与整段自查清单，只看用户写的内容。
  const authored = String(body)
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/^##\s*自查[\s\S]*?(?=^##\s|(?![\s\S]))/gmu, '')
    .trim()
  if (!/整合包|bundle|suite/iu.test(authored)) {
    issues.push(new Issue('PR', 'pull_request_template',
      'PR 描述缺少整合包名/新包或更新的说明',
      'PR description is missing the bundle name and whether it is new or an update'))
  }
  const reviewers = /给审核者看的[\s\S]*$/u.exec(authored)?.[0] ?? ''
  if (oneLine(reviewers).replace(/^给审核者看的/u, '').trim().length < 10
    || !/场景|成员|scenario|member/iu.test(reviewers)) {
    issues.push(new Issue('PR', 'pull_request_template',
      'PR 描述缺少给审核者的场景与成员配合说明',
      'PR description is missing the scenario and how members fit together for reviewers'))
  }
  // 模板只有 5 个自查项；已勾选项少于 5 视为自查未完成。
  const checked = [...String(body).matchAll(/^\s*-\s*\[x\]\s/imug)].length
  if (checked < 5) {
    issues.push(new Issue('PR', 'pull_request_template',
      `自查清单应全部勾选（当前 ${String(checked)}/5）`,
      `All checklist items must be ticked (currently ${String(checked)}/5)`))
  }
  return issues
}

/** 读取 schema 允许字段之外的键，形成 G2 问题。 */
function unknownKeys(value, allowed, path, label) {
  const issues = []
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return issues
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue
    // `schema: 1` was removed from the format: it never reached the published
    // artifacts and gate G2 only demanded it back. An older submission that
    // still carries it gets a specific line rather than the generic "unknown
    // field", which would send the author looking for a typo.
    if (path === '$' && key === 'schema') {
      issues.push(new Issue('G2', '$.schema',
        '`schema: 1` 已从投稿格式中移除，请直接删掉这一行（其余字段不变）',
        '`schema: 1` was removed from the submission format — delete this line; nothing else changes'))
      continue
    }
    issues.push(new Issue('G2', `${path}.${key}`,
      `不支持的${label.zh} "${key}"；该字段不在 schema/bundle.schema.json 允许的字段中（npm/version/repo 等自动补全字段不要手写）`,
      `Unsupported ${label.en} "${key}"; the field is not allowed by schema/bundle.schema.json (do not hand-write auto-filled fields such as npm/version/repo)`))
  }
  return issues
}

const LABELS = {
  top: { zh: '顶层字段', en: 'top-level field' },
  lang: { zh: '语言键', en: 'language key' },
  category: { zh: 'category 字段', en: 'category field' },
  redline: { zh: '红线字段', en: 'red-line field' },
  member: { zh: '成员字段', en: 'member field' },
}

/** 单个文件：YAML 可解析性 + schema 字段 + G1–G13 + G3 递增。 */
/**
 * Validate one submission against every gate.
 *
 * @param path - repository-relative path of the file.
 * @param expected - owner/id/version parsed out of that path.
 * @param doc - the parsed YAML.
 * @param catalogue - the upstream plugin index.
 * @param categories - the category tree.
 * @param history - `<owner>/<id>` → every OTHER version file of that bundle.
 * @param rawText - the file's text, for the YAML-shape gates.
 * @param options.all - true when walking the whole tree (`--all`), where an
 *   older version file is history rather than a submission.
 * @param options.added - the files this change ADDS; when known, each of them
 *   must advance past its bundle's history.
 * @returns the issues found, and the validated document.
 */
function checkOne(path, expected, doc, catalogue, categories, history, rawText = undefined, options = {}) {
  const issues = []
  // `parseDocument` 默认 uniqueKeys: true：重复的 mapping key 会进 document.errors，
  // 在这里就返回，所以下面不再单独扫 members[].* 的重复键（那条分支永远到不了）。
  let document
  try {
    document = parseDocument(rawText ?? '')
  } catch (error) {
    issues.push(yamlIssue('G2', path, explainYamlError(error, path)))
    return { issues, normalized: undefined, doc: undefined }
  }
  if (document.errors.length > 0) {
    issues.push(yamlIssue('G2', path, explainYamlError(document.errors[0], path)))
    return { issues, normalized: undefined, doc: undefined }
  }

  // schema 的 additionalProperties: false（G2）
  issues.push(...unknownKeys(doc, TOP_LEVEL_FIELDS, '$', LABELS.top))
  for (const field of ['title', 'summary', 'description', 'postInstall']) {
    if (doc?.[field] !== undefined) issues.push(...unknownKeys(doc[field], LOCALIZED_FIELDS, `$.${field}`, LABELS.lang))
  }
  if (doc?.category !== undefined) issues.push(...unknownKeys(doc.category, new Set(['primary', 'secondary']), '$.category', LABELS.category))
  if (doc?.capabilityRedLines !== undefined && Array.isArray(doc.capabilityRedLines)) {
    for (const [at, line] of doc.capabilityRedLines.entries()) {
      issues.push(...unknownKeys(line, REDLINE_FIELDS, `$.capabilityRedLines[${String(at)}]`, LABELS.redline))
      if (line?.text !== undefined) issues.push(...unknownKeys(line.text, LOCALIZED_FIELDS, `$.capabilityRedLines[${String(at)}].text`, LABELS.lang))
    }
  }
  if (Array.isArray(doc?.members)) {
    for (const [at, member] of doc.members.entries()) {
      issues.push(...unknownKeys(member, MEMBER_FIELDS, `$.members[${String(at)}]`, LABELS.member))
      if (member?.reason !== undefined) issues.push(...unknownKeys(member.reason, LOCALIZED_FIELDS, `$.members[${String(at)}].reason`, LABELS.lang))
      if (Array.isArray(member?.requires) && new Set(member.requires).size !== member.requires.length) {
        issues.push(new Issue('G4', `$.members[${String(at)}].requires`,
          'requires 列表中有重复成员',
          'Duplicate member in the requires list'))
      }
    }
  }

  // 复用 CI 的 validator：G1/G2/G3/G4/G5/G6/G7/G11/G12。
  let normalized
  try {
    normalized = validateSubmission(doc, expected, catalogue, categories)
  } catch (error) {
    if (error?.gate !== undefined) {
      issues.push(gateIssue(error, path))
    } else {
      const message = error instanceof Error ? error.message : String(error)
      issues.push(new Issue('G2', path,
        `解析或校验发生错误：${message}`,
        `Error while parsing or validating: ${message}`))
    }
    return { issues, normalized: undefined, doc }
  }

  // G3 版本递增。
  //
  // 判据是「这个文件是本次新增的吗」，不是「它的版本号是否比最新版低」。
  // 旧判据 `version >= newestExisting` 把「新增 0.9.0 到已有 1.0.0 旁边」
  // 误当成历史版本直接放行——而那正是最该拒绝的投稿。历史版本只在 `--all`
  // （遍历整棵树）时出现，那种情况下我们本来就不该要求递增。
  //
  // English: the question is "did this change ADD this file", not "is it older
  // than the newest". The old guard skipped G3 whenever the file sorted below
  // the newest, so adding 0.9.0 beside an existing 1.0.0 sailed through.
  const key = `${expected.owner}/${expected.id}`
  const others = (history.get(key) ?? []).filter((item) => item !== path)
  const othersVersions = others.map((item) => item.split('/').at(-1).replace(/\.yml$/u, ''))
  const newestExisting = othersVersions.slice().sort(compareVersionStrings).at(-1)
  // Three cases, and collapsing them is what caused the bypass:
  //   added known      → only a file this change ADDS must advance (history is
  //                      allowed to sort lower; that is what history is)
  //   added unknown    → the caller cannot say, so decide by intent:
  //     --all          → walking the tree is not a submission; only the newest
  //                      file of each bundle has to advance
  //     explicit paths → naming a file means submitting it; always require
  const needsAdvance = options.added !== undefined
    ? options.added.has(path)
    : options.all === true
      ? newestExisting === undefined || compareVersionStrings(expected.version, newestExisting) >= 0
      : true
  if (needsAdvance) {
    try {
      assertVersionAdvances(expected.version, othersVersions)
    } catch (error) {
      issues.push(gateIssue(error, '$.version'))
    }
  }

  return { issues, normalized, doc }
}

/** 只比较 G3 需要的那点顺序：MAJOR.MINOR.PATCH 三段数字。 */
function compareVersionStrings(left, right) {
  const parse = (value) => value.split('.').map(Number)
  const [a, b] = [parse(left), parse(right)]
  for (const at of [0, 1, 2]) {
    const difference = (a[at] ?? 0) - (b[at] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/**
 * G13：成员集合不得与其它整合包（各自的最新版本）完全相同。
 *
 * `allNormalized` 里每个 key 都只放「该包最新版本」。如果拿整棵树的所有版本去比，
 * 老版本会跟自己的新版撞、已发布包也会互相撞，导致「只改元数据」的发布永远过不了。
 */
function checkComposition(path, normalized, newestByBundle) {
  const issues = []
  if (normalized === undefined) return issues
  const fingerprint = normalized.members.map((member) => member.key).sort().join('\n')
  for (const [other, value] of newestByBundle) {
    if (other === path || value === undefined) continue
    const otherFingerprint = value.members.map((member) => member.key).sort().join('\n')
    if (otherFingerprint === fingerprint) {
      issues.push(new Issue('G13', '$.members',
        `成员集合与 ${other} 完全相同；整合包的价值在挑选，至少换一个成员`,
        `Member set is identical to ${other}; a bundle must curate — change at least one member`))
    }
  }
  return issues
}

/** 文件必须落在 suites/<owner>/<id>/<version>.yml。 */
function checkLocation(path) {
  const issues = []
  const normalized = path.replace(/\\/gu, '/')
  if (!normalized.startsWith('suites/')) {
    issues.push(new Issue('G1', path,
      'PR 只能修改 suites/ 下的投稿文件',
      'A PR may only change submission files under suites/'))
  }
  try {
    parseSubmissionPath(normalized)
  } catch (error) {
    issues.push(gateIssue(error, path))
  }
  return issues
}

/** PR owner 闸门：每个变更目录的 owner 必须等于 actor 或 fork owner。 */
function checkOwners(paths, actor, forkOwner) {
  const issues = []
  const owners = new Set(paths.map((path) => path.match(/^suites\/([^/]+)\//u)?.[1]).filter(Boolean))
  for (const owner of owners) {
    if (owner !== actor && owner !== forkOwner) {
      issues.push(new Issue('OWNER', `suites/${owner}/`,
        `目录属于 ${owner}，但 PR 投稿者是 ${actor}（fork owner: ${forkOwner}）`,
        `Directory is owned by ${owner}, but the PR author is ${actor} (fork owner: ${forkOwner})`))
    }
  }
  return issues
}

/** 枚举 suites/ 下所有 .yml（用于 --all 与版本历史）。 */
async function walkSuites() {
  const files = []
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.name.endsWith('.yml')) files.push(path)
    }
  }
  await walk(join(root, 'suites'))
  return files.map((path) => relative(root, path).split(sep).join('/'))
}

/** 从 git 取相对 base 的变更文件（模拟 CI 的 diff）。 */
function changedFiles(base) {
  const head = resolveBase(base)
  const diff = execFileSync('git', ['diff', '--name-only', `${head}...HEAD`], { cwd: root, encoding: 'utf8' })
  return diff.split('\n').filter(Boolean)
}

/**
 * 相对 base 新增（而非修改）的投稿文件。
 *
 * `--diff-filter=A` 是唯一诚实的判据：一个版本文件可能比本 bundle 的最新版更旧，
 * 却仍然是合法的历史条目（`--all`、发布构建），所以「是否更旧」不能决定 G3 是否
 * 适用；「这次变更是否新增了它」可以。（英文：which files this change ADDS.）
 */
function addedFiles(base) {
  const head = resolveBase(base)
  const diff = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=A', `${head}...HEAD`],
    { cwd: root, encoding: 'utf8' },
  )
  return new Set(diff.split('\n').filter(Boolean))
}

/** `origin/<base>` when it exists, else `<base>`; throws when neither does. */
function resolveBase(base) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `origin/${base}`], { cwd: root, stdio: 'ignore' })
    return `origin/${base}`
  } catch {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', base], { cwd: root, stdio: 'ignore' })
      return base
    } catch {
      throw new Error(`找不到基准分支 ${base}（base ref not found: ${base}）`)
    }
  }
}

async function loadIndex(flags) {
  const file = flags('--index')
  if (file === undefined) {
    const { source, catalogue } = await fetchIndex()
    console.log(`索引：${String(catalogue.count)} 个插件，来源 ${source}（index: ${String(catalogue.count)} plugins from ${source}）`)
    return catalogue
  }
  const catalogue = buildCatalogue(JSON.parse(await readFile(resolve(file), 'utf8')))
  console.log(`索引：${String(catalogue.count)} 个插件，来源 ${file}（index: ${String(catalogue.count)} plugins from ${file}）`)
  return catalogue
}

/** 会吃掉下一个参数的 flag：解析待检文件时不能把它们的值当成路径。 */
const VALUE_FLAGS = new Set(['--index', '--actor', '--fork-owner', '--base', '--pr-body'])
const BOOLEAN_FLAGS = new Set(['--all', '--diff', '--help', '-h'])

/**
 * 位置参数（待检文件）与 flag 分开解析。
 *
 * 旧实现按 `.endsWith('.yml')` 过滤整个 argv，于是 `.yaml` / `.YML` 投稿被静默丢掉
 * （`checkLocation` 的「必须以 .yml 结尾」闸门永远到不了），而 `--index plugins.yml`
 * 的值会被误当成待检文件。
 */
function parseArguments(argv) {
  const positional = []
  const flags = new Map()
  for (let at = 0; at < argv.length; at += 1) {
    const argument = argv[at]
    if (VALUE_FLAGS.has(argument)) {
      flags.set(argument, argv[at + 1])
      at += 1
      continue
    }
    if (BOOLEAN_FLAGS.has(argument)) {
      flags.set(argument, true)
      continue
    }
    if (!argument.startsWith('-')) positional.push(argument)
  }
  return { positional, flag: (name) => flags.get(name) }
}

async function main(argv) {
  const { positional, flag: flags } = parseArguments(argv)
  if (argv.length === 0 || flags('--help') === true) {
    console.log(`用法 / Usage:
  node scripts/check-pr.mjs <file.yml> [file.yml ...] --index <plugins.json> [--actor <login>] [--fork-owner <login>] [--pr-body <file>]
     检验指定投稿文件 / validate the given submission files
  node scripts/check-pr.mjs --diff [--base main] --index <plugins.json>
     检验相对基准分支的变更 / validate files changed against the base branch
  node scripts/check-pr.mjs --all --index <plugins.json>
     检验整棵投稿树 / validate the whole submission tree`)
    return
  }

  const all = flags('--all') === true
  const diff = flags('--diff') === true
  // 显式传入的路径原样保留（含 .yaml/.YML 与错误扩展名）：扩展名由 checkLocation 报错，
  // 而不是在这里被静默丢弃。
  let targets = [...positional]
  let skipped = 0
  // The files this change ADDS, when git can tell us. `--diff` asks git
  // directly; an explicit path list cannot know, so `options.added` stays
  // undefined there and checkOne treats every listed file as a submission.
  let added
  if (diff) {
    try {
      added = addedFiles(flags('--base') ?? 'main')
    } catch {
      // No usable base: fall back to "every listed file is a submission", which
      // is what an explicit path list means anyway.
      added = undefined
    }
    const changed = changedFiles(flags('--base') ?? 'main').filter((path) => path.endsWith('.yml'))
    for (const path of changed) {
      try {
        await readFile(resolve(root, path))
        targets.push(path)
      } catch {
        skipped++
      }
    }
  }
  else if (all) targets = await walkSuites()
  if (skipped > 0) {
    console.log(`跳过：${String(skipped)} 个变更文件在当前工作区已不存在（已删除）（skipped: ${String(skipped)} changed files no longer exist in the worktree — deleted）`)
  }
  if (targets.length === 0) {
    throw new Error('没有找到待检验的 .yml（显式传入路径、--diff 或 --all）（no .yml to check — pass paths, --diff or --all）')
  }

  const [catalogue, categories, allFiles] = await Promise.all([
    loadIndex(flags),
    readCategories(),
    walkSuites(),
  ])

  const actor = flags('--actor')
  const forkOwner = flags('--fork-owner') ?? actor
  const issues = []

  // 只读解析，用于版本历史与其它包成员集合；不参与 gate 判定。
  const history = new Map()
  for (const path of allFiles) {
    try {
      const expected = parseSubmissionPath(path)
      const doc = parseYaml(await readFile(join(root, path), 'utf8'))
      if (doc?.id !== expected.id || doc?.owner !== expected.owner || typeof doc?.version !== 'string') continue
      const key = `${expected.owner}/${expected.id}`
      const list = history.get(key) ?? []
      list.push(path)
      history.set(key, list)
    } catch {
      // 其它文件的解析错误不是本 PR 的责任。
    }
  }

  // 先校验全部目标，再比较成员集合，保证即便单个文件失败也能报告 G13。
  const checked = []
  for (const path of targets) {
    const normalizedPath = path.replace(/\\/gu, '/')
    issues.push(...checkLocation(normalizedPath))
    let expected
    try {
      expected = parseSubmissionPath(normalizedPath)
    } catch {
      continue
    }
    const filePath = resolve(root, normalizedPath)
    const rawText = await readFile(filePath, 'utf8')
    let doc
    try {
      doc = parseYaml(rawText)
    } catch (error) {
      issues.push(yamlIssue('G2', normalizedPath, explainYamlError(error, normalizedPath)))
      continue
    }
    const result = checkOne(normalizedPath, expected, doc, catalogue, categories, history, rawText, {
      all,
      ...(added === undefined ? {} : { added }),
    })
    issues.push(...result.issues)
    checked.push({ path: normalizedPath, normalized: result.normalized })
  }

  const allNormalized = new Map(checked.map((item) => [normalizePath(item.path), item.normalized]))
  // G13 必须与整棵树比较，两种模式都是：diff 模式下只看改动文件，就能抄一份没改的
  // 包的成员集合而照样通过。
  for (const path of allFiles) {
    if (allNormalized.has(path)) continue
    try {
      const expected = parseSubmissionPath(path)
      const doc = parseYaml(await readFile(join(root, path), 'utf8'))
      allNormalized.set(path, validateSubmission(doc, expected, catalogue, categories))
    } catch {
      allNormalized.set(path, undefined)
    }
  }
  // 每个包只留最新版本参与比较：拿所有历史版本比，老版本会跟自己的新版撞。
  const newestByBundle = newestPerBundle(allNormalized)
  for (const item of checked) {
    issues.push(...checkComposition(normalizePath(item.path), item.normalized, newestByBundle))
  }

  if (actor !== undefined && actor !== '') {
    // 归一化后再交给 owner 闸门：CI 传的是 'suites/...'，而本地显式传参可能是
    // 'suites\victim\x\1.0.0.yml'（Windows）——checkOwners 的 ^suites/([^/]+)/ 就匹配不上。
    issues.push(...checkOwners(targets.map(normalizePath), actor, forkOwner))
  }

  const bodyFile = flags('--pr-body')
  if (bodyFile !== undefined) {
    issues.push(...checkTemplate(await readFile(resolve(bodyFile), 'utf8')))
  }

  if (issues.length === 0) {
    console.log(`PR 准入检验通过：${String(targets.length)} 个文件符合 G1–G13 与 PR 自查要求。（PR admission passed: ${String(targets.length)} file(s) satisfy G1–G13 and the PR checklist.）`)
    return
  }
  // CI 兼容的 ::error 行：每行一条，双语同显，便于日志高亮与逐条修复。
  for (const issue of issues) {
    console.error(`::error ${issue.text()}`)
  }
  console.error(`\nPR 准入检验失败：${String(issues.length)} 个问题（${String(targets.length)} 个文件）。（PR admission failed: ${String(issues.length)} issue(s) in ${String(targets.length)} file(s).）`)
  process.exitCode = 1
}

try {
  await main(process.argv.slice(2))
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\nPR 准入检验未能完成 / PR admission check could not complete:\n  zh: 发生错误：${message}\n  en: Error: ${message}\n`)
  process.exitCode = 2
}
