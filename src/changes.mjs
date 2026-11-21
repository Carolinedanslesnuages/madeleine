/**
 * The dependencies a change adds or modifies, in every package.json of the repository
 * (workspaces included), by comparing the working tree with a base commit.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

const runGit = (args, folder) => execFileSync('git', args, { cwd: folder, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const isManifest = (path) => /(^|\/)package\.json$/.test(path) && !/(^|\/)node_modules\//.test(path);

function parseManifest(text, path) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${path} illisible : ${error.message}`);
  }
}

/** Every declared dependency of a manifest: [{ field, packageName, spec }]. */
export function declaredDependencies(manifest) {
  return DEPENDENCY_FIELDS.flatMap((field) => Object.entries(manifest[field] || {}).map(([packageName, spec]) => ({ field, packageName, spec })));
}

/** Dependencies added, or whose spec changed, between two manifests. */
export function changedDependencies(before, after) {
  const previous = new Map(declaredDependencies(before).map((entry) => [`${entry.field}/${entry.packageName}`, entry.spec]));
  return declaredDependencies(after).filter((entry) => previous.get(`${entry.field}/${entry.packageName}`) !== entry.spec);
}

/** Manifests to read: changed since the base (or all of them), with the dependencies to check. */
export function collectChanges(folder, { base = 'HEAD', everything = false } = {}) {
  const tracked = runGit(['ls-files', '--cached', '--others', '--exclude-standard'], folder).split('\n').filter(isManifest);
  const changedPaths = everything ? tracked : runGit(['diff', '--name-only', base, '--', ...tracked.length ? tracked : ['package.json']], folder).split('\n').filter(isManifest);
  const untracked = everything ? [] : runGit(['ls-files', '--others', '--exclude-standard'], folder).split('\n').filter(isManifest);
  const paths = [...new Set([...changedPaths, ...untracked])].sort();
  return paths.map((path) => {
    const current = existsSync(join(folder, path)) ? parseManifest(readFileSync(join(folder, path), 'utf8'), path) : {};
    if (everything) return { path, dependencies: declaredDependencies(current) };
    let previousText = '';
    try {
      previousText = runGit(['show', `${base}:${path}`], folder);
    } catch {
      previousText = ''; // new manifest
    }
    return { path, dependencies: changedDependencies(parseManifest(previousText, path), current) };
  }).filter((manifest) => manifest.dependencies.length);
}
