#!/usr/bin/env node
/** Madeleine: a safeguard for the dependencies a coding agent adds. */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { collectChanges } from '../src/changes.mjs';
import { readSpec } from '../src/version-spec.mjs';
import { registryClient } from '../src/registry.mjs';
import { checkDependency, withoutAllowed, DEFAULT_SETTINGS } from '../src/rules.mjs';

const HELP = `Madeleine · garde-fou des dépendances ajoutées par un agent de code

Usage : madeleine [verifier] [options]

  Vérifie chaque dépendance ajoutée ou modifiée dans les package.json (espaces de travail
  compris) depuis un commit de base :

  ✗ bloque    paquet inexistant, version pas exacte, version de moins de 14 jours,
              licence hors liste, version dépréciée, dépendance Git non épinglée
  ⚠ prévient  paquet très peu téléchargé, script lancé à l'installation

  --base <ref>       commit de comparaison (défaut : HEAD, c'est-à-dire vos changements en cours)
  --tout             toutes les dépendances, pas seulement les changements
  --strict           échoue aussi sur les avertissements
  --config <fichier> réglages et exceptions (défaut : ./madeleine.json)
  --json             résultat en JSON
  --aide             cette aide

madeleine.json (facultatif) :
  { "licences": ["MIT", "ISC"], "ageMinimumJours": 14, "telechargementsMinimum": 500,
    "autorises": { "un-paquet": ["licence"] } }`;

const SYMBOLS = { error: '✗', warning: '⚠' };
const GITHUB_LEVELS = { error: 'error', warning: 'warning' };
/** Level names in the --json output (public format, in French). */
const JSON_LEVELS = { error: 'erreur', warning: 'avertissement' };

function parseOptions(args) {
  const options = { base: 'HEAD', config: 'madeleine.json' };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === 'verifier') continue;
    if (['aide', '--aide', '-h', '--help'].includes(argument)) options.help = true;
    else if (argument === '--base') options.base = args[++index];
    else if (argument === '--tout') options.everything = true;
    else if (argument === '--strict') options.strict = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--config') options.config = args[++index];
    else throw new Error(`Option inconnue : ${argument}. Tapez « madeleine aide ».`);
  }
  if (!options.base) throw new Error('--base attend un commit, une branche ou un tag.');
  return options;
}

function readSettings(path) {
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS, autorises: {} };
  try {
    return { ...DEFAULT_SETTINGS, autorises: {}, ...JSON.parse(readFileSync(path, 'utf8')) };
  } catch (error) {
    throw new Error(`${path} illisible : ${error.message}`);
  }
}

/** Line of a dependency in its package.json, for precise annotations. */
function lineOf(manifestPath, packageName) {
  const lines = readFileSync(manifestPath, 'utf8').split('\n');
  const found = lines.findIndex((line) => line.includes(`"${packageName}"`));
  return found >= 0 ? found + 1 : null;
}

async function checkManifests(manifests, settings) {
  const registry = registryClient();
  const reports = [];
  for (const manifest of manifests) {
    for (const declared of manifest.dependencies) {
      const dependency = { ...readSpec(declared.packageName, declared.spec), lockedAtBase: declared.lockedAtBase ?? null };
      const onRegistry = dependency.kind === 'exact' || dependency.kind === 'range';
      const [info, downloads] = onRegistry
        ? await Promise.all([registry.packageInfo(dependency.packageName), registry.weeklyDownloads(dependency.packageName)])
        : [null, null];
      const findings = withoutAllowed(checkDependency(dependency, info, downloads, settings), declared.packageName, settings.autorises);
      reports.push({ manifestPath: manifest.path, field: declared.field, packageName: declared.packageName, spec: declared.spec, findings });
    }
  }
  return reports;
}

function printText(reports, folder) {
  for (const report of reports) {
    const levels = report.findings.map((finding) => finding.level);
    const symbol = levels.includes('error') ? '✗' : levels.includes('warning') ? '⚠' : '✓';
    console.log(`${symbol} ${report.packageName}@${report.spec}  (${report.manifestPath}, ${report.field})`);
    for (const finding of report.findings) {
      console.log(`    ${SYMBOLS[finding.level]} ${finding.message}`);
      if (process.env.GITHUB_ACTIONS) {
        const line = lineOf(join(folder, report.manifestPath), report.packageName);
        const location = `file=${report.manifestPath}${line ? `,line=${line}` : ''}`;
        console.log(`::${GITHUB_LEVELS[finding.level]} ${location},title=Madeleine (${finding.rule})::${report.packageName} : ${finding.message}`);
      }
    }
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) return console.log(HELP);
  const folder = process.cwd();
  const settings = readSettings(resolve(options.config));
  const manifests = collectChanges(folder, { base: options.base, everything: options.everything });
  const reports = await checkManifests(manifests, settings);
  const count = (level) => reports.reduce((total, report) => total + report.findings.filter((finding) => finding.level === level).length, 0);
  const totals = { errors: count('error'), warnings: count('warning') };
  const failed = totals.errors > 0 || (Boolean(options.strict) && totals.warnings > 0);

  if (options.json) {
    const output = reports.map((report) => ({
      fichier: report.manifestPath,
      paquet: report.packageName,
      version: report.spec,
      constats: report.findings.map((finding) => ({ niveau: JSON_LEVELS[finding.level], regle: finding.rule, message: finding.message })),
    }));
    console.log(JSON.stringify({ dependances: output, total: { erreurs: totals.errors, avertissements: totals.warnings }, echec: failed }, null, 2));
  } else if (!reports.length) {
    console.log(options.everything ? 'Aucune dépendance déclarée.' : `Aucune dépendance ajoutée ou modifiée depuis ${options.base}.`);
  } else {
    printText(reports, folder);
    const plural = (total, word) => `${total} ${word}${total > 1 ? 's' : ''}`;
    console.log(`\n${plural(reports.length, 'dépendance')} vérifiée${reports.length > 1 ? 's' : ''} · ${plural(totals.errors, 'erreur')} · ${plural(totals.warnings, 'avertissement')}`);
  }
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`madeleine : ${error.message}`);
  process.exit(1);
});
