# Contributing to Hob Plugins

[简体中文](CONTRIBUTING.zh-CN.md)

Thank you for contributing to the official [Hob](https://github.com/FFatTiger/hob) plugin source. This guide covers how to add or update a plugin and what is checked during review.

> Want to host plugins privately or experiment without going through review? Fork this repository, add your plugin, run `node scripts/build-index.mjs`, and add your fork URL as a custom plugin source in Hob (**Plugins → Market → `+`**).

## Plugin types

This repository accepts two kinds of plugins (a plugin may also combine both):

1. **Tool plugins (`mcp.json`)**: Connect an MCP server—either a remote HTTP/SSE endpoint (with token headers or OAuth) or a local stdio command bundled in the plugin directory.
2. **Provider plugins (`providers`)**: Expose model providers (compatible with OpenCode provider plugins) declared under `extensions["com.hob.plugins"].providers`, with locked dependencies in `package.json` and `bun.lock`.

## Directory & manifest requirements

Create one directory at the repository root named after the plugin ID.

- **Plugin ID**: `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$` (letters, digits, `_`, or `-`, starting with a letter or digit, max 64 chars).
- **No symlinks**: Symbolic links anywhere inside a plugin directory are rejected by `scripts/build-index.mjs`.
- **Self-contained**: Put every required file (icon, scripts, tests, optional `skills/`) inside the plugin directory.

### `plugin.json`

Required and commonly used fields:

- `name`: Plugin identifier (matches the directory name).
- `displayName`: Short human-readable name shown in the marketplace.
- `version`: Semver string (e.g. `"1.0.0"`). Bump this whenever the plugin changes.
- `description`: Brief summary of what the plugin does.
- `homepage` (recommended): Upstream project or documentation URL.
- `userConfig` (optional): Map of user-configurable fields (`type`: `string`, `number`, `boolean`, `file`, or `directory`; optional `title`, `description`, `required`, `default`, `options`, `multiple`, `sensitive`, `min`, `max`). Mark all tokens, API keys, and passwords with `"sensitive": true`.
- `extensions["com.hob.plugins"]`:
  - `icon`: Relative path to the plugin icon (SVG preferred, e.g. `"icon.svg"`). Use an official brand asset under a compatible open license (such as MIT LobeHub icons) or your own artwork.
  - `publisher`: Organization or maintainer name.
  - `sourceUrl`: Upstream source repository URL (required for community/provider plugins).
  - `categories`: One or more standard slugs from: `providers`, `communication`, `productivity`, `development`, `data`, `search`, `design`, `media`, `finance`, `home`, `other`.
  - `profiles`: Optional `{ "title": "…" }` for plugins that support multiple accounts/profiles (referenced via `${hob.profiles}`; cannot be combined with OAuth or individual `${user_config.*}` references).
  - `permissions`: Declare capabilities used by the plugin from:
    - `network` — outbound network requests
    - `subprocess` — spawns local CLI processes
    - `local_credentials` — reads existing local login state on the Hob host
    - `bun_runtime` — uses the pinned Bun runtime (provider plugins)
  - For **community / unofficial / provider plugins**, also include:
    - `unofficial`: `true`
    - `reviewedVersion`: Exact upstream package version reviewed (semver)
    - `summary`: `{ "zh": "...", "en": "..." }` (short card summary)
    - `description`: `{ "zh": "...", "en": "..." }` (detail page description)
    - `risk`: `{ "zh": "...", "en": "..." }` (clear disclosure of ToS/account risk and local access)
    - `providers`: Array of `{ "package", "version", "integrity", "tarball"? }`

### Tool plugin (`mcp.json`)

Define `mcpServers` mapping service names to either a remote `url` or a local `command`/`args`:

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

Available template variables:
- `${user_config.KEY}` — value from `userConfig`
- `${hob.root}` — Hob installation directory
- `${hob.plugin_root}` — installed plugin directory
- `${hob.plugin_data}` — persistent data directory for this plugin
- `${hob.profiles}` — multi-profile configuration (when `profiles` is declared)

See [`github/`](github/), [`cloudflare/`](cloudflare/), [`email/`](email/), and [`bitwarden/`](bitwarden/) for working examples.

### Provider plugin (`providers`, `package.json`, `bun.lock`)

Provider plugins must lock both the top-level package and the entire dependency tree:

1. In `plugin.json`, declare each provider under `extensions["com.hob.plugins"].providers` with:
   - `package`: exact npm package name
   - `version`: exact semver (no ranges like `^` or `~`)
   - `integrity`: `sha512-...` SRI hash of the package tarball
   - `tarball` (optional): `https://` URL if not fetched from the default npm registry
2. Add `package.json` (`"private": true`) whose `dependencies` match `plugin.json` **1:1** (`package -> tarball ?? version`).
3. Generate and commit `bun.lock` inside the plugin directory (`bun install --lockfile-only` or `bun install`) so the full transitive dependency tree is pinned.

You can compute a tarball's SRI hash with:

```bash
curl -sL "<tarball-url>" | openssl dgst -sha512 -binary | openssl base64 -A | sed 's/^/sha512-/'
```

For packages on npm, `npm view <pkg>@<version> dist.integrity` prints the `sha512-...` value directly.

See [`copilot/`](copilot/) and [`zcode/`](zcode/) for working examples.

## Step-by-step workflow

1. **Fork and branch** from `main` (keep one plugin addition or update per PR).
2. **Add or update** the plugin directory and bump `version` in `plugin.json` (for provider updates, also update `reviewedVersion`, `integrity`, `package.json`, and `bun.lock`).
3. **Rebuild and validate the index**:
   ```bash
   node scripts/build-index.mjs
   ```
   Make sure the script exits with code `0` and commit the updated `index.json`.
4. **Test in Hob**:
   - Push your branch to your fork (or serve the directory over HTTP) and add it as a custom plugin source in Hob.
   - Verify installation, configuration/sign-in, basic tool or model calls, and uninstall/re-enable behavior.
   - If your plugin includes local scripts (like `bitwarden/`), add or run automated tests and include the result in your PR.
5. **Commit** using English [Conventional Commits](https://www.conventionalcommits.org/):
   - Title: `type(scope): subject` (`feat`, `fix`, `docs`, `chore`, imperative mood, ≤ 72 chars), e.g. `feat(linear): add Linear MCP plugin` or `fix(bitwarden): handle empty vault response`.
   - Body: explain why and what changed.
6. **Open a Pull Request** against `FFatTiger/hob-plugins` `main` and fill out the PR template.

## Security & review checklist

Every PR undergoes a security and functionality review before merge. To avoid back-and-forth, make sure your submission meets these rules:

- **Credentials & secrets**: Never hardcode API keys, tokens, cookies, or private URLs. Mark all secret inputs `"sensitive": true` in `userConfig`. Plugins must not leak passwords or raw secrets into assistant/model context.
- **No obfuscation or hidden execution**: Source code and upstream packages must be readable and auditable. No unexpected shell execution, unapproved auto-updaters, or undisclosed outbound endpoints.
- **Supply-chain pinning**: Provider plugins must pin exact semver, `sha512-...` integrity, `package.json`, and `bun.lock`. Avoid floating versions (`latest`, `^`, `~`) or unpinned remote scripts.
- **Honest permissions & risk notices**: Accurately list `permissions` (`network`, `subprocess`, `local_credentials`, `bun_runtime`) and clearly state any ToS or local-access risks in `risk` (`zh` and `en`).
- **License**: Contributions to this repository are licensed under [MIT](LICENSE). Ensure included files and icons are compatible.

## Updating or fixing an existing plugin

- Bump `version` in `plugin.json` using semver (`patch` for fixes, `minor` for backwards-compatible additions, `major` for breaking config/behavior changes).
- Note any newly required `userConfig` fields or `permissions` in the PR description (Hob prompts users to re-approve when a plugin's declared capabilities expand).
- Run `node scripts/build-index.mjs` and commit `index.json` if the file list changed.
