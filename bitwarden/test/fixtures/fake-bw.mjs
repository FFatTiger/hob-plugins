import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const database = process.env.BW_FAKE_DB;
if (!database) throw new Error("BW_FAKE_DB 未配置");

function load() {
  return JSON.parse(readFileSync(database, "utf8"));
}

function save(value) {
  writeFileSync(database, `${JSON.stringify(value, null, 2)}\n`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const input = process.argv.slice(2);
const sessionIndex = input.indexOf("--session");
if (sessionIndex >= 0) input.splice(sessionIndex, 2);
const [command, subcommand, ...rest] = input;
const db = load();
// 真 bw 按 BITWARDENCLI_APPDATA_DIR 找登录状态：启动器给的数据目录没传到，就和真 bw 一样答「没登录」
if (process.env.BW_FAKE_APPDATA && process.env.BITWARDENCLI_APPDATA_DIR !== process.env.BW_FAKE_APPDATA) fail("You are not logged in.");

// launch.mjs 的登录解锁流程：假 bw 不真的登录，只要答得出 status / config server / login --apikey / unlock
if (command === "status") {
  process.stdout.write(`${JSON.stringify({ status: "unauthenticated", serverUrl: null, lastSync: null })}\n`);
} else if (command === "config" && subcommand === "server") {
  process.stdout.write("\n");
} else if (command === "login" && subcommand === "--apikey") {
  if (!process.env.BW_CLIENTID || !process.env.BW_CLIENTSECRET) fail("缺少 API 密钥");
} else if (command === "unlock" && subcommand === "--passwordenv") {
  if (!process.env[rest[0]]) fail("缺少主密码");
  process.stdout.write("fake-session\n");
} else if (command === "list" && subcommand === "folders") {
  process.stdout.write(`${JSON.stringify(db.folders)}\n`);
} else if (command === "list" && subcommand === "items") {
  const search = rest[rest.indexOf("--search") + 1] || "";
  const items = db.items.filter((item) => {
    if (!search) return true;
    const haystack = [item.name, item.login?.username, ...(item.login?.uris || []).map((uri) => typeof uri === "string" ? uri : uri.uri)].join(" ").toLowerCase();
    return haystack.includes(search.toLowerCase());
  });
  process.stdout.write(`${JSON.stringify(items)}\n`);
} else if (command === "get" && subcommand === "item") {
  const item = db.items.find((entry) => entry.id === rest[0]);
  if (!item) fail("没有这个登录");
  process.stdout.write(`${JSON.stringify(item)}\n`);
} else if (command === "get" && subcommand === "totp") {
  if (!db.items.some((entry) => entry.id === rest[0])) fail("没有这个登录");
  process.stdout.write("123456\n");
} else if (command === "generate") {
  // 照真 bw 的参数：--length N，--lowercase / --uppercase / --number / --special 各选一类；每类至少一个
  const length = Number(rest[rest.indexOf("--length") + 1]) || 20;
  const pools = [["--lowercase", "abcdefghijkmnpqrstuvwxyz"], ["--uppercase", "ABCDEFGHJKLMNPQRSTUVWXYZ"], ["--number", "23456789"], ["--special", "!@#$%^&*-"]].filter(([flag]) => rest.includes(flag)).map(([, pool]) => pool);
  const chars = pools.map((pool) => pool[Math.floor(Math.random() * pool.length)]);
  const all = pools.join("");
  while (chars.length < length) chars.push(all[Math.floor(Math.random() * all.length)]);
  process.stdout.write(`${chars.sort(() => Math.random() - 0.5).join("")}\n`);
} else if (command === "create" && subcommand === "folder") {
  const folder = JSON.parse(rest[0]);
  const id = `folder-${db.folders.length + 1}`;
  db.folders.push({ id, name: folder.name });
  save(db);
  process.stdout.write(`${JSON.stringify({ id, name: folder.name })}\n`);
} else if (command === "create" && subcommand === "item") {
  if (process.env.BW_FAKE_FAIL === "1") fail("假 Bitwarden 拒绝保存");
  const item = JSON.parse(rest[0]);
  const created = { ...item, id: `login-${db.items.length + 1}` };
  db.items.push(created);
  save(db);
  process.stdout.write(`${JSON.stringify(created)}\n`);
} else if (command === "edit" && subcommand === "item") {
  if (process.env.BW_FAKE_FAIL === "1") fail("假 Bitwarden 拒绝保存");
  const id = rest[0];
  const replacement = JSON.parse(rest[1]);
  const index = db.items.findIndex((entry) => entry.id === id);
  if (index < 0) fail("没有这个登录");
  db.items[index] = { ...replacement, id };
  save(db);
  process.stdout.write(`${JSON.stringify(db.items[index])}\n`);
} else if (command === "delete" && subcommand === "item") {
  const id = rest[0];
  const index = db.items.findIndex((entry) => entry.id === id);
  if (index < 0) fail("没有这个登录");
  db.items.splice(index, 1);
  save(db);
  process.stdout.write("{}\n");
} else if (command === "sync") {
  process.stdout.write("{}\n");
} else {
  fail(`不支持的假 bw 命令：${input.join(" ")}`);
}
