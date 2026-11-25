# DSH Suite Store Catalog

English | [中文](README.zh.md)

> [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) plugin suite store catalog — a collection of well-curated plugin combinations for different setups

DeepSeek Harness uses an "everything is a plugin" framework. This catalog aims to provide open-source community users with plugin combination solutions for various domains, on demand.

## Why this catalog exists

> Problem: the dsh plugin community is growing rapidly, with **a wide variety of individual plugins of uneven quality**.

Except for those in related fields, most dsh users are probably encountering Agent / Harness concepts for the first time. After installing dsh, they often don't know where to start, let alone which plugins suit them. At the same time, some suite authors want to share their plugin combinations but lack a common platform.

We hope to solve these problems through the power of the community.

## How we solve it

> This catalog organizes and collects community plugin suites across different fields and specialties, with categories such as `Getting Started`, providing the best plugin combinations for people with different needs.
> 
> **Installing [dsh-suite-store](https://github.com/dsh-suite-store/dsh-suite-store) is recommended** (optional) — a suite store plugin that installs, uninstalls, and manages plugin suites with one click, directly inside dsh.

The suite catalog is mainly maintained by the community; [PRs](CONTRIBUTING.md) are welcome.

<details>
<summary><b>What kinds of suites get included</b></summary>

- The suite's purpose matches its description, and its category is correct. Before merging, every submission is checked to confirm that the member plugins match the described function — if the description says "token billing", it must actually include member plugins with that function.

- First principle: you don't have to be the author of every member plugin, but you should be the first person to combine these plugins together.

- Inclusion is not permanent: entries with a large number of invalid member plugins, ones no longer maintained, or ones found to have obvious defects will be removed. For the full criteria and review checklist, see [How submissions are reviewed](CONTRIBUTING.md#how-submissions-are-reviewed--收录如何评审).

</details>

## Suite category catalog

<!-- BEGIN TAXONOMY -->

Values must come from [`schema/categories.json`](schema/categories.json). The primary category decides which tab the card appears in; the secondary category is optional and is a chip within the tab — if provided, it must belong to the chosen primary category.

- **Getting Started** `getting-started`
  - Secondary categories: `daily-driver` (Daily Driver), `zero-config` (Zero Config), `beginner-friendly` (Beginner Friendly), `starter-kit` (Starter Kit)
- **Productivity** `productivity`
  - Secondary categories: `task-board` (Task Board), `quick-capture` (Quick Capture), `side-question` (Side Question), `notifications` (Notifications), `spend-wallet` (Spend Wallet), `focus-timer` (Focus Timer), `shortcuts` (Shortcuts), `templates` (Templates), `automation` (Automation), `multi-task` (Multi Task)
- **UI Beautify** `ui-beautify`
  - Secondary categories: `themes` (Themes), `sidebar` (Sidebar), `wallpaper` (Wallpaper), `status-bar` (Status Bar), `animations` (Animations), `glassmorphism` (Glassmorphism), `layout` (Layout), `typography` (Typography), `icons` (Icons)
- **Plugin Management** `plugin-management`
  - Secondary categories: `marketplace` (Marketplace), `discovery` (Discovery), `installer` (Installer), `updater` (Updater), `enable-disable` (Enable Disable), `dependency` (Dependency), `backup-restore` (Backup Restore), `catalog` (Catalog), `health-check` (Health Check), `permissions` (Permissions)
- **Literary Writing** `literary-writing`
  - Secondary categories: `long-form` (Long Form), `novel` (Novel), `essay` (Essay), `anti-ai-tone` (Anti AI Tone), `proofreading` (Proofreading), `markdown-preview` (Markdown Preview), `typesetting` (Typesetting), `outline` (Outline), `worldbuilding` (Worldbuilding), `export-publish` (Export Publish)
- **Technical Writing** `technical-writing`
  - Secondary categories: `api-docs` (API Docs), `readme` (Readme), `diagrams` (Diagrams), `code-blocks` (Code Blocks), `docx-export` (DOCX Export), `pdf-render` (PDF Render), `changelog` (Changelog), `knowledge-base` (Knowledge Base), `collaborative-doc` (Collaborative Doc), `versioned-docs` (Versioned Docs)
- **Design Creative** `design-creative`
  - Secondary categories: `vision-bridge` (Vision Bridge), `image-gen` (Image Gen), `design-preview` (Design Preview), `ui-gen` (UI Gen), `ocr-layout` (OCR Layout), `color-palette` (Color Palette), `typography-design` (Typography Design), `asset-library` (Asset Library), `vector-graphics` (Vector Graphics)
- **Multimedia** `multimedia`
  - Secondary categories: `storyboard` (Storyboard), `video-edit` (Video Edit), `pptx` (PPTX), `3d-assets` (3d Assets), `subtitles` (Subtitles), `screen-record` (Screen Record), `image-animation` (Image Animation), `final-render` (Final Render)
- **Development** `development`
  - Secondary categories: `terminal-tui` (Terminal Tui), `lsp` (LSP), `git-integration` (GIT Integration), `file-mentions` (File Mentions), `code-navigation` (Code Navigation), `debugging` (Debugging), `snippets` (Snippets), `workspace` (Workspace), `refactoring` (Refactoring), `dev-server` (Dev Server)
- **Code Review** `code-review`
  - Secondary categories: `subagent-review` (Subagent Review), `simplify` (Simplify), `lint` (Lint), `test-gen` (Test Gen), `diff-review` (Diff Review), `approval-gate` (Approval Gate), `pr-comments` (Pr Comments)
- **Architecture** `architecture`
  - Secondary categories: `repo-graph` (Repo Graph), `sequence-diagram` (Sequence Diagram), `flow-diagram` (Flow Diagram), `dependency-graph` (Dependency Graph), `system-design` (System Design), `uml` (UML), `data-flow` (Data Flow), `lifecycle` (Lifecycle), `interactive-diagram` (Interactive Diagram)
- **Data Science** `data-science`
  - Secondary categories: `chat-analytics` (Chat Analytics), `math-compute` (Math Compute), `dataframe` (Dataframe), `visualization` (Visualization), `spreadsheet` (Spreadsheet), `csv-json` (CSV Json), `statistics` (Statistics), `notebooks` (Notebooks), `sql` (SQL), `ml-tools` (Ml Tools)
- **Academic Research** `academic-research`
  - Secondary categories: `paper-search` (Paper Search), `zotero` (Zotero), `citation` (Citation), `literature-triage` (Literature Triage), `evidence-map` (Evidence Map), `thesis-outline` (Thesis Outline), `cn-academic` (Cn Academic), `deep-research` (Deep Research), `report-engine` (Report Engine), `offline-mode` (Offline Mode)
- **Web Search** `web-search`
  - Secondary categories: `keyless-search` (Keyless Search), `multi-source` (Multi Source), `agent-browser` (Agent Browser), `web-scrape` (Web Scrape), `url-reader` (Url Reader), `search-ui` (Search UI), `citations` (Citations), `x-search` (X Search), `bookmark` (Bookmark), `offline-fallback` (Offline Fallback)
- **Office Automation** `office-automation`
  - Secondary categories: `report-gen` (Report Gen), `brief-gen` (Brief Gen), `meeting-notes` (Meeting Notes), `email` (Email), `document-workflow` (Document Workflow), `data-agent` (Data Agent), `team-agent` (Team Agent), `gongwen` (Gongwen), `visual-card` (Visual Card)
- **Finance Ops** `finance-ops`
  - Secondary categories: `excel-chat` (Excel Chat), `ledger` (Ledger), `invoice` (Invoice), `tax` (Tax), `date-calc` (Date Calc), `office-suite` (Office Suite), `anydoc` (Anydoc), `balance` (Balance), `cost-split` (Cost Split), `statement` (Statement)
- **Legal** `legal`
  - Secondary categories: `contract-review` (Contract Review), `law-lookup` (Law Lookup), `legal-writing` (Legal Writing), `compliance` (Compliance), `case-law` (Case Law), `clause-lib` (Clause Lib), `risk-flag` (Risk Flag), `deadline` (Deadline), `evidence` (Evidence), `dispute` (Dispute)
- **Education** `education`
  - Secondary categories: `explain` (Explain), `mindmap` (Mindmap), `tutor` (Tutor), `courseware` (Courseware), `classroom` (Classroom), `quiz` (Quiz), `study-path` (Study Path), `memory-aid` (Memory Aid), `paper-reading` (Paper Reading)
- **Lifestyle** `lifestyle`
  - Secondary categories: `info-lookup` (Info Lookup), `price-compare` (Price Compare), `errands` (Errands), `travel-route` (Travel Route), `im-push` (IM Push), `video-recap` (Video Recap), `map-tools` (Map Tools), `pocket` (Pocket), `computer-use` (Computer Use), `daily-planner` (Daily Planner)
- **Vision** `vision`
  - Secondary categories: `image-qa` (Image Qa), `ocr` (OCR), `multi-image` (Multi Image), `long-screenshot` (Long Screenshot), `screenshot-to-ui` (Screenshot To UI), `grounding` (Grounding), `pixel-diff` (Pixel Diff), `vision-router` (Vision Router), `clipboard` (Clipboard), `svg-trace` (SVG Trace)
- **Voice** `voice`
  - Secondary categories: `tts` (TTS), `voice-input` (Voice Input), `transcribe` (Transcribe), `voice-clone` (Voice Clone), `audio-player` (Audio Player), `podcast` (Podcast), `sound-effects` (Sound Effects), `music-gen` (Music Gen), `wake-word` (Wake Word), `multi-speaker` (Multi Speaker)
- **Memory** `memory`
  - Secondary categories: `cross-session` (Cross Session), `memory-graph` (Memory Graph), `memory-evolve` (Memory Evolve), `mnemon` (Mnemon), `core-memory` (Core Memory), `episodic` (Episodic), `semantic` (Semantic), `distillation` (Distillation), `memory-provenance` (Memory Provenance), `memory-ui` (Memory UI)
- **Context Session** `context-session`
  - Secondary categories: `context-insight` (Context Insight), `rewind` (Rewind), `snapshot` (Snapshot), `archive` (Archive), `session-map` (Session Map), `handoff` (Handoff), `chat-import` (Chat Import), `compaction` (Compaction), `branch` (Branch), `recovery` (Recovery)
- **Agent Teams** `agent-teams`
  - Secondary categories: `multi-agent` (Multi Agent), `subagent` (Subagent), `model-routing` (Model Routing), `advisor-chain` (Advisor Chain), `role-persona` (Role Persona), `delegation` (Delegation), `review-agent` (Review Agent), `orchestration` (Orchestration), `shared-memory` (Shared Memory), `team-dashboard` (Team Dashboard)
- **Model Access** `model-access`
  - Secondary categories: `subscription` (Subscription), `codex` (Codex), `command-code` (Command Code), `cline-pass` (Cline Pass), `workbuddy` (Workbuddy), `free-model` (Free Model), `account-pool` (Account Pool), `provider-bridge` (Provider Bridge), `model-switch` (Model Switch), `quota` (Quota)
- **IM Bridges** `im-bridges`
  - Secondary categories: `feishu` (Feishu), `wechat` (Wechat), `telegram` (Telegram), `dingtalk` (Dingtalk), `qq` (Qq), `wecom` (Wecom), `slack` (Slack), `discord` (Discord), `whatsapp` (Whatsapp), `multi-channel` (Multi Channel)
- **Remote WSL** `remote-wsl`
  - Secondary categories: `mobile-remote` (Mobile Remote), `ssh-workspace` (SSH Workspace), `qr-pairing` (Qr Pairing), `relay` (Relay), `webrtc` (Webrtc), `device-auth` (Device Auth), `wsl-interop` (WSL Interop), `file-sync` (File Sync), `remote-terminal` (Remote Terminal), `multi-instance` (Multi Instance)
- **Security Audit** `security-audit`
  - Secondary categories: `local-scan` (Local Scan), `permission-gate` (Permission Gate), `risk-review` (Risk Review), `command-guard` (Command Guard), `credential-check` (Credential Check), `sandbox` (Sandbox), `audit-log` (Audit Log), `leak-detect` (Leak Detect), `dependency-audit` (Dependency Audit), `vulnerability` (Vulnerability)
- **Usage Billing** `usage-billing`
  - Secondary categories: `token-count` (Token Count), `cost-meter` (Cost Meter), `usage-stats` (Usage Stats), `billing-panel` (Billing Panel), `balance-widget` (Balance Widget), `budget` (Budget), `peak-offpeak` (Peak Offpeak), `heatmap` (Heatmap), `per-model` (Per Model), `multi-provider` (Multi Provider)
- **Entertainment** `entertainment`
  - Secondary categories: `desktop-pet` (Desktop Pet), `meme` (Meme), `bili` (Bili), `diary` (Diary), `persona` (Persona), `mini-game` (Mini Game), `companion` (Companion), `fun-widget` (Fun Widget)

<!-- END TAXONOMY -->

All of the above categories are community-maintained; PRs are welcome.

## Contributing

PRs are welcome to add your plugin suite. Add a `suites/<owner>/<suite_id>/<version>.yml` file:

```yaml
id: my-suite
owner: your-github-login
version: 1.0.0

# Bilingual fields: en required, zh optional (falls back to en)
title:
  zh: 我的整合包
  en: My suite
summary:
  zh: 一句话说明它解决什么场景
  en: One sentence on the scenario it solves

# Required: the primary category decides which tab the card appears in (see schema/categories.json for the full list of 30 slugs)
category:
  primary: productivity

members:
  - plugin: owner1/plugin-one
  - plugin: owner2/plugin-two

# Optional — a GitHub-hosted bitmap used as the market card icon. Leave it out and
# the author's avatar (from the GitHub login) is used instead. When the owner is
# dsh-suite-store, the plugin's built-in default icon is used.
icon: https://raw.githubusercontent.com/owner/repo/main/assets/icon-180.png

```

One file per suite version — two submissions never touch the same file, so PRs no longer conflict with each other. You don't need to run any commands.

Your PR must meet these requirements:

- The `owner` in the yml file path must match your current GitHub login (case-sensitive)
- The same plugin combination has not already been included; you can check locally with the CI tool first
- **All member plugins come from the curated list [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)**. If a member plugin is not on that list, please submit it there first

To update a suite, create a new `<version>.yml` in the same directory with a version number greater than the previous yml file's. For the full rules and an example format, see the [contribution guide](CONTRIBUTING.md); you may also refer to the [minimal submission template](templates/minimal.yml) and the [full submission template](templates/full.yml).

## FAQ

- Why include combinations of individual plugins instead of dspacks?
	- dspack is a community-defined format, and its consistency cannot yet be guaranteed
	- No forced bundling: installation is fine-grained and controllable, automatically follows marketplace updates, and plugin boundaries are clear

- Why not require a version for every plugin in a suite?
	- dsh is still in preview; forcing pinned versions would impose very high compatibility requirements, so keeping the latest version is safer
	- Suite authors don't need to update manually and frequently

## Disclaimer

The suites in this project are mainly community-maintained, but the initial batch was assembled by the maintainers of dsh-suite-store-catalog or collected from the internet; we are not necessarily the authors of that batch.

Suites are developed and maintained by their respective submitters. Inclusion does not constitute endorsement, and no guarantee is made about any plugin's safety, quality, or maintenance status. Installing a plugin suite runs the corresponding third-party plugin code on your machine — review the source yourself and use it at your own risk.

This project is not affiliated with DeepSeek.

Issues in this repository only handle matters concerning the catalog itself. For problems in the suite store plugin UI, file an issue at [dsh-suite-store](https://github.com/dsh-suite-store/dsh-suite-store/issues); for `dsh` itself, file at [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness/issues); for a bug in a specific plugin, file it in that plugin's own repository.
