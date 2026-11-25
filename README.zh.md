# DSH Suite Store Catalog

[English](README.md) | 中文

> [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）插件整合包商店目录 - 收录不同搭配的优秀插件组合

DeepSeek Harness 采用「一切皆插件」的框架，本目录旨在为开源社区用户按需提供各领域的插件组合方案

## 为什么会有本目录

> 问题：dsh插件社区发展迅猛，**单体插件种类繁多且质量参差不齐**。

除相关从业人员外，大部分dsh用户应该是第一次接触Agent / Harness相关概念，往往在安装完dsh后不知道从何入手，更不知道需要安装哪些适合自己的插件；另外，也有部分整合包作者希望分享自己的插件组合，但却缺少一个公共的平台。

我们希望通过社区的力量解决这些问题。

## 怎么解决

> 本目录整理和收录了不同领域和专业的社区插件整合包，并专门设置了`新手入门`等分类，为不同需求人群提供最好的插件搭配
> 
> **推荐安装 [dsh-suite-store](https://github.com/dsh-suite-store/dsh-suite-store)**（可选）—— 整合包商店插件，一键安装、卸载、管理插件整合包，在dsh中直接安装

整合包目录主要由社区维护，欢迎 [PR](CONTRIBUTING.md)。

<details>
<summary><b>什么样的整合包会被收录</b></summary>

- 整合包的作用与描述一致、分类没放错。每份投稿在合并前都会核查整合包内的成员插件是否与描述功能相符——描述里写「token计费」，就真的需要包含相关功用的成员插件。

- 第一性原则：你不必是每个成员插件的作者，但应该是第一个把这些插件组合起来的人

- 收录也不是永久的：大量成员插件无效、停止维护或被发现有明显缺陷的条目会被移除。完整标准与评审清单见[收录如何评审](CONTRIBUTING.md#how-submissions-are-reviewed--收录如何评审)。

</details>

## 整合包分类目录

<!-- BEGIN TAXONOMY -->

取值必须来自 [`schema/categories.json`](schema/categories.json)。一级分类决定卡片出现在哪个 tab；二级分类可选，是 tab 内的 chip，填了就必须属于所选一级。

- **新手入门** `getting-started`
  - 二级分类：`daily-driver`（日常主力）、`zero-config`（零配置）、`beginner-friendly`（小白友好）、`starter-kit`（起步套件）
- **效率工具** `productivity`
  - 二级分类：`task-board`（任务看板）、`quick-capture`（快速记录）、`side-question`（旁问）、`notifications`（通知提醒）、`spend-wallet`（花费钱包）、`focus-timer`（专注计时）、`shortcuts`（快捷操作）、`templates`（模板库）、`automation`（自动化）、`multi-task`（多任务）
- **界面美化** `ui-beautify`
  - 二级分类：`themes`（主题换肤）、`sidebar`（侧栏增强）、`wallpaper`（动态壁纸）、`status-bar`（状态栏）、`animations`（动画效果）、`glassmorphism`（玻璃质感）、`layout`（布局调整）、`typography`（界面字体）、`icons`（图标美化）
- **插件管理** `plugin-management`
  - 二级分类：`marketplace`（插件市场）、`discovery`（发现检索）、`installer`（安装器）、`updater`（更新管理）、`enable-disable`（启停切换）、`dependency`（依赖管理）、`backup-restore`（备份还原）、`catalog`（目录索引）、`health-check`（健康检查）、`permissions`（权限管理）
- **文学创作** `literary-writing`
  - 二级分类：`long-form`（长文写作）、`novel`（小说创作）、`essay`（散文随笔）、`anti-ai-tone`（去 AI 腔）、`proofreading`（校对润色）、`markdown-preview`（预览）、`typesetting`（文档排版）、`outline`（大纲）、`worldbuilding`（世界设定）、`export-publish`（导出发布）
- **技术写作与文档** `technical-writing`
  - 二级分类：`api-docs`（API 文档）、`readme`（README 生成）、`diagrams`（图表绘制）、`code-blocks`（代码块）、`docx-export`（DOCX 导出）、`pdf-render`（PDF 渲染）、`changelog`（更新日志）、`knowledge-base`（知识库）、`collaborative-doc`（协作文档）、`versioned-docs`（版本化文档）
- **设计创意** `design-creative`
  - 二级分类：`vision-bridge`（视觉桥）、`image-gen`（图像生成）、`design-preview`（设计预览）、`ui-gen`（UI 生成）、`ocr-layout`（OCR 版面）、`color-palette`（配色）、`typography-design`（字体设计）、`asset-library`（素材库）、`vector-graphics`（矢量图形）
- **多媒体制作** `multimedia`
  - 二级分类：`storyboard`（分镜）、`video-edit`（视频剪辑）、`pptx`（PPT 制作）、`3d-assets`（3D 资产）、`subtitles`（字幕）、`screen-record`（录屏）、`image-animation`（图片动效）、`final-render`（成片渲染）
- **编程开发** `development`
  - 二级分类：`terminal-tui`（终端 TUI）、`lsp`（LSP 动作）、`git-integration`（Git 集成）、`file-mentions`（@file 引用）、`code-navigation`（代码导航）、`debugging`（调试）、`snippets`（代码片段）、`workspace`（工作区）、`refactoring`（重构）、`dev-server`（开发服务器）
- **代码审查** `code-review`
  - 二级分类：`subagent-review`（子代理审查）、`simplify`（代码简化）、`lint`（静态检查）、`test-gen`（测试生成）、`diff-review`（改动审查）、`approval-gate`（审批闸门）、`pr-comments`（PR 评论）
- **架构可视化** `architecture`
  - 二级分类：`repo-graph`（仓库图谱）、`sequence-diagram`（时序图）、`flow-diagram`（流程图）、`dependency-graph`（依赖图）、`system-design`（系统设计）、`uml`（UML）、`data-flow`（数据流图）、`lifecycle`（生命周期图）、`interactive-diagram`（交互图）
- **数据分析** `data-science`
  - 二级分类：`chat-analytics`（对话式分析）、`math-compute`（数学计算）、`dataframe`（数据框）、`visualization`（可视化）、`spreadsheet`（电子表格）、`csv-json`（CSV/JSON）、`statistics`（统计）、`notebooks`（Notebook）、`sql`（SQL 查询）、`ml-tools`（机器学习）
- **学术研究与文献** `academic-research`
  - 二级分类：`paper-search`（论文检索）、`zotero`（Zotero）、`citation`（引用核实）、`literature-triage`（文献分诊）、`evidence-map`（证据配对）、`thesis-outline`（论文提纲）、`cn-academic`（中文学术写作）、`deep-research`（深度研究）、`report-engine`（报告引擎）、`offline-mode`（离线模式）
- **联网搜索与浏览器** `web-search`
  - 二级分类：`keyless-search`（免 Key 搜索）、`multi-source`（多源聚合）、`agent-browser`（Agent 浏览器）、`web-scrape`（网页抓取）、`url-reader`（链接读取）、`search-ui`（搜索面板）、`citations`（结构化引用）、`x-search`（X 搜索）、`bookmark`（网页收藏）、`offline-fallback`（离线兜底）
- **办公自动化** `office-automation`
  - 二级分类：`report-gen`（汇报生成）、`brief-gen`（Brief 生成）、`meeting-notes`（会议纪要）、`email`（邮件）、`document-workflow`（文档流程）、`data-agent`（数据代理）、`team-agent`（协作团队）、`gongwen`（公文处理）、`visual-card`（可视化卡片）
- **财务运营** `finance-ops`
  - 二级分类：`excel-chat`（Excel 对话）、`ledger`（台账）、`invoice`（票据）、`tax`（税务）、`date-calc`（期限计算）、`office-suite`（Office 三件套）、`anydoc`（文档转换）、`balance`（余额看板）、`cost-split`（费用分摊）、`statement`（报表）
- **法律法务** `legal`
  - 二级分类：`contract-review`（合同审查）、`law-lookup`（法条检索）、`legal-writing`（文书写作）、`compliance`（合规检查）、`case-law`（案例检索）、`clause-lib`（条款库）、`risk-flag`（风险标记）、`deadline`（期限管理）、`evidence`（证据整理）、`dispute`（纠纷辅助）
- **教育培训** `education`
  - 二级分类：`explain`（讲解）、`mindmap`（脑图）、`tutor`（答疑辅导）、`courseware`（课件）、`classroom`（课堂互动）、`quiz`（测验）、`study-path`（学习路径）、`memory-aid`（记忆辅助）、`paper-reading`（论文精读）
- **生活服务** `lifestyle`
  - 二级分类：`info-lookup`（信息查询）、`price-compare`（比价）、`errands`（跑腿代办）、`travel-route`（出行路线）、`im-push`（结果推送）、`video-recap`（视频回看）、`map-tools`（地图工具）、`pocket`（稍后读）、`computer-use`（桌面代办）、`daily-planner`（日程规划）
- **视觉与 OCR** `vision`
  - 二级分类：`image-qa`（图片问答）、`ocr`（文字提取）、`multi-image`（多图比较）、`long-screenshot`（长截图 OCR）、`screenshot-to-ui`（截图还原 UI）、`grounding`（元素定位）、`pixel-diff`（像素对比）、`vision-router`（视觉路由）、`clipboard`（剪贴板分析）、`svg-trace`（矢量化）
- **语音与音频** `voice`
  - 二级分类：`tts`（语音合成）、`voice-input`（语音输入）、`transcribe`（转写）、`voice-clone`（声音克隆）、`audio-player`（音频播放）、`podcast`（播客）、`sound-effects`（音效）、`music-gen`（音乐生成）、`wake-word`（唤醒词）、`multi-speaker`（多说话人）
- **长期记忆** `memory`
  - 二级分类：`cross-session`（跨会话记忆）、`memory-graph`（记忆图谱）、`memory-evolve`（记忆进化）、`mnemon`（Mnemon）、`core-memory`（核心记忆）、`episodic`（情景记忆）、`semantic`（语义召回）、`distillation`（记忆蒸馏）、`memory-provenance`（记忆溯源）、`memory-ui`（记忆面板）
- **上下文与会话管理** `context-session`
  - 二级分类：`context-insight`（上下文洞察）、`rewind`（回退）、`snapshot`（快照）、`archive`（归档）、`session-map`（会话地图）、`handoff`（交接）、`chat-import`（会话导入）、`compaction`（压缩）、`branch`（分支）、`recovery`（恢复）
- **智能体协作** `agent-teams`
  - 二级分类：`multi-agent`（多智能体）、`subagent`（子代理）、`model-routing`（模型路由）、`advisor-chain`（顾问链）、`role-persona`（角色设定）、`delegation`（任务委派）、`review-agent`（审查代理）、`orchestration`（编排）、`shared-memory`（共享记忆）、`team-dashboard`（团队看板）
- **模型接入** `model-access`
  - 二级分类：`subscription`（订阅复用）、`codex`（Codex）、`command-code`（Command Code）、`cline-pass`（Cline Pass）、`workbuddy`（WorkBuddy）、`free-model`（免费模型）、`account-pool`（账号池）、`provider-bridge`（服务商桥接）、`model-switch`（模型切换）、`quota`（额度聚合）
- **即时通讯接入** `im-bridges`
  - 二级分类：`feishu`（飞书）、`wechat`（微信）、`telegram`（Telegram）、`dingtalk`（钉钉）、`qq`（QQ）、`wecom`（企业微信）、`slack`（Slack）、`discord`（Discord）、`whatsapp`（WhatsApp）、`multi-channel`（多渠道）
- **远程访问与 WSL** `remote-wsl`
  - 二级分类：`mobile-remote`（手机遥控）、`ssh-workspace`（SSH 工作区）、`qr-pairing`（扫码配对）、`relay`（Relay 中转）、`webrtc`（WebRTC）、`device-auth`（设备授权）、`wsl-interop`（WSL 互操作）、`file-sync`（文件同步）、`remote-terminal`（远程终端）、`multi-instance`（多实例）
- **安全审计** `security-audit`
  - 二级分类：`local-scan`（本地扫描）、`permission-gate`（权限闸门）、`risk-review`（风险评测）、`command-guard`（命令护栏）、`credential-check`（凭据检查）、`sandbox`（沙箱）、`audit-log`（审计日志）、`leak-detect`（泄露检测）、`dependency-audit`（依赖审计）、`vulnerability`（漏洞扫描）
- **用量与成本** `usage-billing`
  - 二级分类：`token-count`（Token 计数）、`cost-meter`（费用计量）、`usage-stats`（用量统计）、`billing-panel`（账单面板）、`balance-widget`（余额挂件）、`budget`（预算）、`peak-offpeak`（峰谷计价）、`heatmap`（热力图）、`per-model`（按模型）、`multi-provider`（多供应商）
- **娱乐陪伴** `entertainment`
  - 二级分类：`desktop-pet`（桌宠）、`meme`（表情包）、`bili`（刷 B 站）、`diary`（日记）、`persona`（人设）、`mini-game`（小游戏）、`companion`（陪伴）、`fun-widget`（趣味挂件）

<!-- END TAXONOMY -->

以上分类均由社区维护，欢迎PR。

## 贡献

欢迎提 PR 收录你的插件。新增一个 `suites/<owner>/<suite_id>/<version>.yml` 文件：

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

一个整合包版本一个文件，两份投稿永远不会碰同一个文件，PR 之间不再互相冲突。你不需要跑任何命令。

你的PR需要满足：

- yml 文件路径中的 `owner` 必须与当前 GitHub 登录账户名一致（大小写敏感）
- 相同的插件组合尚未被收录过，可以在本地先利用CI工具校验
- **所有成员插件都来自精选插件列表 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)**。若某个成员插件不属于该列表，请先前往投稿

如果需要更新整合包，请在相同目录下新建`<version>.yml`且该版本号大于上一个yml的版本。
完整规则、示例格式见[贡献指南](CONTRIBUTING.md)，建议参考[最小投稿模板](templates/minimal.yml)和[完整投稿模板](templates/full.yml)

## FAQ

- 为什么不直接收录dspack，而是收录单体插件的组合？
	- dspack为社区定义格式，其一致性暂时无法保证
	- 不做强制捆绑，安装细粒度可控、自动跟随市场更新、插件边界清晰

- 为什么不强制要求提供整合包内每个插件的版本？
	- dsh仍处于预览版本，强制指定版本对兼容性要求非常高，保持使用最新版本更加安全
	- 无需整合包作者频繁手动更新

## 免责声明

本项目中的整合包主要由社区维护，但初始上架的一批整合包由dsh-suite-store-catalog维护者自行搭配或从互联网搜集而来，不完全代表我们是这批整合包的作者。
整合包由各投稿人开发与维护，收录不构成背书，亦不对任何插件的安全性、质量或维护状态作出保证。安装插件整合包即在你的机器上运行对应第三方的插件代码——请自行审阅源码、风险自担。
本项目与 DeepSeek 无隶属关系。

本仓库的 issue 只处理目录本身问题。整合包插件界面里的问题请提到 [dsh-suite-store](https://github.com/dsh-suite-store/dsh-suite-store/issues)；`dsh` 本体的问题请提到 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness/issues)；某个插件的 bug 请到对应插件自己的仓库提。
