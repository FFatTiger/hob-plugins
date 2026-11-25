// Identity resolution and GitHub API helpers for the GitHub 2.0 plugin.
// Priority: 1. GitHub App (JWT + installation token) > 2. hob-bot login > 3. Personal Access Token.

import { sign as cryptoSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const REFRESH_BUFFER_MS = 5 * 60 * 1000;
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

function expandHome(filePath) {
  if (filePath.startsWith("~/")) return join(homedir(), filePath.slice(2));
  return filePath;
}

function base64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

export function signAppJwt(appId, privateKeyPem, nowSec = Math.floor(Date.now() / 1000)) {
  const header = base64urlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64urlJson({
    iat: nowSec - 60,
    exp: nowSec + 9 * 60,
    iss: String(appId),
  });
  const signingInput = `${header}.${payload}`;
  const signature = cryptoSign("RSA-SHA256", Buffer.from(signingInput, "utf8"), privateKeyPem).toString("base64url");
  return `${signingInput}.${signature}`;
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
  const now = options.now || (() => Date.now());

  const appConfigured = Boolean(appId && privateKeyPath);
  let cachedPrivateKey = null;
  let cachedAppInfo = null;
  const installationTokenCache = new Map(); // installationId -> { token, expiresAtMs }

  function loadPrivateKey() {
    if (cachedPrivateKey) return cachedPrivateKey;
    try {
      cachedPrivateKey = readFileSync(expandHome(privateKeyPath), "utf8");
      return cachedPrivateKey;
    } catch (error) {
      throw new AuthError(`无法读取 GitHub App 私钥文件（${privateKeyPath}）：${error.message}`, { code: "app_key_error" });
    }
  }

  function createJwt() {
    const pem = loadPrivateKey();
    return signAppJwt(appId, pem, Math.floor(now() / 1000));
  }

  async function githubApi(path, { method = "GET", token, allow404 = false } = {}) {
    const headers = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "hob-github-plugin/2.0.0",
    };
    if (token) headers.authorization = `Bearer ${token}`;

    const response = await fetchImpl(`${apiBase}${path}`, { method, headers });
    if (allow404 && response.status === 404) {
      await response.body?.cancel?.().catch(() => {});
      return null;
    }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
    if (!response.ok) {
      const detail = data?.message || text.trim() || `HTTP ${response.status}`;
      throw new AuthError(`GitHub API ${method} ${path} 失败（HTTP ${response.status}）：${detail}`, { code: "api_error" });
    }
    return data;
  }

  async function getAppInfo() {
    if (!appConfigured) return null;
    if (cachedAppInfo) return cachedAppInfo;
    try {
      const jwt = createJwt();
      const info = await githubApi("/app", { token: jwt, allow404: true });
      if (info && typeof info === "object") cachedAppInfo = info;
    } catch {
      // Best effort: fall back to generic install URL if /app cannot be read.
    }
    return cachedAppInfo;
  }

  async function getAppInstallUrl() {
    const info = await getAppInfo();
    if (info?.slug) return `${webBase}/apps/${encodeURIComponent(info.slug)}/installations/new`;
    if (typeof info?.html_url === "string" && info.html_url) {
      return `${info.html_url.replace(/\/+$/, "")}/installations/new`;
    }
    return `${webBase}/settings/apps`;
  }

  async function findAppInstallation(scope = {}) {
    const jwt = createJwt();
    const { owner, repo } = scope;
    if (owner && repo) {
      return await githubApi(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/installation`,
        { token: jwt, allow404: true },
      );
    }
    if (owner) {
      const userInst = await githubApi(`/users/${encodeURIComponent(owner)}/installation`, { token: jwt, allow404: true });
      if (userInst) return userInst;
      return await githubApi(`/orgs/${encodeURIComponent(owner)}/installation`, { token: jwt, allow404: true });
    }
    const list = await githubApi("/app/installations", { token: jwt });
    return Array.isArray(list) && list.length > 0 ? list[0] : null;
  }

  async function getInstallationToken(installationId) {
    const key = String(installationId);
    const cached = installationTokenCache.get(key);
    if (cached && now() < cached.expiresAtMs - REFRESH_BUFFER_MS) {
      return cached.token;
    }
    const jwt = createJwt();
    const data = await githubApi(`/app/installations/${encodeURIComponent(key)}/access_tokens`, {
      method: "POST",
      token: jwt,
    });
    if (!data?.token) {
      throw new AuthError("GitHub 未返回 App 安装令牌", { code: "app_token_error" });
    }
    const parsedExpiry = typeof data.expires_at === "string" ? Date.parse(data.expires_at) : NaN;
    const expiresAtMs = Number.isFinite(parsedExpiry) ? parsedExpiry : now() + 60 * 60 * 1000;
    installationTokenCache.set(key, { token: data.token, expiresAtMs });
    return data.token;
  }

  async function resolveToken(scope = {}) {
    let appNotInstalled = false;

    // 1. GitHub App identity
    if (appConfigured) {
      const installation = await findAppInstallation(scope);
      if (installation?.id !== undefined) {
        const token = await getInstallationToken(installation.id);
        return { token, source: "app", installationId: installation.id };
      }
      appNotInstalled = true;
    }

    // 2. hob-bot login identity (added in step 3)

    // 3. Personal access token
    if (pat) {
      return { token: pat, source: "pat" };
    }

    if (appNotInstalled) {
      const installUrl = await getAppInstallUrl();
      const target = scope.owner || "";
      const msg = target
        ? `这个 App 没有装在 ${target} 上，也没有登录或令牌。安装链接：${installUrl}`
        : `这个 App 没有装在任何账号或组织上，也没有登录或令牌。安装链接：${installUrl}`;
      throw new AuthError(msg, { code: "app_not_installed" });
    }

    throw new AuthError(NO_AUTH_MESSAGE, { code: "no_auth" });
  }

  return {
    config: {
      pat,
      appId,
      privateKeyPath,
      appConfigured,
      pluginDataDir,
      attribution,
      apiBase,
      webBase,
      mcpUrl,
    },
    fetchImpl,
    githubApi,
    getAppInfo,
    getAppInstallUrl,
    resolveToken,
  };
}
