import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const srcRoot = path.join(projectRoot, "src");

function resolveAliasPath(specifier) {
  if (!specifier.startsWith("@/")) {
    return null;
  }

  const target = specifier.slice(2);
  const basePath = path.join(srcRoot, target);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
    path.join(basePath, "index.js"),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export async function resolve(specifier, context, nextResolve) {
  const resolvedAlias = resolveAliasPath(specifier);

  if (resolvedAlias) {
    return {
      url: pathToFileURL(resolvedAlias).href,
      shortCircuit: true,
    };
  }

  return nextResolve(specifier, context);
}
