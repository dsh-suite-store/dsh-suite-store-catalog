# Contributing / 贡献指南

Thanks for helping grow the catalog! / 感谢参与！

## Adding a suite / 收录整合包

Open a PR that adds **one file** / 开**一个文件**的 PR — `suites/<owner>/<suite_id>/<version>.yml`：

```yaml
id: my-suite
owner: your-github-login
version: 1.0.0

# 双语字段：en 必填、zh 可选（不写则退回 en）/ Bilingual fields: en required, zh optional (falls back to en)
title:
  zh: 我的整合包
  en: My suite
summary:
  zh: 一句话说明它解决什么场景
  en: One sentence on the scenario it solves

# 必填：一级分类决定卡片出现在哪个 tab（可选值见 schema/categories.json，共 30 个）/ Required: primary category decides which tab the card appears in (see schema/categories.json for the full list of slugs)
category:
  primary: productivity

members:
  - plugin: owner1/plugin-one
  - plugin: owner2/plugin-two

# 可选——用 GitHub 托管的位图作为市场卡片图标；不写则回退到作者头像
# Optional — a GitHub-hosted bitmap used as the market card icon. Leave it out and
# the author's avatar (from the GitHub login) is used instead. When the owner is
# dsh-suite-store, the plugin's built-in default icon is used.
icon: https://raw.githubusercontent.com/owner/repo/main/assets/icon-180.png

```

**That one file is the whole submission.** After your PR is merged, CI generates the new index automatically — you do not need to run any commands or edit it by hand. / **一个文件就是全部投稿。** 你的 PR 合并后 CI 会自动生成新的索引——你不需要跑任何命令，也不要手工编辑它们。

**Only the plugin name is required.** You don't need to supply a URL or anything else — the store matches it against the curated plugin list automatically. To guarantee uniqueness, use the `<owner>/<name>` form. / **插件成员中，只有插件名字是必须的。** 不需要插件 URL 等信息，商店会自动根据名称去精选插件列表中匹配；为保证唯一性，需使用 `<owner>/<name>` 格式。

**Only `en` is required.** If you can't write the Chinese, leave `zh` out. / **只有 `en` 是必填的。** 写不了中文就不写 `zh`。

Want to check your submission before opening a PR? Run the repository's own admission checker against your file — it reports every problem at once, in both languages, using the same gates CI runs / 想预先校验文件内容格式是否正确？用仓库自带的 PR 准入检验器检查你的文件，它会一次性报告所有问题（中英双语），且与 CI 使用同一套闸门：

```sh
pnpm install --frozen-lockfile
node scripts/check-pr.mjs suites/<owner>/<suite_id>/<version>.yml
```

Leave out `--index` on a fresh clone: the checker fetches the latest upstream plugin index itself, so you don't need a local `plugins.json` (it is gitignored and not shipped with the repo) / 新克隆的仓库不要传 `--index`：检验器会自己联网拉取最新的上游插件索引，因此不需要本地 `plugins.json`（该文件被 gitignore，不会随仓库提供）。

If you already have an index cached locally, pass it with `--index` to avoid the download / 如果本地已有缓存的索引，可用 `--index` 指定它，避免重复下载：

```sh
node scripts/check-pr.mjs suites/<owner>/<suite_id>/<version>.yml --index .cache/plugins.json
```

To replay the whole PR locally, including the owner gate, use the PR simulator (needs a git base branch) / 想在本地完整模拟一次 PR（含 owner 闸门），可用 PR 模拟器（需要一个 git 基准分支）：

```sh
node scripts/simulate-pr.mjs --actor <你的GitHub登录名>
```

Exit code 0 means the submission passes the gates / 退出码 0 表示投稿通过了各项校验闸门。

⚠️ **A summary containing `: ` must be quoted** — otherwise YAML reads it as a nested key. / **summary 中含 `: `（冒号加空格）时必须加引号**，否则 YAML 会把它当成嵌套键：

```yaml
summary:
  en: 'Getting-Start: first suite.'   # ✅ quoted / 加引号
  zh: '新手套装整合包：第一个整合包。'                    # 中文全角冒号无此问题，加引号也无妨
```

```yaml
  en: Getting-Start: first suite.     # ❌ breaks the parser / 解析失败
```

**Why one version file per suite / 为什么一个版本一个文件：** a suite can be upgraded; one file per version keeps ownership verifiable and preserves history without PRs colliding. / 以投稿人 + 整合包 ID 区分后，整合包仍存在版本升级的情况，在确保整合包不冲突的前提下既要验证整合包归属权又要保留历史数据，当前方案完美地解决了这一点。

Valid `category.primary` values / 可用的 `category.primary` 取值：

The source of truth is [`schema/categories.json`](schema/categories.json); slugs are / 唯一数据源是 [`schema/categories.json`](schema/categories.json)，可用 slug：

| Slug | English | 中文 |
|---|---|---|
| `getting-started` | Getting Started | 新手入门 |
| `productivity` | Productivity | 效率工具 |
| `ui-beautify` | UI Beautify | 界面美化 |
| `plugin-management` | Plugin Management | 插件管理 |
| `literary-writing` | Literary Writing | 文学创作 |
| `technical-writing` | Technical Writing | 技术写作与文档 |
| `design-creative` | Design Creative | 设计创意 |
| `multimedia` | Multimedia | 多媒体制作 |
| `development` | Development | 编程开发 |
| `code-review` | Code Review | 代码审查 |
| `architecture` | Architecture | 架构可视化 |
| `data-science` | Data Science | 数据分析 |
| `academic-research` | Academic Research | 学术研究与文献 |
| `web-search` | Web Search | 联网搜索与浏览器 |
| `office-automation` | Office Automation | 办公自动化 |
| `finance-ops` | Finance Ops | 财务运营 |
| `legal` | Legal | 法律法务 |
| `education` | Education | 教育培训 |
| `lifestyle` | Lifestyle | 生活服务 |
| `vision` | Vision | 视觉与 OCR |
| `voice` | Voice | 语音与音频 |
| `memory` | Memory | 长期记忆 |
| `context-session` | Context Session | 上下文与会话管理 |
| `agent-teams` | Agent Teams | 智能体协作 |
| `model-access` | Model Access | 模型接入 |
| `im-bridges` | IM Bridges | 即时通讯接入 |
| `remote-wsl` | Remote WSL | 远程访问与 WSL |
| `security-audit` | Security Audit | 安全审计 |
| `usage-billing` | Usage Billing | 用量与成本 |
| `entertainment` | Entertainment | 娱乐陪伴 |

`category.secondary` is optional; if present it must be one of the secondary slugs under the chosen primary in that same file. / `category.secondary` 可选；一旦填写，必须是同一文件中所选一级分类下列出的二级 slug 之一。

This set is not fixed — see the note on categories under [how submissions are reviewed](#how-submissions-are-reviewed--收录如何评审). / 这组取值不是固定的，说明见[收录如何评审](#how-submissions-are-reviewed--收录如何评审)中关于分类的那条。

Requirements / 要求：

  ⚠️ The most common reasons a submission is rejected are the following / 最常见的被拒原因是以下几种情况：
  
- yml 文件路径中的 `owner` 与当前 GitHub 登录账户名不一致 / The `owner` in the YAML file path does not match the current GitHub account name
- 相同的插件组合已经被收录过 / The same plugin combination has already been accepted
- 成员插件不在精选插件列表 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 中 / A member plugin is not in the curated plugin list [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
- 成员插件数量超过当前维护者限制的数量 / The number of member plugins exceeds the current maintainer limit

  These are checked automatically by CI. They are not a judgement about the quality of your suite — they filter out unclear ownership and unverified risk. / 这几项由 CI 自动检查。它不是对整合包插件成员质量的评价，只是为了过滤掉归属不清晰和未验证风险的插件。
- **The description must be accurate.** It is treated as a claim about your suite and checked against the member plugins. If you write "token billing", the suite must actually contain plugins that do token billing; overstating is the main reason an otherwise-good suite gets sent back. / **描述必须属实。** 它会被当作对你整合包的声明，并与成员插件核对。写「token 计费」，就应该真的包含 token 计费相关的插件；夸大也是让一个本来不错的整合包被打回的主要原因。
- **Pick the category that matches what the suite actually does**, not where you'd like it to appear. / **选贴合整合包实际擅长的领域分类**，而不是你希望它出现在哪里。
- **Suite member limit.** / **一个整合包中不建议包含数量过多的插件**——安装时长、兼容性以及可维护性上都会有极大挑战，尽量追求垂直领域专精而不是大而全。

### How submissions are reviewed / 收录如何评审

A green CI run is the **precondition**, not the decision. CI verifies the shape of a submission — format, ownership, whether the same combination is already included, and so on. It cannot tell whether the member plugins really do what the description says, or whether the category fits. A maintainer checks the suite information before merging. / CI 通过是**前置条件**，不是结论。CI 校验的是提交的形式——格式、归属、是否重复收录等；它无法判断成员插件是否名副其实、分类是否贴切。合并前维护者会实际检查整合包信息。

What that review looks at / 评审会看：

1. **Does the suite do what the entry claims** — including the functions listed in the description. / 整合包作用是否与描述一致。
2. **Is the category reasonable.** Nobody gets sent back over a category — if a better one fits, a maintainer just changes it. The taxonomy itself keeps moving: as a category grows it gets split, and today's best fit may be re-filed later. That is maintenance, not a correction of your judgement. Pick the closest one and don't agonise. The secondary category is optional. / 分类是否合理。**不会有人因为分类被打回**——如果有更贴切的，维护者直接改。分类体系本身也在变：某一类长大了就会拆分。今天最贴切的归类以后也可能被重新归档，那是维护，不是在纠正你的判断。挑最接近的一个即可，不必纠结。二级分类是可选的。
3. **Has the same plugin combination already been included?** / 是否已被重复收录。
4. **Does the PR touch entries it has no business touching.** A PR updating one suite should not rewrite another suite's version file. / PR 是否动了与它无关的目录。更新某个整合包的 PR 不该改写另一个整合包的版本文件。

If you're updating your own suite, **change only your own**. / 如果你在更新自己的整合包，**请只改自己那一个。**

Feedback comes as a PR comment naming exactly what to change. Being sent back for an inaccurate description isn't a rejection of the suite — fix the line and it goes in. / 反馈会以 PR 评论给出，明确指出要改什么。因描述不准确被打回不是对整合包本身的否定——改好即可收录。

### One PR, 1 entry / 一个 PR 最多 1 个整合包

A pull request may add **at most 1 entry**. Over that, CI rejects it and asks you to split. / 一个 PR **最多添加 1 条**，超过会拒绝。

Reviewing a submission means checking each member plugin's function and verifying every claim in the description against it. That work is per-suite and does not get cheaper in bulk. / 评审一个整合包需要逐个检查插件作用，并把描述里的每一句话进行核对。这是逐条的工作量，不会因为打包提交而变少。

### What CI checks / CI 会检查什么

Every PR runs, in order / 每个 PR 依次运行：

TODO

### Icon / 图标（optional / 可选）

A storefront tile: one GitHub-hosted raster image (`png`, `jpg`, `jpeg`, `webp`), declared as `icon:` in your entry. It is drawn at ~96px, so a square image reads best. Omit it and storefronts fall back to the owner's GitHub avatar. SVG and third-party image hosts are refused — the listing does not make visitors fetch images from hosts it cannot vouch for. / 整合包图标：在yml里用 `icon:` 声明一张 **GitHub 托管的位图**（`png`/`jpg`/`jpeg`/`webp`）。卡片约 96px 显示，方形图最清楚；不写则回退到作者头像。SVG 与第三方图床会被拒绝——我们不会让访客去无保障的图床取图。

### Other PRs / 其他类型的PR

PRs fixing descriptions, moving suites between categories, or removing dead suites are equally welcome. / 修正描述、调整分类、移除失效整合包的 PR 同样欢迎。
