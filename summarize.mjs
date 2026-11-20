import fs from "node:fs";
import { SCALES } from "./common.mjs";

const input = process.argv[2];
if (!input) throw new Error("usage: node summarize.mjs <results.jsonl>");
const records = fs
  .readFileSync(input, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const meta = records.find((r) => r.kind === "meta");
const TOOLS = Object.keys(meta.tools);
const timings = records.filter((r) => r.kind === "timing");
const failures = records.filter((r) => r.kind === "failure" && r.rep >= 1);
const packages = records.filter((r) => r.kind === "packages");

const ROWS = [
  ["clean", "clean install", (m) => m.clean],
  ["lockfile", "lockfile only", (m) => m.lockfile],
  ["warm", "warm cache", (m) => m.warm],
  ["addremove", "add then remove", (m) => m.add + m.remove],
  ["script", "run one script", (m) => m.script],
];

function chainsOf(scale, tool) {
  const byRep = new Map();
  for (const t of timings.filter((r) => r.scale === scale && r.tool === tool)) {
    byRep.set(t.rep, { ...byRep.get(t.rep), [t.step]: t.ms / 1000 });
  }
  return [...byRep.values()];
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const fmt = (x) => x.toFixed(x < 1 ? 3 : 2);

const out = [];
out.push(`Measured ${meta.date.slice(0, 10)} on ${meta.cpu}, ${meta.cores} cores, ${meta.memoryGiB} GiB, ${meta.os}, Node ${meta.node}`);
out.push(`Versions: ${TOOLS.map((t) => `${t} ${meta.tools[t]}`).join(", ")}`);
out.push("");

for (const scale of SCALES) {
  if (!timings.some((r) => r.scale === scale)) continue;
  const countsFor = (step) =>
    TOOLS.map((t) => `${t} ${packages.find((p) => p.scale === scale && p.tool === t && p.step === step)?.count ?? "?"}`).join(", ");
  out.push(`### ${scale} (installed packages, lockfile install: ${countsFor("lockfile")}; clean install: ${countsFor("clean")})`);
  out.push("");
  out.push(`| scenario (seconds) | ${TOOLS.join(" | ")} |`);
  out.push(`|---|${TOOLS.map(() => "---").join("|")}|`);
  for (const [, label, pick] of ROWS) {
    const cells = TOOLS.map((tool) => {
      const xs = chainsOf(scale, tool).map(pick);
      return `${fmt(median(xs))} (${fmt(Math.min(...xs))}–${fmt(Math.max(...xs))}), n=${xs.length}`;
    });
    out.push(`| ${label} | ${cells.join(" | ")} |`);
  }
  out.push("");
}

out.push(`Discarded chains (failed step, rerun): ${failures.length}`);
for (const f of failures) out.push(`- ${f.scale} ${f.tool} rep ${f.rep} step ${f.step}: ${f.problem}`);
console.log(out.join("\n"));
