import { test } from "node:test";
import assert from "node:assert/strict";
import { OFFICIAL_SOURCE, compareVersions, resolveStableRelease } from "../lib/release-source.mjs";

const commit = "a".repeat(40),
  tagSha = "b".repeat(40),
  nextTagSha = "c".repeat(40);
const release = {
  tag_name: "v0.6.0",
  draft: false,
  prerelease: false,
  target_commitish: "main",
  published_at: "2026-10-16T09:50:00Z",
  html_url: "https://github.com/EVEDensity/Canary/releases/tag/v0.6.0",
};
const ref = { ref: "refs/tags/v0.6.0", object: { type: "commit", sha: commit } };
function json(value, options) {
  return new Response(JSON.stringify(value), options);
}
function fixture(values = [release, ref]) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.ok(values.length, "unexpected fallback request");
    const value = values.shift();
    return value instanceof Response ? value : json(value);
  };
  return { calls, fetchImpl };
}

test("resolves the official stable release and sends no credentials", async () => {
  assert.equal(OFFICIAL_SOURCE, "https://github.com/EVEDensity/Canary.git");
  const { calls, fetchImpl } = fixture();
  const actual = await resolveStableRelease({ fetchImpl });
  assert.deepEqual(actual, {
    tag: "v0.6.0",
    version: "0.6.0",
    commit,
    url: release.html_url,
    publishedAt: release.published_at,
  });
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "https://api.github.com/repos/EVEDensity/Canary/releases/latest",
      "https://api.github.com/repos/EVEDensity/Canary/git/ref/tags/v0.6.0",
    ],
  );
  for (const { options } of calls) {
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    assert.equal(options.method, "GET");
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(Object.keys(options.headers).sort(), ["Accept", "User-Agent"]);
    assert.equal(options.headers.Accept, "application/vnd.github+json");
  }
});

test("resolves annotated tags, including nested annotations and an exact declared commit", async () => {
  const { fetchImpl, calls } = fixture([
    { ...release, target_commitish: commit.toUpperCase() },
    { ...ref, object: { type: "tag", sha: tagSha } },
    { sha: tagSha, object: { type: "tag", sha: nextTagSha } },
    { sha: nextTagSha, object: { type: "commit", sha: commit.toUpperCase() } },
  ]);
  assert.equal((await resolveStableRelease({ fetchImpl })).commit, commit);
  assert.equal(calls[2].url, "https://api.github.com/repos/EVEDensity/Canary/git/tags/" + tagSha);
  assert.equal(calls[3].url, "https://api.github.com/repos/EVEDensity/Canary/git/tags/" + nextTagSha);
  const tags = ["1", "2", "3", "4"].map((value) => value.repeat(40));
  assert.equal(
    (
      await resolveStableRelease({
        fetchImpl: fixture([
          release,
          { ...ref, object: { type: "tag", sha: tags[0] } },
          ...tags.map((sha, i) => ({
            sha,
            object: i === 3 ? { type: "commit", sha: commit } : { type: "tag", sha: tags[i + 1] },
          })),
        ]).fetchImpl,
      })
    ).commit,
    commit,
  );
});

test("rejects drafts, prereleases, invalid versions, publication dates and foreign release URLs", async () => {
  const patches = [
    { draft: true },
    { prerelease: true },
    { draft: undefined },
    { tag_name: "v0.6.0-rc.1" },
    { tag_name: "0.6.0" },
    { tag_name: "v00.6.0" },
    { tag_name: "v0.6.0/../../main" },
    { target_commitish: "" },
    { published_at: null },
    { published_at: "2026-02-31T12:00:00Z" },
    { published_at: "tomorrow" },
    { html_url: "https://github.com.evil.invalid/EVEDensity/Canary/releases/tag/v0.6.0" },
    { html_url: release.html_url + "?token=private" },
    { html_url: release.html_url.replace("v0.6.0", "v0.5.0") },
  ];
  for (const patch of patches) {
    const { fetchImpl, calls } = fixture([{ ...release, ...patch }]);
    await assert.rejects(resolveStableRelease({ fetchImpl }), /invalid stable release metadata/);
    assert.equal(calls.length, 1);
  }
});

test("rejects invalid references, target mismatches, tag cycles and excessive indirection", async () => {
  for (const invalid of [
    { ...ref, ref: "refs/heads/main" },
    { ...ref, object: { type: "tree", sha: commit } },
    { ...ref, object: { type: "commit", sha: "not-a-sha" } },
  ])
    await assert.rejects(
      resolveStableRelease({ fetchImpl: fixture([release, invalid]).fetchImpl }),
      /release tag could not be verified/,
    );
  await assert.rejects(
    resolveStableRelease({ fetchImpl: fixture([{ ...release, target_commitish: tagSha }, ref]).fetchImpl }),
    /does not match its declared commit/,
  );
  await assert.rejects(
    resolveStableRelease({
      fetchImpl: fixture([
        release,
        { ...ref, object: { type: "tag", sha: tagSha } },
        { sha: commit, object: { type: "commit", sha: commit } },
      ]).fetchImpl,
    }),
    /release tag could not be verified/,
  );
  await assert.rejects(
    resolveStableRelease({
      fetchImpl: fixture([
        release,
        { ...ref, object: { type: "tag", sha: tagSha } },
        { sha: tagSha, object: { type: "tag", sha: tagSha } },
      ]).fetchImpl,
    }),
    /release tag could not be verified/,
  );
  const tags = ["1", "2", "3", "4", "5"].map((value) => value.repeat(40));
  const { fetchImpl, calls } = fixture([
    release,
    { ...ref, object: { type: "tag", sha: tags[0] } },
    ...tags.slice(0, 4).map((sha, i) => ({ sha, object: { type: "tag", sha: tags[i + 1] } })),
  ]);
  await assert.rejects(resolveStableRelease({ fetchImpl }), /release tag could not be verified/);
  assert.equal(calls.length, 6, "no fifth annotation or main fallback request");
});

test("HTTP failures and thrown exceptions have fixed actionable errors without bodies or fallback", async () => {
  for (const [status, pattern] of [
    [403, /HTTP 403/],
    [404, /No published stable release/],
    [500, /GitHub service availability/],
    [302, /GitHub service availability/],
  ]) {
    const { fetchImpl, calls } = fixture([new Response("PRIVATE_TOKEN=do-not-print", { status })]);
    const error = await resolveStableRelease({ fetchImpl }).catch((value) => value);
    assert.match(error.message, pattern);
    assert.doesNotMatch(error.stack, /PRIVATE_TOKEN|do-not-print/);
    assert.equal(calls.length, 1);
  }
  const error = await resolveStableRelease({
    fetchImpl: async () => {
      throw new Error("PRIVATE_TOKEN=sensitive");
    },
  }).catch((value) => value);
  assert.match(error.message, /Check access to api.github.com/);
  assert.doesNotMatch(error.stack, /PRIVATE_TOKEN|sensitive/);
});

test("limits declared and streamed response bodies and rejects malformed JSON", async () => {
  for (const response of [
    new Response("{}", { headers: { "content-length": "1048577" } }),
    new Response("x".repeat(1048577)),
  ])
    await assert.rejects(
      resolveStableRelease({ fetchImpl: fixture([response]).fetchImpl }),
      /exceeded the verification limit/,
    );
  for (const value of ["secret response is not JSON", "null", "[]", "true"])
    await assert.rejects(
      resolveStableRelease({ fetchImpl: fixture([new Response(value)]).fetchImpl }),
      /invalid stable release metadata/,
    );
  await assert.rejects(
    resolveStableRelease({ fetchImpl: fixture([new Response(new Uint8Array([255, 254]))]).fetchImpl }),
    /invalid stable release metadata/,
  );
  const padded = JSON.stringify(release).padEnd(1048576, " ");
  assert.equal(
    (await resolveStableRelease({ fetchImpl: fixture([new Response(padded), ref]).fetchImpl })).commit,
    commit,
  );
});

test("one overall deadline bounds a stalled fetch without depending on fetch cancellation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  const result = resolveStableRelease({
    fetchImpl: async (_url, options) => {
      signal = options.signal;
      return new Promise(() => {});
    },
  });
  t.mock.timers.tick(10_000);
  await assert.rejects(result, /Release verification timed out/);
  assert.equal(signal.aborted, true);
});

test("a stalled response body is bounded by the same overall deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const result = resolveStableRelease({ fetchImpl: async () => new Response(new ReadableStream({ start() {} })) });
  await Promise.resolve();
  t.mock.timers.tick(10_000);
  await assert.rejects(result, /Release verification timed out/);
});

test("the tag request does not receive a fresh deadline after release resolution", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [];
  let resolveRelease;
  const result = resolveStableRelease({
    fetchImpl: async (url) => {
      calls.push(url);
      if (calls.length === 1)
        return new Promise((resolve) => {
          resolveRelease = resolve;
        });
      return new Promise(() => {});
    },
  });
  t.mock.timers.tick(9_000);
  resolveRelease(json(release));
  // Let the streamed release JSON finish before the tag request.
  for (let i = 0; i < 30 && calls.length < 2; i++) await Promise.resolve();
  assert.equal(calls.length, 2);
  t.mock.timers.tick(1_000);
  await assert.rejects(result, /Release verification timed out/);
});

test("validates repository names before any request and honors an explicit repository", async () => {
  for (const repository of [
    "https://evil.invalid/owner/repo",
    "owner/../repo",
    "owner/repo?token=private",
    "owner/repo\n",
    "owner/.git",
    null,
  ])
    await assert.rejects(
      resolveStableRelease({ repository, fetchImpl: () => assert.fail("network request") }),
      /Invalid release repository/,
    );
  const { fetchImpl, calls } = fixture([
    { ...release, html_url: "https://github.com/example/project/releases/tag/v0.6.0" },
    ref,
  ]);
  await resolveStableRelease({ repository: "example/project", fetchImpl });
  assert.ok(calls.every((call) => call.url.startsWith("https://api.github.com/repos/example/project/")));
});

test("compares only stable semantic versions numerically", () => {
  assert.equal(compareVersions("0.6.0", "0.6.0"), 0);
  assert.equal(compareVersions("0.9.0", "0.10.0"), -1);
  assert.equal(compareVersions("1.0.0", "0.99.99"), 1);
  assert.equal(compareVersions("2.0.10", "2.0.2"), 1);
  assert.equal(compareVersions("9007199254740993.0.0", "9007199254740992.0.0"), 1);
  for (const value of ["v1.0.0", "01.0.0", "1.0", "1.0.0-beta.1", "1.0.0+build", "1.0.0\n", 1, null])
    assert.throws(() => compareVersions(value, "1.0.0"), /Invalid stable version/);
});
