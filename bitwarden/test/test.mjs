import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const bitwardenRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(bitwardenRoot, "test", "fixtures", "fake-bw.mjs");
const server = join(bitwardenRoot, "server.mjs");
const candidates = [
  process.env.BW_TEST_SDK_ROOT,
  join(process.cwd(), "../hob/.worktrees/lane2"),
  join(bitwardenRoot, "../../../../../hob/.worktrees/lane2"),
].filter(Boolean).map((root) => resolve(root));
const sdkRoot = candidates.find((root) => {
  try { return Boolean(readFileSync(join(root, "node_modules/@modelcontextprotocol/sdk/package.json"))); } catch { return false; }
});
if (!sdkRoot) throw new Error("测试需要 BW_TEST_SDK_ROOT 指向已安装 Hob 依赖的目录");
const requireFromHob = createRequire(join(sdkRoot, "package.json"));
const { Client } = requireFromHob("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = requireFromHob("@modelcontextprotocol/sdk/client/stdio.js");

const LIST_SECRET = "unique-list-password-must-never-leak";

function initialDatabase() {
  return {
    folders: [{ id: "folder-forum", name: "论坛账号" }],
    items: [
      {
        id: "login-forum",
        type: 1,
        name: "Example 论坛",
        folderId: "folder-forum",
        login: {
          username: "lin@example.com",
          password: LIST_SECRET,
          totp: "otpauth://totp/example",
          uris: [{ uri: "https://forum.example.net/login" }],
          extraField: "preserve me",
        },
      },
      { id: "login-photo", type: 1, name: "摄影社区", login: { username: "linphoto", password: "photo-secret", uris: [{ uri: "https://photo.example.org" }] } },
      { id: "login-book", type: 1, name: "二手书市", login: { username: "lin@example.com", password: "book-secret", uris: [{ uri: "https://books.example.com" }] } },
    ],
  };
}

async function withClient(options, callback) {
  const root = mkdtempSync(join(process.env.TMPDIR || "/tmp", "bitwarden-plugin-test-"));
  const db = join(root, "vault.json");
  writeFileSync(db, `${JSON.stringify(initialDatabase(), null, 2)}\n`);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server],
    env: {
      ...process.env,
      BW_CLI_PATH: fixture,
      BW_FAKE_DB: db,
      BW_MCP_SDK_ROOT: sdkRoot,
      BW_SESSION: "fake-session",
      ...(options?.fail ? { BW_FAKE_FAIL: "1" } : {}),
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "bitwarden-plugin-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    await callback(client, db);
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function resultJson(result) {
  return JSON.stringify(result);
}

test("暴露的工具、app-only visibility 和凭据角色正确", async () => {
  await withClient({}, async (client) => {
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [
      "credentials_delete", "credentials_generate", "credentials_list", "credentials_save", "credentials_secret",
      "list_logins", "save_login", "save_login_submit",
    ].sort());
    for (const role of ["list", "secret", "generate", "save", "delete"]) {
      const tool = tools.find((entry) => entry._meta?.["hob/credentials"] === role);
      assert.ok(tool);
      assert.deepEqual(tool._meta.ui.visibility, ["app"]);
    }
    assert.deepEqual(tools.find((entry) => entry.name === "save_login_submit")._meta.ui.visibility, ["app"]);
  });
});

test("list_logins 只返回登录概况和列表卡，不泄露密码", async () => {
  await withClient({}, async (client) => {
    const result = await client.callTool({ name: "list_logins", arguments: {} });
    assert.match(result.content[0].text, /共 3 条/);
    assert.match(result.content[0].text, /Example 论坛 · lin@example.com · https:\/\/forum.example.net\/login · 论坛账号 · 存了：密码、两步验证/);
    assert.equal(result._meta["hob/card"].header.title, "Bitwarden 里的登录");
    assert.equal(result._meta["hob/card"].header.subtitle, "3 个登录");
    assert.ok(!resultJson(result).includes(LIST_SECRET));
    const empty = await client.callTool({ name: "list_logins", arguments: { search: "不存在的站点" } });
    assert.equal(empty._meta, undefined);
    assert.equal(empty.content[0].text, "Bitwarden 里没有匹配「不存在的站点」的登录。");
  });
});

test("save_login 出表单，回调支持取消、保存、重复和错误", async () => {
  await withClient({}, async (client, db) => {
    const shown = await client.callTool({ name: "save_login", arguments: { name: "新论坛", url: "https://new.example", username: "new@example.com", folder: "论坛账号" } });
    const card = shown._meta["hob/card"];
    assert.equal(card.config.callback_tool, "save_login_submit");
    const inputs = JSON.stringify(card);
    assert.match(inputs, /"input_type":"password"/);
    assert.match(inputs, /"min_length":10/);
    assert.match(inputs, /"generate":true/);
    assert.match(inputs, /"论坛账号"/);
    assert.ok(!inputs.includes(LIST_SECRET));

    const cancelled = await client.callTool({ name: "save_login_submit", arguments: {
      card_id: "card-cancel", action: { tag: "button", name: "cancel", form_value: { name: "新论坛", password: "cancel-secret" } },
    } });
    assert.equal(cancelled.content[0].text, "用户取消了保存登录。");
    assert.ok(!resultJson(cancelled).includes("cancel-secret"));

    const saved = await client.callTool({ name: "save_login_submit", arguments: {
      card_id: "card-save", action: { tag: "button", name: "save", form_value: { name: "新论坛", folder: "新文件夹", url: "https://new.example", username: "new@example.com", password: "new-password-secret" } },
    } });
    assert.equal(saved.content[0].text, "用户在 Bitwarden 存好了登录：新论坛（new@example.com），文件夹「新文件夹」。");
    assert.match(saved._meta["hob/card"].body.elements.at(-1).text, /新文件夹/);
    assert.ok(!resultJson(saved).includes("new-password-secret"));
    const database = JSON.parse(readFileSync(db, "utf8"));
    const created = database.items.find((item) => item.name === "新论坛");
    assert.equal(created.login.password, "new-password-secret");
    assert.equal(database.folders.at(-1).name, "新文件夹");

    const duplicate = await client.callTool({ name: "save_login_submit", arguments: {
      card_id: "card-duplicate", action: { tag: "button", name: "save", form_value: { name: "Example 论坛", url: "https://forum.example.net/login", username: "lin@example.com", password: "another-secret" } },
    } });
    assert.equal(duplicate.content.length, 0);
    assert.equal(duplicate._meta["hob/errors"].name, "Bitwarden 里已经有这一条了");
    assert.ok(!resultJson(duplicate).includes("another-secret"));
  });

  await withClient({ fail: true }, async (client) => {
    const failed = await client.callTool({ name: "save_login_submit", arguments: {
      card_id: "card-error", action: { tag: "button", name: "save", form_value: { name: "失败登录", url: "https://fail.example", username: "fail@example.com", password: "error-secret" } },
    } });
    assert.equal(failed.content.length, 0);
    assert.equal(failed._meta["hob/toast"].type, "error");
    assert.match(failed._meta["hob/toast"].content, /拒绝保存/);
    assert.ok(!resultJson(failed).includes("error-secret"));
  });
});

test("五个凭据工具返回 structuredContent，支持取秘密、生成、更新和删除", async () => {
  await withClient({}, async (client, db) => {
    const listed = await client.callTool({ name: "credentials_list", arguments: {} });
    assert.deepEqual(listed.content, []);
    assert.equal(listed.structuredContent.logins.length, 3);
    assert.ok(!resultJson(listed).includes(LIST_SECRET));

    const secret = await client.callTool({ name: "credentials_secret", arguments: { id: "login-forum" } });
    assert.deepEqual(secret.structuredContent, { username: "lin@example.com", password: LIST_SECRET, totp: "123456" });

    const generated = await client.callTool({ name: "credentials_generate", arguments: { length: 20, lowercase: true, uppercase: true, numbers: true, symbols: true } });
    assert.match(generated.structuredContent.password, /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*-])[A-Za-z\d!@#$%^&*-]{20}$/);
    const alnumOnly = await client.callTool({ name: "credentials_generate", arguments: { length: 12, lowercase: true, uppercase: true, numbers: true, symbols: false } });
    assert.match(alnumOnly.structuredContent.password, /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d]{12}$/);

    const saved = await client.callTool({ name: "credentials_save", arguments: {
      id: "login-forum", name: "Example 论坛", uris: ["https://forum.example.net/new-login"], username: "updated@example.com", password: "updated-secret", folder: "更新后的文件夹",
    } });
    assert.equal(saved.structuredContent.id, "login-forum");
    assert.equal(saved.structuredContent.folder, "更新后的文件夹");
    const database = JSON.parse(readFileSync(db, "utf8"));
    const updated = database.items.find((item) => item.id === "login-forum");
    assert.equal(updated.login.totp, "otpauth://totp/example");
    assert.equal(updated.login.extraField, "preserve me");
    assert.equal(updated.login.password, "updated-secret");

    const deleted = await client.callTool({ name: "credentials_delete", arguments: { id: "login-social" } });
    assert.deepEqual(deleted.structuredContent ?? {}, {});
    assert.ok(!JSON.parse(readFileSync(db, "utf8")).items.some((item) => item.id === "login-social"));
  });
});
