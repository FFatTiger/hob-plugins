// 登录并解锁 Bitwarden，再启动本插件的 MCP 服务。命令行的数据放在插件数据目录，不碰本机已有的 Bitwarden 配置。
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSIONS = { "@bitwarden/cli": "2026.11.0", "@modelcontextprotocol/sdk": "1.32.2" };
const { BW_DATA, BW_SERVER, BW_CLIENTID, BW_CLIENTSECRET, BW_PASSWORD, BW_CLI_PATH: externalCli, BW_MCP_SDK_ROOT: externalSdk } = process.env;
const prefix = join(BW_DATA, "node");
const bin = (name) => join(prefix, "node_modules", ".bin", name);
const fail = (message) => { console.error(message); process.exit(1); };
// 测试可以外借一个 bw（比如假实现）和一份装好的 MCP SDK：给了就不安装、不覆盖
const bwBin = externalCli || bin("bw");
const sdkRoot = externalSdk || prefix;
const needCli = !externalCli && !existsSync(bin("bw"));
const needSdk = !externalSdk && !existsSync(join(prefix, "node_modules", "@modelcontextprotocol", "sdk", "package.json"));
if (needCli || needSdk) {
  mkdirSync(prefix, { recursive: true });
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  try {
    execFileSync(npm, ["install", "--prefix", prefix, "--no-audit", "--no-fund", "--omit=dev", ...Object.entries(VERSIONS).filter(([name]) => (name === "@bitwarden/cli" ? needCli : needSdk)).map(([n, v]) => `${n}@${v}`)], { stdio: ["ignore", "ignore", "inherit"] });
  } catch { fail("安装 Bitwarden 命令行和 MCP 服务失败，看上面 npm 的输出"); }
}

// 只把 bw 需要的变量交给它；主密码只在解锁那一步通过环境变量给
const base = { ...process.env, BITWARDENCLI_APPDATA_DIR: join(BW_DATA, "bw") };
for (const key of ["BW_SERVER", "BW_CLIENTID", "BW_CLIENTSECRET", "BW_PASSWORD", "BW_DATA", "BW_CLI_PATH", "BW_MCP_SDK_ROOT"]) delete base[key];
// 外来的 bw 如果是个 .mjs 脚本，用 node 跑它（和 server.mjs 的做法一样）
const bw = (args, env = {}) => execFileSync(bwBin.endsWith(".mjs") ? process.execPath : bwBin, bwBin.endsWith(".mjs") ? [bwBin, ...args] : args, { env: { ...base, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const run = (args, env, what) => {
  try { return bw(args, env); }
  catch (error) {
    // bw 出错会带一大段调用栈，只留说原因的那几行
    const reason = String(error.stderr || error.message).split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("at ")).slice(-2).join(" ");
    fail(`${what}失败：${reason}`);
  }
};

const server = (BW_SERVER || "https://vault.bitwarden.com").replace(/\/+$/, "");
let status = JSON.parse(run(["status"], {}, "读取 Bitwarden 状态"));
if (status.status !== "unauthenticated" && (status.serverUrl || "https://vault.bitwarden.com").replace(/\/+$/, "") !== server) {
  run(["logout"], {}, "退出原来的服务器");
  status = { status: "unauthenticated" };
}
if (status.status === "unauthenticated") {
  run(["config", "server", server], {}, "设置服务器地址");
  run(["login", "--apikey"], { BW_CLIENTID, BW_CLIENTSECRET }, "用 API 密钥登录");
}
const session = run(["unlock", "--passwordenv", "BW_PASSWORD", "--raw"], { BW_PASSWORD }, "用主密码解锁");

const child = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "server.mjs")], { env: { ...base, BW_SESSION: session, BW_CLI_PATH: bwBin, BW_MCP_SDK_ROOT: sdkRoot }, stdio: "inherit" });
child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
