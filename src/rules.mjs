/**
 * Madeleine's rules for one dependency. Each finding: { level: "error" | "warning", rule, message }.
 * Rule ids are public (used in madeleine.json): they stay in French.
 */
import { lowestVersion } from './version-spec.mjs';

export const DEFAULT_SETTINGS = {
  licences: ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD'],
  ageMinimumJours: 14,
  telechargementsMinimum: 500,
};
const DAY_MS = 24 * 60 * 60 * 1000;
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall'];

/** Reads an SPDX expression: "(MIT OR Apache-2.0)" is accepted when one option is allowed. */
export function licenceAllowed(licence, allowed) {
  const expression = String(licence || '').replace(/[()]/g, ' ').trim();
  if (!expression) return false;
  if (/\sAND\s/i.test(expression)) return expression.split(/\s+AND\s+/i).every((part) => licenceAllowed(part, allowed));
  return expression.split(/\s+OR\s+/i).some((part) => allowed.includes(part.trim()));
}

const licenceOf = (manifest) => {
  const value = manifest.license ?? manifest.licenses;
  if (Array.isArray(value)) return value.map((entry) => entry.type || entry).join(' OR ');
  return typeof value === 'object' && value ? value.type : value;
};

function specFindings(dependency, report) {
  const { kind, spec } = dependency;
  if (kind === 'range') {
    report('error', 'version-exacte', `« ${spec} » n'est pas une version exacte : écrivez la version précise (ex. ${lowestVersion(spec) || '1.2.3'}), pour que chaque installation soit identique.`);
  }
  if (kind === 'git') report('error', 'git-epinglee', `dépendance Git sans commit précis (${spec}) : épinglez-la sur l'empreinte d'un commit (#<40 caractères>).`);
  if (kind === 'git-pinned') report('warning', 'hors-registre', 'dépendance Git, hors du registre npm : âge, licence et existence à vérifier à la main.');
}

function versionFindings(dependency, info, settings, report, currentTime) {
  const version = dependency.version || lowestVersion(dependency.spec);
  const manifest = version && info.versions && info.versions[version];
  if (!manifest) {
    if (dependency.kind === 'exact') report('error', 'version-inconnue', `la version ${version} n'existe pas dans le registre npm.`);
    return;
  }
  const publishedAt = info.time && info.time[version] ? new Date(info.time[version]) : null;
  // Already locked at the base: the version is installed everywhere already, its age is not news.
  const alreadyLocked = Boolean(dependency.lockedAtBase) && dependency.lockedAtBase === version;
  if (publishedAt && !alreadyLocked) {
    const ageDays = Math.floor((currentTime - publishedAt.getTime()) / DAY_MS);
    if (ageDays < settings.ageMinimumJours) {
      report('error', 'age', `la version ${version} a été publiée il y a ${ageDays} jour${ageDays > 1 ? 's' : ''} (minimum ${settings.ageMinimumJours}) : une version piégée est souvent retirée dans les premiers jours. Attendez, ou prenez la précédente.`);
    }
  }
  const licence = licenceOf(manifest) || licenceOf(info);
  if (!licence) report('error', 'licence', 'aucune licence déclarée : sans licence, le code n\'est pas réutilisable.');
  else if (!licenceAllowed(licence, settings.licences)) report('error', 'licence', `licence « ${licence} » hors de la liste acceptée (${settings.licences.join(', ')}).`);
  if (manifest.deprecated) report('error', 'depreciee', `version dépréciée : « ${String(manifest.deprecated).slice(0, 140)} »`);
  const scripts = INSTALL_SCRIPTS.filter((name) => manifest.scripts && manifest.scripts[name]);
  if (scripts.length || manifest.hasInstallScript) {
    report('warning', 'script-installation', `lance un script à l'installation${scripts.length ? ` (${scripts.join(', ')})` : ''} : du code s'exécute sur votre machine dès « npm install ». Relisez-le.`);
  }
}

/**
 * Checks one dependency { packageName, kind, spec, version?, lockedAtBase? } against the registry.
 * @param info      package metadata from the registry, or null when the package does not exist
 * @param downloads weekly downloads, or null when unknown
 */
export function checkDependency(dependency, info, downloads, settings = DEFAULT_SETTINGS, currentTime = Date.now()) {
  const findings = [];
  const report = (level, rule, message) => findings.push({ level, rule, message });
  specFindings(dependency, report);
  if (dependency.kind === 'local' || dependency.kind.startsWith('git')) return findings;
  if (!info) {
    report('error', 'existe', `« ${dependency.packageName} » n'existe pas dans le registre npm. Un nom inventé par un agent peut être réservé ensuite par quelqu'un de malveillant.`);
    return findings;
  }
  versionFindings(dependency, info, settings, report, currentTime);
  if (downloads !== null && downloads < settings.telechargementsMinimum) {
    report('warning', 'popularite', `seulement ${downloads} téléchargement${downloads > 1 ? 's' : ''} la semaine dernière : vérifiez que c'est bien le paquet voulu, et pas un nom proche d'un paquet connu.`);
  }
  return findings;
}

/** Drops the rules the project chose to allow for a package (madeleine.json → "autorises"). */
export function withoutAllowed(findings, packageName, allowed = {}) {
  const allowedRules = new Set(allowed[packageName] || []);
  return findings.filter((finding) => !allowedRules.has(finding.rule));
}
