import fs from "node:fs";
import path from "node:path";

function ignoreMissing(error) {
  if (error.code !== "ENOENT") throw error;
}

function readPackage(dir) {
  try {
    const { name, version } = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    return name && version ? `${name}@${version}` : null;
  } catch (error) {
    ignoreMissing(error);
    return null;
  }
}

function packageDirs(modulesDir) {
  let entries;
  try {
    entries = fs.readdirSync(modulesDir);
  } catch (error) {
    ignoreMissing(error);
    return [];
  }
  return entries
    .filter((name) => !name.startsWith("."))
    .flatMap((name) =>
      name.startsWith("@")
        ? fs.readdirSync(path.join(modulesDir, name)).map((sub) => path.join(modulesDir, name, sub))
        : [path.join(modulesDir, name)],
    );
}

export function countDistinctNameVersionPairs(project) {
  const seen = new Set();
  const found = new Set();
  const roots = [path.join(project, "node_modules")];
  const virtualStore = path.join(project, "node_modules", ".pnpm");
  if (fs.existsSync(virtualStore)) {
    for (const id of fs.readdirSync(virtualStore)) {
      if (fs.statSync(path.join(virtualStore, id)).isDirectory()) roots.push(path.join(virtualStore, id, "node_modules"));
    }
  }
  const queue = roots.flatMap(packageDirs);
  while (queue.length > 0) {
    const dir = queue.pop();
    const real = fs.realpathSync(dir);
    if (seen.has(real)) continue;
    seen.add(real);
    const id = readPackage(real);
    if (id) found.add(id);
    queue.push(...packageDirs(path.join(real, "node_modules")));
  }
  return found.size;
}
