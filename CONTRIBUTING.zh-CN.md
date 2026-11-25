# 参与贡献 Hob 插件源

[English](CONTRIBUTING.md)

欢迎向 [Hob](https://github.com/FFatTiger/hob) 官方插件源提交新插件或改进现有插件。本文说明插件规范、提交流程和审核标准。

> 如果只是私有使用或自行实验、不需要进入官方源，可以直接 fork 本仓库，添加插件目录并运行 `node scripts/build-index.mjs`，然后在 Hob 的「**插件 → 市场 → `+`**」里添加你的仓库地址作为自定义插件源。

## 插件类型

本仓库接收两类插件（同一个插件也可同时包含两者）：

1. **工具插件（`mcp.json`）**：接入 MCP 服务，支持远程 HTTP/SSE（令牌请求头或 OAuth）或插件目录自带的本地 stdio 命令。
2. **供应商插件（`providers`）**：提供模型服务商（兼容 OpenCode 供应商插件），在 `extensions["com.hob.plugins"].providers` 中声明，并通过 `package.json` 和 `bun.lock` 锁死依赖树。

## 目录与清单规范

在仓库根目录新建以插件 ID 命名的目录：

- **插件 ID**：满足 `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`（字母、数字、`_` 或 `-`，以字母或数字开头，最长 64 字符）。
- **禁止符号链接**：插件目录内任何位置都不能有 symlink（`scripts/build-index.mjs` 会直接拒绝）。
- **文件自包含**：插件所需的图标、脚本、测试、可选 `skills/` 目录全部放在该插件目录内。

### `plugin.json`

必填与常用字段：

- `name`：插件标识（与目录名一致）。
- `displayName`：在插件市场展示的名称。
- `version`：语义化版本号（如 `"1.0.0"`），每次改动插件都需递增。
- `description`：简要说明插件用途。
- `homepage`（推荐）：上游项目或文档地址。
- `userConfig`（可选）：用户配置项映射（`type` 支持 `string`、`number`、`boolean`、`file`、`directory`；可选 `title`、`description`、`required`、`default`、`options`、`multiple`、`sensitive`、`min`、`max`）。**所有密钥、令牌和密码类配置必须标明 `"sensitive": true`**。
- `extensions["com.hob.plugins"]`：
  - `icon`：图标相对路径（推荐 SVG，如 `"icon.svg"`）。请使用授权合规的品牌图标（如 MIT 协议的 LobeHub icons）或自绘图标。
  - `publisher`：发布者或维护者名称。
  - `sourceUrl`：上游源码仓库地址（社区/供应商插件必填）。
  - `categories`：从以下标准分类中选填一个或多个：`providers`、`communication`、`productivity`、`development`、`data`、`search`、`design`、`media`、`finance`、`home`、`other`。
  - `profiles`：可选 `{ "title": "…" }`，用于支持多账号/多套配置的插件（通过 `${hob.profiles}` 读取；不可与 OAuth 或单个 `${user_config.*}` 混用）。
  - `permissions`：如实声明插件所需权限：
    - `network` — 发起外网请求
    - `subprocess` — 在本机启动子进程或 CLI 程序
    - `local_credentials` — 读取运行 Hob 机器上的本机登录状态
    - `bun_runtime` — 使用固定版本的 Bun 运行环境（供应商插件）
  - **社区 / 非官方 / 供应商插件**还需填写：
    - `unofficial`: `true`
    - `reviewedVersion`：本次审核对应的上游包精确版本号（semver）
    - `summary`：`{ "zh": "...", "en": "..." }`（市场卡片简述）
    - `description`：`{ "zh": "...", "en": "..." }`（详情页完整说明）
    - `risk`：`{ "zh": "...", "en": "..." }`（如实说明非官方接入的条款/账号风险及本机访问行为）
    - `providers`：`[{ "package", "version", "integrity", "tarball"? }]` 数组

### 工具插件（`mcp.json`）

通过 `mcpServers` 将服务名映射到远程 `url` 或本地 `command`/`args`：

```json
{
  "mcpServers": {
    "example": {
      "url": "https://api.example.com/mcp/",
      "headers": {
        "Authorization": "Bearer ${user_config.API_TOKEN}"
      }
    }
  }
}
```

可用模板变量：
- `${user_config.KEY}` — `userConfig` 中的配置值
- `${hob.root}` — Hob 安装目录
- `${hob.plugin_root}` — 已安装插件目录
- `${hob.plugin_data}` — 插件持久数据目录
- `${hob.profiles}` — 多套配置（声明 `profiles` 时使用）

参考现有示例：[`github/`](github/)、[`cloudflare/`](cloudflare/)、[`email/`](email/)、[`bitwarden/`](bitwarden/)。

### 供应商插件（`providers`、`package.json`、`bun.lock`）

供应商插件必须同时锁死顶层包和整棵依赖树：

1. 在 `plugin.json` 的 `extensions["com.hob.plugins"].providers` 中声明每一项：
   - `package`：精确的 npm 包名
   - `version`：精确的 semver 版本号（不得使用 `^`、`~` 等范围）
   - `integrity`：包 tarball 的 `sha512-...` 完整性哈希
   - `tarball`（可选）：非默认 npm 源时填写 `https://` 地址
2. 同目录放置 `package.json`（`"private": true`），其中的 `dependencies` 必须与 `plugin.json` **严格一一对应**（`package -> tarball ?? version`）。
3. 在插件目录内生成并提交 `bun.lock`（`bun install --lockfile-only` 或 `bun install`），锁死所有传递依赖。

获取 `integrity` 哈希的方法：

```bash
# 从 tarball URL 计算
curl -sL "<tarball-url>" | openssl dgst -sha512 -binary | openssl base64 -A | sed 's/^/sha512-/'

# 或直接从 npm 读取
npm view <pkg>@<version> dist.integrity
```

参考现有示例：[`copilot/`](copilot/)、[`zcode/`](zcode/)。

## 提交流程

1. **Fork 并从 `main` 切出新分支**（每个 PR 只做一件事：新增一个插件或更新一个插件）。
2. **新增或修改插件目录**，并更新 `plugin.json` 的 `version`（更新供应商插件时同步更新 `reviewedVersion`、`integrity`、`package.json` 和 `bun.lock`）。
3. **重新生成并校验索引**：
   ```bash
   node scripts/build-index.mjs
   ```
   确认脚本以退出码 `0` 通过，并将更新后的 `index.json` 一并提交。
4. **在 Hob 中实测**：
   - 将分支推到你的 fork（或本地起静态服务），在 Hob 中添加为自定义插件源。
   - 实测安装、配置/登录、工具调用或模型对话，以及停用/卸载恢复是否正常。
   - 若插件包含本地脚本（如 `bitwarden/`），请附上或运行自动化测试，并在 PR 说明里写明验证结果。
5. **按英文 [Conventional Commits](https://www.conventionalcommits.org/) 规范提交**：
   - 标题格式：`type(scope): subject`（`feat`、`fix`、`docs`、`chore`，祈使句，72 字符以内），例如 `feat(linear): add Linear MCP plugin` 或 `fix(bitwarden): handle empty vault response`。
   - 正文写清修改原因和改动内容。
6. **向 `FFatTiger/hob-plugins` 的 `main` 分支提交 Pull Request**，并按 PR 模板填写信息。

## 安全与审核标准

每个 PR 在合并前都会经过安全与功能审查，提交前请对照自查：

- **凭据与密钥安全**：禁止硬编码 API Key、令牌、Cookie 或私有地址；所有敏感配置必须标记 `"sensitive": true`；插件不得把明文密码或原始凭据暴露给助手/模型上下文。
- **代码可审计**：源码和上游包须可读、可审计，不得包含混淆代码、未声明的命令执行、静默自动更新或可疑外连。
- **供应链锁死**：供应商插件必须固定精确 semver、`sha512-...`、`package.json` 和 `bun.lock`，禁止浮动版本（`latest`、`^`、`~`）或未校验的远程脚本。
- **权限与风险如实披露**：`permissions` 与 `risk`（中英文）须真实反映网络访问、本机进程、本机凭据读取及非官方接入风险。
- **开源许可**：提交至本仓库的内容遵循 [MIT](LICENSE) 协议，请确保新增文件和图标授权兼容。

## 更新或修复已有插件

- 按 semver 递增 `plugin.json` 中的 `version`（修复升补丁号，兼容增强升次版本号，破坏性变更升主版本号）。
- 若新增必填 `userConfig` 或扩展 `permissions`，请在 PR 中明确标注（插件能力扩大时，Hob 会在更新时要求用户重新确认）。
- 运行 `node scripts/build-index.mjs`，若文件清单有变化一并提交 `index.json`。
