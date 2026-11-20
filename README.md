# Package manager install-speed benchmark

Fixtures and runner behind a Zenn article comparing npm, pnpm, bun and yarn install speed (Japanese). A package manager is added through its commands in `common.mjs` and its lockfile derivation in `run.mjs`.

```sh
npm install --prefix tools                       # pinned npm, pnpm, bun and yarn classic (allowScripts in tools/package.json lets pnpm and bun finish installing)
npm install --prefix tools-berry                 # yarn Berry, kept apart: classic and Berry both install a `yarn` command
node run.mjs --tools npm,pnpm,bun,yarn-classic,yarn-berry,yarn-berry-nm --work <dir outside the repo> --out results/results.jsonl
node summarize.mjs results/results.jsonl         # median and min-max tables
uv run --with matplotlib python make-charts.py   # one chart of all results -> charts/all.png (needs a font with Japanese glyphs)
```

Run under the Node version in `.node-version` (the runner refuses any other). `yarn-berry` is Berry's default linker (PnP); `yarn-berry-nm` writes `nodeLinker: node-modules` into `.yarnrc.yml`. yarn classic reads every `.npmrc` and `.yarnrc`, and Berry every `.yarnrc.yml`, above its working directory, so `--work` needs a path with none of them on it (the runner refuses the yarn tools otherwise).

Options of `run.mjs`: `--scales small,large`, `--tools npm,bun`, `--reps 10`, `--warmups 1`, `--minidle 0.75`, `--work <dir>`, `--out <file>`. It refuses to overwrite an existing `--out`.

- `fixtures/<scale>/package.json` is a real project's `package.json` at the commit in `SOURCE.json`, plus a `hello` script. `package-lock.json` is generated from it by npm (`--package-lock-only --ignore-scripts`), not the project's own lockfile. `pnpm-lock.yaml` and `bun.lock` are derived from the npm lockfile (`pnpm import`, `bun install --lockfile-only`). yarn classic cannot read a `lockfileVersion` 3 `package-lock.json`, so `yarn.lock` is imported from the `node_modules` that `npm ci` builds; Berry upgrades that lockfile in one full `yarn install`.
- Dependency lifecycle scripts are off for every tool (`--ignore-scripts`; `YARN_ENABLE_SCRIPTS=false` for Berry): the defaults differ, and pnpm 12 exits non-zero when it skips a build.
- Berry's default linker writes no `node_modules`: its result checks read `.pnp.cjs`, its package count is the `yarn.lock` entry count, and the reset also removes `.pnp.cjs`, `.pnp.loader.mjs` and `.yarn`.
- Each tool runs with its own `HOME` below the work directory: no user config leaks in, and deleting that directory is the cache reset.
- Before each chain the runner waits for the CPU idle share to reach `--minidle` and records it as `idleBefore`.
- One repetition runs a chain per tool: `clean`, `lockfile`, `script`, `add`, `remove`, `warm`, each step starting from the state the previous one left. A failed step discards the whole chain, which is rerun after a pause (up to 8 attempts); discards are recorded as `failure` lines.
- `results/results.jsonl` holds the `small` run; it stopped in `medium` repetition 2 when a just-published `puppeteer-core` version returned 404, so only its `small` records are used. `results/results-medium-large.jsonl` holds the rerun of `medium` and `large` the same day.

## Licenses

The runner is MIT-licensed (`LICENSE`). Each `fixtures/<scale>/package.json` comes from a third-party project named in its `SOURCE.json` (three.js: MIT, pdf.js: Apache-2.0, Another Redis Desktop Manager: MIT) and stays under that project's license.
