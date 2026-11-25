## Summary / 变更说明

- **Plugin ID / 插件 ID**:
- **Version / 版本**:
- **Type / 类型**:
  - [ ] New tool plugin (MCP) / 新增工具插件
  - [ ] New provider plugin / 新增供应商插件
  - [ ] Update or bug fix / 更新或修复已有插件
  - [ ] Docs or tooling / 文档或脚本

What does this change do and why? / 简要说明本次改动内容和原因：

## Permissions & Risk / 权限与风险

- **Declared permissions / 声明权限**: (e.g. `network`, `subprocess`, `local_credentials`, `bun_runtime`)
- **Upstream source / 上游仓库**: (URL, if applicable)
- **Account / ToS or local-access notes / 风险说明**: (for unofficial or local-access plugins)

## Verification / 验证记录

Describe how you tested this plugin in Hob (install, config/sign-in, tool/model calls, automated tests):

## Checklist / 自查清单

- [ ] Read [CONTRIBUTING.md](CONTRIBUTING.md) ([中文](CONTRIBUTING.zh-CN.md))
- [ ] Ran `node scripts/build-index.mjs` and committed the updated `index.json`
- [ ] No hardcoded secrets, tokens, or private addresses; secret fields marked `"sensitive": true`
- [ ] Provider plugins pin exact `version`, `sha512-...` `integrity`, matching `package.json`, and `bun.lock`
- [ ] Commit messages follow English Conventional Commits (`type(scope): subject`)
