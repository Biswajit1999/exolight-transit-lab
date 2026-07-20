const CACHE_URL = "./data/gaia-neighbours.json";

let cachePromise = null;

function slugify(value) {
  const text = String(value || "unknown-target").trim().toLowerCase();
  return text
    .replace(/\+/g, " plus ")
    .replace(/['’"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown-target";
}

async function loadCache() {
  if (!cachePromise) {
    cachePromise = fetch(`${CACHE_URL}?v=${Date.now()}`, { cache: "no-store", headers: { Accept: "application/json" } })
      .then(response => (response.ok ? response.json() : {}))
      .catch(error => {
        console.warn("ExoLight Gaia neighbour cache unavailable:", error);
        return {};
      });
  }
  return cachePromise;
}

export async function getNeighboursForTarget(target) {
  const cache = await loadCache();
  const slug = slugify(target?.pl_name);
  return cache?.[slug] || null;
}
