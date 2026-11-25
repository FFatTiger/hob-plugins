// Identity resolution and GitHub API helpers for the GitHub 2.0 plugin.

export const NO_AUTH_MESSAGE =
  "未配置 GitHub 身份。请在插件页面点击「登录」（hob-bot），或在配置中填写 GitHub App（GITHUB_APP_ID 和 GITHUB_APP_PRIVATE_KEY_PATH），或填写个人访问令牌（GITHUB_PERSONAL_ACCESS_TOKEN）。";

export class AuthError extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

export function parseBooleanConfig(value, defaultValue = true) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  return defaultValue;
}

export function extractScopeFromArgs(args) {
  if (!args || typeof args !== "object") return {};
  let owner = typeof args.owner === "string" && args.owner.trim() ? args.owner.trim() : undefined;
  if (!owner && typeof args.org === "string" && args.org.trim()) owner = args.org.trim();
  let repo = typeof args.repo === "string" && args.repo.trim() ? args.repo.trim() : undefined;

  if (!owner && repo && repo.includes("/")) {
    const parts = repo.split("/").filter(Boolean);
    if (parts.length >= 2) {
      owner = parts[0];
      repo = parts[1];
    }
  }
  if (!owner && typeof args.repository === "string" && args.repository.includes("/")) {
    const parts = args.repository.trim().split("/").filter(Boolean);
    if (parts.length >= 2) {
      owner = parts[0];
      if (!repo) repo = parts[1];
    }
  }
  return { ...(owner ? { owner } : {}), ...(repo ? { repo } : {}) };
}

export function createAuthManager(env = process.env, options = {}) {
  const pat = (env.GITHUB_PERSONAL_ACCESS_TOKEN || "").trim();
  const appId = (env.GITHUB_APP_ID || "").trim();
  const privateKeyPath = (env.GITHUB_APP_PRIVATE_KEY_PATH || "").trim();
  const pluginDataDir = (env.GITHUB_PLUGIN_DATA || "").trim();
  const attribution = parseBooleanConfig(env.GITHUB_ATTRIBUTION, true);
  const apiBase = (env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
  const webBase = (env.GITHUB_WEB_URL || "https://github.com").replace(/\/+$/, "");
  const mcpUrl = (env.GITHUB_MCP_URL || "https://api.githubcopilot.com/mcp/").trim();
  const fetchImpl = options.fetch || globalThis.fetch;

  async function resolveToken(_scope = {}) {
    if (pat) {
      return { token: pat, source: "pat" };
    }
    throw new AuthError(NO_AUTH_MESSAGE, { code: "no_auth" });
  }

  return {
    config: {
      pat,
      appId,
      privateKeyPath,
      pluginDataDir,
      attribution,
      apiBase,
      webBase,
      mcpUrl,
    },
    fetchImpl,
    resolveToken,
  };
}
