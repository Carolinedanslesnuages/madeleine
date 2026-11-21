/** Public npm registry access (package metadata and weekly downloads). No token needed. */
const REGISTRY = process.env.MADELEINE_REGISTRY || 'https://registry.npmjs.org';
const DOWNLOADS_API = process.env.MADELEINE_DOWNLOADS_API || 'https://api.npmjs.org';

const encodeName = (packageName) => packageName.replace('/', '%2F');

async function getJson(address) {
  const response = await fetch(address, { headers: { Accept: 'application/json', 'User-Agent': 'madeleine' } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${address} : ${response.status}`);
  return response.json();
}

export function registryClient() {
  const cache = new Map();
  const cached = (cacheKey, load) => {
    if (!cache.has(cacheKey)) cache.set(cacheKey, load());
    return cache.get(cacheKey);
  };
  return {
    /** Full package metadata (versions, publication dates, licenses), or null when it does not exist. */
    packageInfo: (packageName) => cached(`info:${packageName}`, () => getJson(`${REGISTRY}/${encodeName(packageName)}`)),
    /** Downloads over the last week, or null when unknown. */
    weeklyDownloads: (packageName) => cached(`downloads:${packageName}`, async () => {
      try {
        const result = await getJson(`${DOWNLOADS_API}/downloads/point/last-week/${packageName}`);
        return result && Number.isFinite(result.downloads) ? result.downloads : null;
      } catch {
        return null; // statistics are a hint, never a reason to fail
      }
    }),
  };
}
