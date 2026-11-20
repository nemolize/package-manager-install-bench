import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.dirname(fileURLToPath(import.meta.url));

export const SCALES = ["small", "medium", "large"];
export const TOOLS = ["npm", "pnpm", "bun"];
export const YARN_TOOLS = ["yarn-classic", "yarn-berry", "yarn-berry-nm"];
export const ALL_TOOLS = [...TOOLS, ...YARN_TOOLS];

// classic and Berry both install `yarn`, so Berry lives in tools-berry.
export const BIN = {
  npm: "tools/node_modules/.bin/npm",
  pnpm: "tools/node_modules/.bin/pnpm",
  bun: "tools/node_modules/.bin/bun",
  "yarn-classic": "tools/node_modules/.bin/yarn",
  "yarn-berry": "tools-berry/node_modules/.bin/yarn",
  "yarn-berry-nm": "tools-berry/node_modules/.bin/yarn",
};

export const PNP_TOOLS = ["yarn-berry"];

export const CHAIN =["clean", "lockfile", "script", "add", "remove", "warm"];

export const ADD_SPEC = "left-pad@1.3.0";
export const ADD_NAME = "left-pad";

export const LOCKFILE = {
  npm: "package-lock.json",
  pnpm: "pnpm-lock.yaml",
  bun: "bun.lock",
  "yarn-classic": "yarn.lock",
  "yarn-berry": "yarn.lock",
  "yarn-berry-nm": "yarn.lock",
};

export const STORED_LOCKFILE = {
  ...LOCKFILE,
  "yarn-classic": "yarn-classic.lock",
  "yarn-berry": "yarn-berry.lock",
  "yarn-berry-nm": "yarn-berry.lock",
};

// Dependency lifecycle scripts are switched off for every tool: their defaults differ (npm 12 skips them,
// pnpm 12 skips them and exits non-zero, bun skips untrusted ones, yarn runs them), and a postinstall
// such as a browser download would measure the script, not the install.
const NO_SCRIPTS = "--ignore-scripts";
const yarnClassic = {
  clean: ["install", NO_SCRIPTS],
  frozen: ["install", "--frozen-lockfile", NO_SCRIPTS],
  script: ["run", "hello"],
  add: ["add", ADD_SPEC, NO_SCRIPTS],
  remove: ["remove", ADD_NAME, NO_SCRIPTS],
};
// Berry has no such flag; run.mjs sets YARN_ENABLE_SCRIPTS=false for it.
const yarnBerry = {
  clean: ["install"],
  frozen: ["install", "--immutable"],
  script: ["run", "hello"],
  add: ["add", ADD_SPEC],
  remove: ["remove", ADD_NAME],
};

export const COMMANDS = {
  "yarn-classic": yarnClassic,
  "yarn-berry": yarnBerry,
  "yarn-berry-nm": yarnBerry,
  npm: {
    clean: ["install", NO_SCRIPTS],
    frozen: ["ci", NO_SCRIPTS],
    script: ["run", "hello"],
    add: ["install", ADD_SPEC, NO_SCRIPTS],
    remove: ["uninstall", ADD_NAME, NO_SCRIPTS],
  },
  pnpm: {
    clean: ["install", NO_SCRIPTS],
    frozen: ["install", "--frozen-lockfile", NO_SCRIPTS],
    script: ["run", "hello"],
    add: ["add", ADD_SPEC, NO_SCRIPTS],
    remove: ["remove", ADD_NAME, NO_SCRIPTS],
  },
  bun: {
    clean: ["install", NO_SCRIPTS],
    frozen: ["install", "--frozen-lockfile", NO_SCRIPTS],
    script: ["run", "hello"],
    add: ["add", ADD_SPEC, NO_SCRIPTS],
    remove: ["remove", ADD_NAME, NO_SCRIPTS],
  },
};
