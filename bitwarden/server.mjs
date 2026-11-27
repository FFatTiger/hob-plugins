import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const sdkRoot = process.env.BW_MCP_SDK_ROOT || process.env.BW_NODE_ROOT;
if (!sdkRoot) throw new Error("BW_MCP_SDK_ROOT 未配置");
const requireFromSdk = createRequire(join(sdkRoot, "package.json"));
const { McpServer } = requireFromSdk("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = requireFromSdk("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = requireFromSdk("zod");

const bwPath = process.env.BW_CLI_PATH;
const session = process.env.BW_SESSION;
if (!bwPath || !session) throw new Error("Bitwarden CLI 未配置");

class BwError extends Error {
  constructor(message) {
    super(message);
    this.name = "BwError";
  }
}

function reasonFrom(error, hidden = []) {
  const raw = String(error?.stderr || error?.message || error);
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("at ") && !line.startsWith("node:"));
  let reason = lines.slice(-2).join(" ") || "Bitwarden 命令失败";
  for (const value of hidden) {
    if (value) reason = reason.split(String(value)).join("[已隐藏]");
  }
  return reason;
}

function runBw(args, hidden = []) {
  try {
    const command = bwPath.endsWith(".mjs") ? process.execPath : bwPath;
    const commandArgs = bwPath.endsWith(".mjs") ? [bwPath, ...args, "--session", session] : [...args, "--session", session];
    return execFileSync(command, commandArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 4 * 1024 * 1024,
    }).trim();
  } catch (error) {
    throw new BwError(reasonFrom(error, [session, ...hidden]));
  }
}

function jsonFrom(value, what) {
  try {
    return JSON.parse(value || "null");
  } catch {
    throw new BwError(`Bitwarden 返回的${what}不是有效 JSON`);
  }
}

function listFolders() {
  const value = jsonFrom(runBw(["list", "folders"]), "文件夹列表");
  return Array.isArray(value) ? value : [];
}

function folderByName(name) {
  return listFolders().find((folder) => folder && folder.name === name);
}

function ensureFolder(name) {
  if (!name) return undefined;
  const found = folderByName(name);
  if (found?.id) return found;
  const created = jsonFrom(runBw(["create", "folder", JSON.stringify({ name })], [name]), "新文件夹");
  if (!created?.id) throw new BwError("Bitwarden 没有返回新文件夹的 id");
  return created;
}

const DEFAULT_MATCH_MODES = new Map([
  ["基础域名", 0], ["0", 0],
  ["主机", 1], ["1", 1],
  ["开始于", 2], ["2", 2],
  ["精确", 3], ["3", 3],
  ["从不", 5], ["5", 5],
]);

function defaultUriMatch() {
  const raw = String(process.env.BW_DEFAULT_URI_MATCH ?? "").trim();
  return DEFAULT_MATCH_MODES.get(raw) ?? 0;
}

function uriText(entry) {
  return typeof entry === "string" ? entry : (typeof entry?.uri === "string" ? entry.uri : "");
}

function itemUri(item) {
  if (!Array.isArray(item?.login?.uris)) return [];
  const fallback = defaultUriMatch();
  return item.login.uris.flatMap((entry) => {
    if (typeof entry === "string") return entry ? [{ uri: entry, match: fallback }] : [];
    if (!entry || typeof entry !== "object" || typeof entry.uri !== "string" || !entry.uri) return [];
    const match = Number.isInteger(entry.match) && entry.match >= 0 && entry.match <= 5 ? entry.match : fallback;
    return [{ uri: entry.uri, match }];
  });
}

function isLogin(item) {
  return item && (item.type === undefined || item.type === 1) && item.login && typeof item.login === "object";
}

function listItems(search) {
  const args = ["list", "items"];
  if (search) args.push("--search", search);
  const value = jsonFrom(runBw(args), "登录列表");
  return (Array.isArray(value) ? value : []).filter(isLogin);
}

function credentialLogin(item, folders) {
  const folder = folders.find((entry) => entry.id === item.folderId)?.name;
  const uris = itemUri(item);
  return {
    id: String(item.id),
    name: String(item.name || ""),
    username: String(item.login?.username || ""),
    uris,
    ...(folder ? { folder } : {}),
    hasPassword: typeof item.login?.password === "string" && item.login.password.length > 0,
    hasTotp: typeof item.login?.totp === "string" && item.login.totp.length > 0,
  };
}

function getLogins({ search, folder }) {
  const folders = listFolders();
  if (folder && !folders.some((entry) => entry.name === folder)) return [];
  const folderId = folder ? folders.find((entry) => entry.name === folder).id : undefined;
  return listItems(search)
    .filter((item) => folderId === undefined || item.folderId === folderId)
    .map((item) => credentialLogin(item, folders));
}

function hostOf(uri) {
  try { return new URL(uri).host || uri; } catch { return uri; }
}

function loginLabel(login, separator = "、") {
  const contents = [];
  if (login.hasPassword) contents.push("密码");
  if (login.hasTotp) contents.push("两步验证");
  return contents.length ? contents.join(separator) : "无";
}

// 列表卡的一行：第一行名称，第二行用户名 · 网站的主机名；右边小字写存了哪些内容（Hob 把 interactive_container 里第一行当标题、后面的当灰色小字）
function loginRow(login) {
  const username = login.username || "（无用户名）";
  const firstUri = uriText(login.uris[0]);
  const uri = firstUri ? hostOf(firstUri) : "（无网址）";
  return {
    tag: "interactive_container",
    elements: [
      { tag: "div", text: `${login.name}\n${username} · ${uri}` },
      { tag: "div", text: loginLabel(login, " · ") },
    ],
  };
}

function listCard(title, logins) {
  const rows = logins.slice(0, 50).map(loginRow);
  const elements = rows.slice(0, 20);
  if (rows.length > 20) {
    elements.push({
      tag: "collapsible_panel",
      header: { title: `其余 ${rows.length - 20} 个` },
      expanded: false,
      elements: rows.slice(20),
    });
  }
  return {
    header: { title, subtitle: `${logins.length} 个登录` },
    body: { elements },
  };
}

function textResult(text, meta) {
  return { content: [{ type: "text", text }], ...(meta ? { _meta: meta } : {}) };
}

function emptyResult(structuredContent) {
  return { content: [], structuredContent };
}

function formValue(action) {
  return action?.form_value && typeof action.form_value === "object" ? action.form_value : {};
}

function valueOf(values, name) {
  const value = values[name];
  return value === undefined || value === null ? "" : String(value);
}

/** 卡片里选的文件夹；选的是「不放进文件夹」就是空。 */
function folderOf(values) {
  const folder = valueOf(values, "folder");
  return folder === NO_FOLDER ? "" : folder;
}

// 结果行：标签栏窄、值栏宽（Hob 按 weight 分栏）；最后一句用 Hob 的结果行（勾 + 灰字）
function savedCard(values, folder, status) {
  const name = valueOf(values, "name");
  const url = valueOf(values, "url");
  const username = valueOf(values, "username");
  const password = valueOf(values, "password");
  const row = (label, value) => ({ tag: "column_set", background_style: "light", columns: [{ weight: 1, elements: [{ tag: "div", text: label }] }, { weight: 5, elements: [{ tag: "div", text: value }] }] });
  const elements = [row("名称", name), row("网址", url || "（没填）"), row("用户名", username || "（没填）"), row("密码", password ? "已填写" : "未填写")];
  elements.push({ tag: "div", icon: "check", text: status || (folder ? `已保存到「${folder}」` : "已保存") });
  return { header: { title: "保存登录信息" }, body: { elements } };
}

// 文件夹下拉里「不放进文件夹」那一项的 value：Hob 要求选项的 value 非空，回调时再换回空
const NO_FOLDER = "__none__";

function saveLoginCard({ name, url, username, folder } = {}) {
  const folders = listFolders();
  const options = [
    ...folders.filter((entry) => entry && typeof entry.name === "string").map((entry) => ({ text: entry.name, value: entry.name })),
    { text: "不放进文件夹", value: NO_FOLDER },
  ];
  const folderInitial = folder && folders.some((entry) => entry.name === folder) ? { initial_option: folder } : {};
  return {
    config: { callback_tool: "save_login_submit" },
    header: { title: "保存登录信息" },
    body: {
      elements: [{
        tag: "form",
        name: "login",
        elements: [
          { tag: "column_set", columns: [
            { weight: 1, elements: [{ tag: "input", name: "name", label: "名称", default_value: name || "", required: true }] },
            { weight: 1, elements: [{ tag: "select_static", name: "folder", label: "文件夹", options, placeholder: "不放进文件夹", display: "dropdown", ...folderInitial }] },
          ] },
          { tag: "input", name: "url", label: "网址", default_value: url || "", input_type: "text" },
          { tag: "input", name: "username", label: "用户名", default_value: username || "", input_type: "text" },
          { tag: "input", name: "password", label: "密码", required: true, input_type: "password", generate: true },
          { tag: "button", name: "cancel", text: "取消", type: "default" },
          { tag: "button", name: "save", text: "保存", type: "primary_filled", form_action_type: "submit" },
        ],
      }],
    },
  };
}

function existingLogin(values) {
  const name = valueOf(values, "name");
  const username = valueOf(values, "username");
  const url = valueOf(values, "url");
  return getLogins({}).some((login) => login.name === name && login.username === username && login.uris.some((entry) => uriText(entry) === url));
}

function getItem(id) {
  const item = jsonFrom(runBw(["get", "item", id], [id]), "登录");
  if (!isLogin(item)) throw new BwError("Bitwarden 里没有这个登录");
  return item;
}

function saveCredential({ id, name, uris, username, password, folder } = {}) {
  const existing = id ? getItem(id) : undefined;
  let folderId = existing?.folderId;
  let folderName = folder;
  if (folder !== undefined) {
    const selected = folder ? ensureFolder(folder) : undefined;
    folderId = selected?.id;
    folderName = selected?.name || undefined;
  } else if (existing?.folderId) {
    const current = listFolders().find((entry) => entry.id === existing.folderId);
    folderName = current?.name;
  }
  const login = {
    ...(existing?.login || {}),
    username: username || "",
    password,
    uris: (Array.isArray(uris) ? uris : []).map((uri) => ({ uri })),
  };
  const payload = existing
    ? { ...existing, name, folderId, login }
    : { type: 1, name, ...(folderId ? { folderId } : {}), login };
  if (!folderId) delete payload.folderId;
  const command = existing ? ["edit", "item", id, JSON.stringify(payload)] : ["create", "item", JSON.stringify(payload)];
  const result = jsonFrom(runBw(command, [password, name, username]), "保存结果");
  if (!result?.id && !existing?.id) throw new BwError("Bitwarden 没有返回登录的 id");
  runBw(["sync"], [password]);
  return { id: String(result?.id || existing.id), ...(folderName ? { folder: folderName } : {}) };
}

function getSecret(id) {
  const item = getItem(id);
  const secret = { username: String(item.login.username || ""), password: String(item.login.password || "") };
  if (item.login.totp) {
    const totp = runBw(["get", "totp", id], [secret.password]);
    if (totp) secret.totp = totp;
  }
  return secret;
}

function deleteCredential(id) {
  getItem(id);
  runBw(["delete", "item", id, "--permanent"], [id]);
  runBw(["sync"]);
  return {};
}

const appOnly = (role) => ({ ui: { visibility: ["app"] }, "hob/credentials": role });
const emptyObject = z.object({});
const loginInput = z.object({ search: z.string().optional(), folder: z.string().optional() });
const saveFormInput = z.object({ card_id: z.string(), action: z.any() });
const secretInput = z.object({ id: z.string() });
const generateInput = z.object({ length: z.number(), lowercase: z.boolean(), uppercase: z.boolean(), numbers: z.boolean(), symbols: z.boolean() });
const saveInput = z.object({ id: z.string().optional(), name: z.string(), uris: z.array(z.string()), username: z.string(), password: z.string(), folder: z.string().optional() });

const server = new McpServer({ name: "bitwarden", version: "2.2.0" }, { capabilities: { tools: {} } });

server.registerTool("list_logins", {
  description: "列出 Bitwarden 里存的登录：名称、用户名、网址、所在文件夹、存了哪些内容（密码、两步验证）。不返回密码。参数 search 按名称、用户名或网址筛选，folder 只看某个文件夹，都可以不填。结果同时显示成一张列表卡给用户看。",
  inputSchema: loginInput,
}, async ({ search, folder }) => {
  const logins = getLogins({ search, folder });
  if (!logins.length) {
    return textResult(search ? `Bitwarden 里没有匹配「${search}」的登录。` : "Bitwarden 里没有登录。");
  }
  const shown = logins.slice(0, 50);
  const lines = [`共 ${logins.length} 条`, ...shown.map((login) => `${login.name} · ${login.username} · ${uriText(login.uris[0])} · ${login.folder || "无文件夹"} · 存了：${loginLabel(login)}`)];
  if (logins.length > 50) lines.push(`还有 ${logins.length - 50} 条，用 search 缩小范围`);
  return textResult(lines.join("\n"), { "hob/card": listCard(folder || "Bitwarden 里的登录", logins) });
});

server.registerTool("save_login", {
  description: "出一张卡片，让用户把一个登录存进 Bitwarden：名称、文件夹、网址、用户名、密码。密码由用户在卡片里填或点「生成」，直接交给 Bitwarden，不经过你。参数都是预填到卡片上的值，可以不填。用户保存或取消后会告诉你结果。",
  inputSchema: z.object({ name: z.string().optional(), url: z.string().optional(), username: z.string().optional(), folder: z.string().optional() }),
}, async (values) => textResult("保存登录的卡片已显示给用户，用户填好保存后会告诉你结果。", { "hob/card": saveLoginCard(values) }));

server.registerTool("save_login_submit", {
  description: "保存登录卡片的回调。",
  inputSchema: saveFormInput,
  _meta: { ui: { visibility: ["app"] } },
}, async ({ action }) => {
  const values = formValue(action);
  const button = action?.name || action?.value?.name || action?.value?.action;
  if (button === "cancel") {
    return textResult("用户取消了保存登录。", { "hob/card": savedCard(values, undefined, "已取消") });
  }
  const password = valueOf(values, "password");
  try {
    if (existingLogin(values)) {
      return { content: [], _meta: { "hob/errors": { name: "Bitwarden 里已经有这一条了" } } };
    }
    const result = saveCredential({
      name: valueOf(values, "name"),
      uris: valueOf(values, "url") ? [valueOf(values, "url")] : [],
      username: valueOf(values, "username"),
      password,
      folder: folderOf(values),
    });
    const folderText = result.folder;
    return textResult(`用户在 Bitwarden 存好了登录：${valueOf(values, "name")}（${valueOf(values, "username")}），文件夹「${folderText || ""}」。`, { "hob/card": savedCard(values, folderText) });
  } catch (error) {
    return { content: [], _meta: { "hob/toast": { type: "error", content: reasonFrom(error, [password]) } } };
  }
});

server.registerTool("credentials_list", { inputSchema: emptyObject, _meta: appOnly("list") }, async () => emptyResult({ logins: getLogins({}) }));
server.registerTool("credentials_secret", { inputSchema: secretInput, _meta: appOnly("secret") }, async ({ id }) => emptyResult(getSecret(id)));
server.registerTool("credentials_generate", { inputSchema: generateInput, _meta: appOnly("generate") }, async ({ length, lowercase, uppercase, numbers, symbols }) => {
  const args = ["generate", "--length", String(length)];
  if (lowercase) args.push("--lowercase");
  if (uppercase) args.push("--uppercase");
  if (numbers) args.push("--number");
  if (symbols) args.push("--special");
  return emptyResult({ password: runBw(args) });
});
server.registerTool("credentials_save", { inputSchema: saveInput, _meta: appOnly("save") }, async (values) => emptyResult(saveCredential(values)));
server.registerTool("credentials_delete", { inputSchema: secretInput, _meta: appOnly("delete") }, async ({ id }) => emptyResult(deleteCredential(id)));

const transport = new StdioServerTransport();
await server.connect(transport);
