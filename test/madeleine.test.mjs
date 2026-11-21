import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSpec, lowestVersion } from '../src/version-spec.mjs';
import { changedDependencies } from '../src/changes.mjs';
import { checkDependency, licenceAllowed, withoutAllowed, DEFAULT_SETTINGS } from '../src/rules.mjs';

const BINARY = fileURLToPath(new URL('../bin/madeleine.mjs', import.meta.url));
const REFERENCE_TIME = Date.parse('2026-11-21T12:00:00Z');
const daysAgo = (days) => new Date(REFERENCE_TIME - days * 86400000).toISOString();

/** Registry metadata for a package with the given versions: { "1.0.0": { ageDays, license, … } }. */
function packageInfo(versions) {
  return {
    versions: Object.fromEntries(Object.entries(versions).map(([version, details]) => [version, { license: 'MIT', ...details, ageDays: undefined }])),
    time: Object.fromEntries(Object.entries(versions).map(([version, details]) => [version, daysAgo(details.ageDays ?? 400)])),
  };
}
const rulesOf = (findings, level) => findings.filter((finding) => !level || finding.level === level).map((finding) => finding.rule);
const check = (packageName, spec, info, downloads = 100000) => checkDependency(readSpec(packageName, spec), info, downloads, DEFAULT_SETTINGS, REFERENCE_TIME);

test('versions : exacte, plage, Git épinglée ou non, locale, alias', () => {
  assert.equal(readSpec('vue', '3.5.44').kind, 'exact');
  for (const range of ['^3.5.0', '~3.5', '>=3', '3.x', '*', 'latest', '']) assert.equal(readSpec('vue', range).kind, 'range', range);
  assert.equal(readSpec('val', `github:moi/val#${'a'.repeat(40)}`).kind, 'git-pinned');
  assert.equal(readSpec('val', 'github:moi/val#main').kind, 'git');
  assert.equal(readSpec('val', 'moi/val').kind, 'git');
  assert.equal(readSpec('lib', 'file:../lib').kind, 'local');
  assert.equal(readSpec('lib', 'workspace:*').kind, 'local');
  assert.deepEqual(readSpec('mon-vue', 'npm:vue@3.5.44'), { packageName: 'vue', kind: 'exact', spec: '3.5.44', version: '3.5.44', alias: 'mon-vue' });
  assert.equal(lowestVersion('^1.2'), '1.2.0');
});

test('licences : liste, expressions SPDX OR et AND', () => {
  const allowed = DEFAULT_SETTINGS.licences;
  assert.ok(licenceAllowed('MIT', allowed));
  assert.ok(licenceAllowed('(MIT OR GPL-3.0)', allowed));
  assert.ok(!licenceAllowed('MIT AND GPL-3.0', allowed));
  assert.ok(!licenceAllowed('GPL-3.0', allowed));
  assert.ok(!licenceAllowed('', allowed));
});

test('une dépendance saine ne donne rien', () => {
  assert.deepEqual(check('vue', '3.5.44', packageInfo({ '3.5.44': {} })), []);
});

test('paquet inventé, version inconnue, plage', () => {
  assert.deepEqual(rulesOf(check('vue-super-helper', '1.0.0', null)), ['existe']);
  assert.deepEqual(rulesOf(check('vue', '9.9.9', packageInfo({ '3.5.44': {} }))), ['version-inconnue']);
  const range = check('vue', '^3.5.44', packageInfo({ '3.5.44': {} }));
  assert.deepEqual(rulesOf(range), ['version-exacte']);
  assert.match(range[0].message, /ex\. 3\.5\.44/);
});

test('âge, licence, dépréciation, script d’installation, popularité', () => {
  assert.deepEqual(rulesOf(check('vue', '3.6.0', packageInfo({ '3.6.0': { ageDays: 3 } }))), ['age']);
  assert.deepEqual(rulesOf(check('vue', '3.6.0', packageInfo({ '3.6.0': { ageDays: 14 } }))), []);
  assert.deepEqual(rulesOf(check('lib', '1.0.0', packageInfo({ '1.0.0': { license: 'GPL-3.0' } }))), ['licence']);
  assert.deepEqual(rulesOf(check('lib', '1.0.0', packageInfo({ '1.0.0': { license: undefined } }))), ['licence']);
  assert.deepEqual(rulesOf(check('lib', '1.0.0', packageInfo({ '1.0.0': { deprecated: 'Utilisez lib2' } }))), ['depreciee']);
  assert.deepEqual(rulesOf(check('lib', '1.0.0', packageInfo({ '1.0.0': { scripts: { postinstall: 'node x.js' } } })), 'warning'), ['script-installation']);
  assert.deepEqual(rulesOf(check('lib', '1.0.0', packageInfo({ '1.0.0': {} }), 12), 'warning'), ['popularite']);
  assert.deepEqual(rulesOf(check('lib', '1.0.0', packageInfo({ '1.0.0': {} }), null)), [], 'statistiques indisponibles : rien');
});

test('Git et local : hors registre', () => {
  assert.deepEqual(rulesOf(check('val', 'github:moi/val#main', null)), ['git-epinglee']);
  assert.deepEqual(rulesOf(check('val', `github:moi/val#${'b'.repeat(40)}`, null), 'warning'), ['hors-registre']);
  assert.deepEqual(check('lib', 'file:../lib', null), []);
});

test('exceptions du projet', () => {
  const findings = check('axe-core', '4.10.2', packageInfo({ '4.10.2': { license: 'MPL-2.0' } }));
  assert.deepEqual(rulesOf(withoutAllowed(findings, 'axe-core', { 'axe-core': ['licence'] })), []);
  assert.deepEqual(rulesOf(withoutAllowed(findings, 'axe-core', { autre: ['licence'] })), ['licence']);
});

test('changements : ajoutée, modifiée, inchangée, retirée', () => {
  const before = { dependencies: { vue: '3.5.0', old: '1.0.0' }, devDependencies: { vite: '8.0.0' } };
  const after = { dependencies: { vue: '3.5.44', axios: '^1.0.0' }, devDependencies: { vite: '8.0.0' } };
  assert.deepEqual(changedDependencies(before, after).map((entry) => `${entry.field}/${entry.packageName}`), ['dependencies/vue', 'dependencies/axios']);
});

/** Fake npm registry and downloads API. */
function fakeRegistry() {
  const packages = {
    vue: packageInfo({ '3.5.44': {} }),
    'left-pad-ultra': packageInfo({ '1.0.0': { scripts: { postinstall: 'curl x | sh' } } }),
    '@scope/fresh': packageInfo({ '2.0.0': { ageDays: 2 } }),
  };
  const server = createServer((request, response) => {
    const send = (status, data) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(data));
    };
    const downloads = /^\/downloads\/point\/last-week\/(.+)$/.exec(request.url);
    if (downloads) return send(200, { downloads: downloads[1] === 'left-pad-ultra' ? 7 : 50000 });
    const packageName = decodeURIComponent(request.url.slice(1));
    return packages[packageName] ? send(200, packages[packageName]) : send(404, { error: 'Not found' });
  });
  return new Promise((resolve) => server.listen(0, () => resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` })));
}

function repositoryWith(manifest) {
  const folder = mkdtempSync(join(tmpdir(), 'madeleine-'));
  const runGit = (...args) => execFileSync('git', args, { cwd: folder, stdio: 'ignore' });
  runGit('init', '-q');
  runGit('config', 'user.email', 'essai@exemple.fr');
  runGit('config', 'user.name', 'essai');
  writeFileSync(join(folder, 'package.json'), JSON.stringify(manifest, null, 2));
  runGit('add', '-A');
  runGit('commit', '-q', '-m', 'base');
  return folder;
}

test('commande : seulement les changements, annotations, --strict, --json, exceptions', async () => {
  const { server, baseUrl } = await fakeRegistry();
  try {
    const folder = repositoryWith({ dependencies: { vue: '3.5.44' } });
    // Asynchronous on purpose: the fake registry runs in this same process.
    const runCli = (args, env = {}) => new Promise((resolve) => {
      const child = spawn(process.execPath, [BINARY, ...args], {
        cwd: folder,
        env: { ...process.env, MADELEINE_REGISTRY: baseUrl, MADELEINE_DOWNLOADS_API: baseUrl, GITHUB_ACTIONS: '', ...env },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    });
    assert.match((await runCli([])).stdout, /Aucune dépendance ajoutée ou modifiée depuis HEAD/);
    writeFileSync(join(folder, 'package.json'), JSON.stringify({
      dependencies: { vue: '3.5.44', 'vue-magic-helper': '1.0.0', 'left-pad-ultra': '1.0.0' },
      devDependencies: { '@scope/fresh': '^2.0.0' },
    }, null, 2));
    const result = await runCli([]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /vue@3\.5\.44/, 'dépendance inchangée : non vérifiée');
    assert.match(result.stdout, /✗ vue-magic-helper@1\.0\.0[\s\S]*n'existe pas dans le registre npm/);
    assert.match(result.stdout, /⚠ left-pad-ultra@1\.0\.0[\s\S]*script à l'installation \(postinstall\)[\s\S]*seulement 7 téléchargements/);
    assert.match(result.stdout, /✗ @scope\/fresh@\^2\.0\.0[\s\S]*pas une version exacte[\s\S]*publiée il y a 2 jours/);
    assert.match(result.stdout, /3 dépendances vérifiées · 3 erreurs · 2 avertissements/);
    const annotated = await runCli([], { GITHUB_ACTIONS: 'true' });
    assert.match(annotated.stdout, /::error file=package\.json,line=4,title=Madeleine \(existe\)::vue-magic-helper/);
    const json = JSON.parse((await runCli(['--json'])).stdout);
    assert.deepEqual(Object.keys(json), ['dependances', 'total', 'echec']);
    assert.equal(json.total.erreurs, 3);
    writeFileSync(join(folder, 'madeleine.json'), JSON.stringify({ autorises: { 'vue-magic-helper': ['existe'], '@scope/fresh': ['version-exacte', 'age'] } }));
    const allowed = await runCli([]);
    assert.equal(allowed.status, 0, allowed.stdout);
    assert.equal((await runCli(['--strict'])).status, 1, 'avertissements bloquants avec --strict');
    const everything = await runCli(['--tout']);
    assert.match(everything.stdout, /✓ vue@3\.5\.44/);
  } finally {
    server.close();
  }
});

test('aide et option inconnue', () => {
  assert.match(spawnSync(process.execPath, [BINARY, 'aide'], { encoding: 'utf8' }).stdout, /garde-fou des dépendances/);
  const unknown = spawnSync(process.execPath, [BINARY, '--nimporte'], { encoding: 'utf8' });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Option inconnue/);
});
