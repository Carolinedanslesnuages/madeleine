/**
 * Reads a dependency's version spec from package.json.
 *
 *   exact        "1.2.3", "1.2.3-rc.1"            → the only spec accepted for a registry package
 *   range        "^1.2.3", "~1.2", ">=1", "1.x", "*" , "latest"…
 *   git-pinned   "github:owner/repo#<40-hex commit>", "git+https://…#<40-hex commit>"
 *   git          a Git dependency without a commit hash (moves with the branch)
 *   local        "file:", "link:", "workspace:", "portal:" (code of the project itself)
 * An alias "npm:real-name@1.2.3" is read as the real package.
 */
const EXACT_VERSION = /^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const COMMIT_HASH = /#[0-9a-f]{40}$/;
const GIT_PREFIXES = /^(github:|gitlab:|bitbucket:|git\+|git:\/\/|https?:\/\/.*\.git(#|$))|^[\w.-]+\/[\w.-]+(#|$)/;
const LOCAL_PREFIXES = /^(file:|link:|workspace:|portal:)/;

export function readSpec(packageName, spec) {
  const text = String(spec).trim();
  const alias = /^npm:((?:@[^/@]+\/)?[^@]+)@(.+)$/.exec(text);
  if (alias) return { ...readSpec(alias[1], alias[2]), packageName: alias[1], alias: packageName };
  if (LOCAL_PREFIXES.test(text)) return { packageName, kind: 'local', spec: text };
  if (GIT_PREFIXES.test(text)) return { packageName, kind: COMMIT_HASH.test(text) ? 'git-pinned' : 'git', spec: text };
  if (EXACT_VERSION.test(text)) return { packageName, kind: 'exact', spec: text, version: text.replace(/^v/, '') };
  return { packageName, kind: 'range', spec: text };
}

/** "1.2.3" from a range, to look up the license and age of the version it most likely means. */
export function lowestVersion(range) {
  const match = /(\d+)\.(\d+|x|\*)(?:\.(\d+|x|\*))?/.exec(range);
  if (!match) return null;
  const part = (value) => (value === undefined || value === 'x' || value === '*' ? '0' : value);
  return `${match[1]}.${part(match[2])}.${part(match[3])}`;
}
