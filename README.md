# Madeleine

Un garde-fou pour les dépendances qu'ajoute un agent de code.

Le nom rend hommage à Marie-Madeleine Fourcade (1909-1989), qui a dirigé le réseau de résistance
Alliance et l'a réorganisé en groupes cloisonnés pour le protéger : Madeleine garde l'entrée du
projet, dépendance par dépendance.

Un agent ajoute volontiers un paquet : parfois un nom qui n'existe pas (et qu'une personne
malveillante peut réserver ensuite), souvent une plage de versions (`^1.2.0`), une version
publiée la veille, ou une licence incompatible. Madeleine vérifie chaque dépendance **ajoutée ou
modifiée** dans les `package.json` du projet, espaces de travail compris, avant la fusion.

| | Règle | Pourquoi |
|---|---|---|
| ✗ | `existe` | Le paquet existe dans le registre npm. Un nom inventé peut être réservé par quelqu'un d'autre. |
| ✗ | `version-exacte` | Une version précise (`1.2.3`), pas une plage : chaque installation est identique. |
| ✗ | `version-inconnue` | La version demandée existe. |
| ✗ | `age` | La version a au moins 14 jours : une version piégée est souvent retirée dans les premiers jours. |
| ✗ | `licence` | MIT, Apache-2.0, BSD, ISC ou 0BSD (réglable). Sans licence, le code n'est pas réutilisable. |
| ✗ | `depreciee` | La version n'est pas dépréciée. |
| ✗ | `git-epinglee` | Une dépendance Git est épinglée sur un commit précis. |
| ⚠ | `popularite` | Moins de 500 téléchargements par semaine : vérifier que c'est le bon paquet, pas un nom proche. |
| ⚠ | `script-installation` | Le paquet lance un script à l'installation : du code s'exécute dès `npm install`. |
| ⚠ | `hors-registre` | Dépendance Git épinglée : âge, licence et existence à vérifier à la main. |

✗ bloque la PR. ⚠ prévient seulement (sauf avec `--strict`). Les dépendances déjà présentes
avant la PR ne sont pas revérifiées.

**Figer une plage sur la version déjà installée** (`^1.2.3` → `1.2.3`, la version du
`package-lock.json` de la base) n'apporte aucune nouvelle version : la règle `age` ne s'applique
pas. Les autres règles, si.

## À quoi ça ressemble

Une branche qui ajoute deux dépendances, dont une qui n'existe pas :

```text
✗ csv-exporter-pro@^2.1.0  (package.json, dependencies)
    ✗ « ^2.1.0 » n'est pas une version exacte : écrivez la version précise (ex. 2.1.0), pour que chaque installation soit identique.
    ✗ « csv-exporter-pro » n'existe pas dans le registre npm. Un nom inventé par un agent peut être réservé ensuite par quelqu'un de malveillant.
✗ left-pad@1.3.0  (package.json, dependencies)
    ✗ licence « WTFPL » hors de la liste acceptée (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD).
    ✗ version dépréciée : « use String.prototype.padStart() »

2 dépendances vérifiées · 4 erreurs · 0 avertissement
```

Dans une pull request, chaque constat annote aussi la ligne du `package.json`.

## Dans une pull request (GitHub Actions)

```yaml
name: Madeleine

on:
  pull_request:

permissions:
  contents: read

jobs:
  dependances:
    name: Dépendances (Madeleine)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7.0.1
      - uses: Carolinedanslesnuages/madeleine@v1
```

Chaque constat est annoté sur la ligne du `package.json`. Réglages : `strict` (`"true"` pour
bloquer aussi sur les avertissements) et `config` (fichier de réglages, `madeleine.json` par
défaut).

## Sur votre ordinateur

```sh
npx github:Carolinedanslesnuages/madeleine          # vos changements en cours
npx github:Carolinedanslesnuages/madeleine --base main
npx github:Carolinedanslesnuages/madeleine --tout   # toutes les dépendances du projet
```

| Option | Rôle |
|---|---|
| `--base <ref>` | Commit de comparaison (défaut : `HEAD`, c'est-à-dire vos changements en cours). |
| `--tout` | Toutes les dépendances, pas seulement les changements. |
| `--strict` | Échoue aussi sur les avertissements. |
| `--config <fichier>` | Réglages et exceptions (défaut : `./madeleine.json`). |
| `--json` | Résultat en JSON. |

Seul le registre public npm est interrogé, sans jeton. Aucun paquet n'est téléchargé ni installé.

## Réglages et exceptions

Un fichier `madeleine.json` à la racine du projet, facultatif :

```json
{
  "licences": ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD"],
  "ageMinimumJours": 14,
  "telechargementsMinimum": 500,
  "autorises": {
    "axe-core": ["licence"]
  }
}
```

`autorises` lève une règle pour un paquet précis, après l'avoir vérifié vous-même : l'exception
est écrite, relue en PR et visible de tous.

## Pourquoi Madeleine

[Marie-Madeleine Fourcade](https://fr.wikipedia.org/wiki/Marie-Madeleine_Fourcade) (1909-1989) a
dirigé Alliance, l'un des plus grands réseaux de la Résistance. Chaque personne qui y entrait
était vérifiée : une seule recrue douteuse pouvait faire tomber tout le réseau. Une dépendance,
c'est pareil.

## Développer Madeleine

```sh
npm test
```

Les tests utilisent un faux registre npm : paquet inventé, plage de versions, version trop
récente, licence, script d'installation, popularité, exceptions et sortie JSON.

## Licence

[MIT](LICENSE).
