import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, SCALES, TOOLS, BIN, PNP_TOOLS, LOCKFILE, STORED_LOCKFILE, COMMANDS, ADD_NAME } from "./common.mjs";
import { countDistinctNameVersionPairs } from "./count-packages.mjs";

const MAX_ATTEMPTS = 8;
const RETRY_PAUSE_SECONDS = 60;
const NODE_VERSION = fs.readFileSync(path.join(ROOT, ".node-version"), "utf8").trim();
if (process.version !== `v${NODE_VERSION}`) throw new Error(`.node-version pins ${NODE_VERSION}, this process is ${process.version}`);

const cpuTimes = () => os.cpus().reduce((a, c) => ({ idle: a.idle + c.times.idle, all: a.all + Object.values(c.times).reduce((x, y) => x + y, 0) }), { idle: 0, all: 0 });
function idleShare() {
  const a = cpuTimes();
  spawnSync("sleep", ["1"]);
  const b = cpuTimes();
  return (b.idle - a.idle) / (b.all - a.all);
}
function waitQuiet(minIdle) {
  for (let waited = 0; waited < 300; waited++) {
    const idle = idleShare();
    if (idle >= minIdle) return idle;
  }
  throw new Error(`the machine never reached ${minIdle} idle in 300 s; close other apps and rerun`);
}

function parseArgs(argv) {
  const opts = {
    reps: 10,
    minidle: 0.75,
    warmups: 1,
    scales: SCALES,
    tools: TOOLS,
    work: path.join(ROOT, ".work"),
    out: path.join(ROOT, "results", "results.jsonl"),
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, "");
    const value = argv[i + 1];
    if (!(key in opts) || value === undefined) throw new Error(`unknown or incomplete option: ${argv[i]}`);
    opts[key] = ["scales", "tools"].includes(key) ? value.split(",") : ["reps", "warmups", "minidle"].includes(key) ? Number(value) : value;
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const work = path.resolve(opts.work);
const rcNames = [
  ...(opts.tools.includes("yarn-classic") ? [".npmrc", ".yarnrc"] : []),
  ...(opts.tools.some((tool) => tool.startsWith("yarn-berry")) ? [".yarnrc.yml"] : []),
];
for (let dir = work; rcNames.length > 0; dir = path.dirname(dir)) {
  const rc = rcNames.map((name) => path.join(dir, name)).find((file) => fs.existsSync(file));
  if (rc) throw new Error(`${rc} sits above --work ${work}; yarn reads it, so its column would not be measured under the same conditions. Use a --work with none of ${rcNames.join(", ")} on its path`);
  if (dir === path.dirname(dir)) break;
}
const binOf = (tool) => path.join(ROOT, BIN[tool]);
const isBerry = (tool) => tool.startsWith("yarn-berry");
const isPnp = (tool) => PNP_TOOLS.includes(tool);

function inside(p) {
  if (path.resolve(p) !== work && !path.resolve(p).startsWith(work + path.sep)) throw new Error(`refusing to touch ${p} outside ${work}`);
  return p;
}
const rmrf = (p) => fs.rmSync(inside(p), { recursive: true, force: true });
const mkdirp = (p) => fs.mkdirSync(inside(p), { recursive: true });

function childEnv(tool) {
  return {
    PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: path.join(work, "home", tool),
    TMPDIR: os.tmpdir(),
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    ...(isBerry(tool) ? { YARN_ENABLE_TELEMETRY: "0", YARN_ENABLE_SCRIPTS: "false" } : {}),
  };
}

function exec(tool, args, cwd) {
  const start = performance.now();
  const result = spawnSync(binOf(tool), args, {
    cwd,
    env: childEnv(tool),
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  return { ms: performance.now() - start, status: result.status, stderr: result.stderr ?? "", error: result.error };
}

class StepFailure extends Error {
  constructor(step, detail) {
    super(`${step} failed`);
    this.step = step;
    this.detail = detail;
  }
}

const lockfileDir = (scale) => path.join(work, "lockfiles", scale);

function deriveLockfiles(scale) {
  const dir = lockfileDir(scale);
  rmrf(dir);
  mkdirp(dir);
  const fixture = path.join(ROOT, "fixtures", scale);
  for (const file of ["package.json", "package-lock.json"]) fs.copyFileSync(path.join(fixture, file), path.join(dir, file));
  const derive = { pnpm: ["import"], bun: ["install", "--lockfile-only"] };
  for (const [tool, args] of Object.entries(derive).filter(([tool]) => opts.tools.includes(tool))) {
    const project = path.join(work, "derive", tool);
    rmrf(project);
    rmrf(path.join(work, "home", tool));
    mkdirp(project);
    mkdirp(path.join(work, "home", tool));
    for (const file of ["package.json", "package-lock.json"]) fs.copyFileSync(path.join(fixture, file), path.join(project, file));
    const r = exec(tool, args, project);
    if (r.status !== 0) throw new Error(`could not derive ${LOCKFILE[tool]} for ${scale}: ${r.stderr}`);
    fs.copyFileSync(path.join(project, LOCKFILE[tool]), path.join(dir, STORED_LOCKFILE[tool]));
  }
  if (opts.tools.some((tool) => tool.startsWith("yarn"))) deriveYarnLockfiles(scale, fixture, dir);
}

// yarn classic cannot read lockfileVersion 3: import from the node_modules that npm ci builds.
function deriveYarnLockfiles(scale, fixture, dir) {
  const fresh = (tool) => {
    const project = path.join(work, "derive", tool);
    rmrf(project);
    rmrf(path.join(work, "home", tool));
    mkdirp(project);
    mkdirp(path.join(work, "home", tool));
    return project;
  };
  const classic = fresh("yarn-classic");
  for (const file of ["package.json", "package-lock.json"]) fs.copyFileSync(path.join(fixture, file), path.join(classic, file));
  rmrf(path.join(work, "home", "npm"));
  mkdirp(path.join(work, "home", "npm"));
  const installedByNpm = exec("npm", ["ci", "--ignore-scripts"], classic);
  if (installedByNpm.status !== 0) throw new Error(`npm ci failed while deriving yarn.lock for ${scale}: ${installedByNpm.stderr}`);
  rmrf(path.join(classic, "package-lock.json"));
  const imported = exec("yarn-classic", ["import"], classic);
  if (imported.status !== 0) throw new Error(`could not derive yarn classic's yarn.lock for ${scale}: ${imported.stderr}`);
  fs.copyFileSync(path.join(classic, "yarn.lock"), path.join(dir, STORED_LOCKFILE["yarn-classic"]));

  const berry = fresh("yarn-berry");
  fs.copyFileSync(path.join(fixture, "package.json"), path.join(berry, "package.json"));
  fs.copyFileSync(path.join(classic, "yarn.lock"), path.join(berry, "yarn.lock"));
  const upgraded = exec("yarn-berry", ["install"], berry);
  if (upgraded.status !== 0) throw new Error(`could not derive yarn Berry's yarn.lock for ${scale}: ${upgraded.stderr}`);
  fs.copyFileSync(path.join(berry, "yarn.lock"), path.join(dir, STORED_LOCKFILE["yarn-berry"]));
}

function countBerryLockEntries(project) {
  const text = fs.readFileSync(path.join(project, "yarn.lock"), "utf8");
  return [...text.matchAll(/^ {2}resolution: "(.+)"$/gm)].filter((m) => !/@(workspace|patch):/.test(m[1])).length;
}

function runChain(scale, tool, rep, idleBefore) {
  const project = path.join(work, "project", tool);
  const home = path.join(work, "home", tool);
  const modules = path.join(project, "node_modules");
  const records = [];
  const cmd = COMMANDS[tool];

  const resetCache = () => {
    rmrf(home);
    mkdirp(home);
  };
  const useDerivedLockfile = () =>
    fs.copyFileSync(path.join(lockfileDir(scale), STORED_LOCKFILE[tool]), path.join(project, LOCKFILE[tool]));
  const step = (name, args, verify) => {
    const r = exec(tool, args, project);
    const problem = r.status !== 0 ? `exit ${r.status}` : verify && !verify() ? "result check failed" : null;
    if (problem) throw new StepFailure(name, { problem, stderr: r.stderr.slice(-1000), error: String(r.error ?? "") });
    records.push({ kind: "timing", scale, tool, rep, step: name, ms: r.ms, idleBefore });
  };
  const pnpFile = path.join(project, ".pnp.cjs");
  const installed = () => (isPnp(tool) ? fs.existsSync(pnpFile) : fs.existsSync(modules) && fs.readdirSync(modules).length > 0);
  const hasAdded = () =>
    isPnp(tool) ? fs.readFileSync(pnpFile, "utf8").includes(`["${ADD_NAME}", [`) : fs.existsSync(path.join(modules, ADD_NAME, "package.json"));
  const removeInstallOutput = () => {
    for (const leftover of [modules, pnpFile, path.join(project, ".pnp.loader.mjs"), path.join(project, ".yarn")]) rmrf(leftover);
  };

  rmrf(project);
  mkdirp(project);
  fs.copyFileSync(path.join(lockfileDir(scale), "package.json"), path.join(project, "package.json"));
  if (tool === "yarn-berry-nm") fs.writeFileSync(path.join(project, ".yarnrc.yml"), "nodeLinker: node-modules\n");
  resetCache();

  step("clean", cmd.clean, installed);
  const count = () => (isPnp(tool) ? countBerryLockEntries(project) : countDistinctNameVersionPairs(project));
  if (rep === 1) records.push({ kind: "packages", scale, tool, step: "clean", count: count() });

  removeInstallOutput();
  resetCache();
  useDerivedLockfile();
  step("lockfile", cmd.frozen, installed);
  if (rep === 1) records.push({ kind: "packages", scale, tool, step: "lockfile", count: count() });

  step("script", cmd.script);
  step("add", cmd.add, hasAdded);
  step("remove", cmd.remove, () => !hasAdded());

  removeInstallOutput();
  useDerivedLockfile();
  step("warm", cmd.frozen, installed);
  return records;
}

function runChainWithRetries(scale, tool, rep, record) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return runChain(scale, tool, rep, Number(waitQuiet(opts.minidle).toFixed(3)));
    } catch (e) {
      if (!(e instanceof StepFailure)) throw e;
      record({ kind: "failure", scale, tool, rep, attempt, step: e.step, ...e.detail });
      console.error(`discarded: ${scale} ${tool} rep ${rep} step ${e.step} attempt ${attempt}: ${e.detail.problem}`);
      spawnSync("sleep", [String(RETRY_PAUSE_SECONDS)]);
    }
  }
  throw new Error(`${scale} ${tool} rep ${rep} failed ${MAX_ATTEMPTS} times`);
}

function metaRecord() {
  const versions = Object.fromEntries(
    opts.tools.map((tool) => {
      mkdirp(path.join(work, "home", tool));
      return [tool, spawnSync(binOf(tool), ["--version"], { env: childEnv(tool), encoding: "utf8" }).stdout.trim()];
    }),
  );
  const osVersion = spawnSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).stdout.trim();
  return {
    kind: "meta",
    date: new Date().toISOString(),
    node: process.version,
    os: `${os.type()} ${osVersion || os.release()} ${os.arch()}`,
    cpu: os.cpus()[0].model,
    cores: os.cpus().length,
    memoryGiB: Math.round(os.totalmem() / 2 ** 30),
    reps: opts.reps,
    tools: versions,
  };
}

if (fs.existsSync(opts.out)) throw new Error(`${opts.out} exists; move it away first`);
mkdirp(work);
fs.mkdirSync(path.dirname(opts.out), { recursive: true });
const record = (rec) => fs.appendFileSync(opts.out, JSON.stringify(rec) + "\n");
record(metaRecord());

for (const scale of opts.scales) {
  deriveLockfiles(scale);
  for (let w = 0; w < opts.warmups; w++) {
    for (const tool of opts.tools) {
      runChainWithRetries(scale, tool, 0, record);
      console.error(`warm-up: ${scale} ${tool}`);
    }
  }
  for (let rep = 1; rep <= opts.reps; rep++) {
    const order = opts.tools.map((_, i) => opts.tools[(i + rep - 1) % opts.tools.length]);
    for (const tool of order) {
      for (const rec of runChainWithRetries(scale, tool, rep, record)) record(rec);
      console.error(`done: ${scale} rep ${rep}/${opts.reps} ${tool}`);
    }
  }
}
