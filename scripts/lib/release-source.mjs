export const OFFICIAL_SOURCE = "https://github.com/EVEDensity/Canary.git";

const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEADLINE_MS = 10_000;
const SHA = /^[a-f0-9]{40}$/i;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ERRORS = {
  input: "Invalid release repository. Use a GitHub owner/repository name.",
  version: "Invalid stable version. Use three numeric components, for example 0.6.0.",
  network: "Unable to verify the release with GitHub. Check access to api.github.com and retry.",
  timeout: "Release verification timed out. Check access to api.github.com and retry.",
  forbidden: "GitHub refused release verification (HTTP 403). Retry after the GitHub API limit resets.",
  missing: "No published stable release or release tag was found. Check GitHub Releases and retry.",
  http: "GitHub could not verify the release. Check GitHub service availability and retry.",
  metadata: "GitHub returned invalid stable release metadata. Check the published release and retry.",
  size: "GitHub release metadata exceeded the verification limit. Check the published release and retry.",
  tag: "The release tag could not be verified as a commit. Check the GitHub release tag and retry.",
  mismatch: "The release tag does not match its declared commit. Ask the maintainer to correct the release.",
};

class ReleaseSourceError extends Error {
  constructor(code) {
    super(ERRORS[code]);
  }
}
function fail(code) {
  throw new ReleaseSourceError(code);
}
function versionParts(value) {
  if (typeof value !== "string" || value.length > 128 || !VERSION.test(value)) fail("version");
  return value.split(".").map(BigInt);
}

/** Compare stable X.Y.Z versions without coercion, prefixes or prerelease ordering. */
export function compareVersions(a, b) {
  const left = versionParts(a),
    right = versionParts(b);
  for (let i = 0; i < 3; i++) {
    if (left[i] < right[i]) return -1;
    if (left[i] > right[i]) return 1;
  }
  return 0;
}

function validPublishedAt(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const time = new Date(value);
  return (
    Number.isFinite(time.valueOf()) &&
    (time.toISOString() === value || time.toISOString().replace(".000Z", "Z") === value)
  );
}

async function readJson(response) {
  const declaredSize = response.headers.get("content-length");
  if (declaredSize && /^\d+$/.test(declaredSize) && BigInt(declaredSize) > BigInt(MAX_RESPONSE_BYTES)) {
    await response.body?.cancel().catch(() => {});
    fail("size");
  }
  if (!response.body) fail("metadata");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) fail("size");
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let parsed;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      fail("metadata");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("metadata");
    return parsed;
  } finally {
    // Cancel before releasing the lock when the byte limit or JSON validation fails.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Resolve GitHub's latest published stable release to its tag commit; no branch fallback. */
export async function resolveStableRelease({ repository = "EVEDensity/Canary", fetchImpl = fetch } = {}) {
  let timer;
  const controller = new AbortController();
  try {
    if (
      typeof repository !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(repository)
    )
      fail("input");
    if (typeof fetchImpl !== "function") fail("input");
    const api = "https://api.github.com/repos/" + repository.split("/").map(encodeURIComponent).join("/");
    async function get(path) {
      controller.signal.throwIfAborted();
      const response = await fetchImpl(api + path, {
        method: "GET",
        redirect: "error",
        credentials: "omit",
        signal: controller.signal,
        headers: { Accept: "application/vnd.github+json", "User-Agent": "Canary-release-installer" },
      });
      if (!response.ok) {
        // Never consume an error body: it can contain request details or credentials.
        response.body?.cancel().catch(() => {});
        if (response.status === 403) fail("forbidden");
        if (response.status === 404) fail("missing");
        fail("http");
      }
      return readJson(response);
    }
    async function resolve() {
      const release = await get("/releases/latest");
      const tag = release.tag_name;
      if (release.draft !== false || release.prerelease !== false || typeof tag !== "string" || !tag.startsWith("v"))
        fail("metadata");
      const version = tag.slice(1);
      try {
        versionParts(version);
      } catch {
        fail("metadata");
      }
      const url = `https://github.com/${repository}/releases/tag/${tag}`;
      if (
        release.html_url !== url ||
        !validPublishedAt(release.published_at) ||
        typeof release.target_commitish !== "string" ||
        !release.target_commitish.trim()
      )
        fail("metadata");
      const ref = await get("/git/ref/tags/" + encodeURIComponent(tag));
      if (ref.ref !== "refs/tags/" + tag) fail("tag");
      let object = ref.object;
      const visited = new Set();
      for (let depth = 0; object?.type === "tag"; depth++) {
        if (
          depth >= 4 ||
          typeof object.sha !== "string" ||
          !SHA.test(object.sha) ||
          visited.has(object.sha.toLowerCase())
        )
          fail("tag");
        const sha = object.sha.toLowerCase();
        visited.add(sha);
        const annotated = await get("/git/tags/" + sha);
        if (typeof annotated.sha !== "string" || annotated.sha.toLowerCase() !== sha) fail("tag");
        object = annotated.object;
      }
      if (object?.type !== "commit" || typeof object.sha !== "string" || !SHA.test(object.sha)) fail("tag");
      const commit = object.sha.toLowerCase();
      if (SHA.test(release.target_commitish) && release.target_commitish.toLowerCase() !== commit) fail("mismatch");
      return { tag, version, commit, url, publishedAt: release.published_at };
    }
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ReleaseSourceError("timeout"));
      }, DEADLINE_MS);
    });
    return await Promise.race([resolve(), deadline]);
  } catch (error) {
    // Reconstruct errors so fetch exceptions, HTTP bodies and causes never escape.
    throw new Error(error instanceof ReleaseSourceError ? error.message : ERRORS.network);
  } finally {
    clearTimeout(timer);
  }
}
