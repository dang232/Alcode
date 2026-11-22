import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyReleasePublication } from './verify-release-publication.mjs';

const repo = 'dang232/Alcode';
const version = '9.9.9';
const tag = `v${version}`;
const asset = `Alcode-${version}-win-x64.exe`;

const publishedRelease = {
  isDraft: false,
  isPrerelease: false,
  assets: [{ name: asset }, { name: `${asset}.blockmap` }],
};

const latestYml = `version: ${version}
files:
  - url: ${asset}
    sha512: checksum
    size: 123
releaseDate: '2026-11-19T00:00:00.000Z'
`;

// Both lookups are mocked: the tests never touch gh or the network.
const lookups = ({ release = publishedRelease, releaseError, latest = latestYml, latestError } = {}) => {
  const calls = { release: [], latest: [] };
  return {
    calls,
    fetchRelease: async (actualRepo, actualTag) => {
      calls.release.push([actualRepo, actualTag]);
      if (releaseError) throw releaseError;
      return release;
    },
    fetchLatestYml: async (actualRepo) => {
      calls.latest.push(actualRepo);
      if (latestError) throw latestError;
      return latest;
    },
  };
};

test('accepts a fully published release whose live latest.yml matches', async () => {
  const mocked = lookups();

  const result = await verifyReleasePublication({ tag, repo, ...mocked });

  assert.deepEqual(result, { tag, repo, version, asset });
  assert.deepEqual(mocked.calls.release, [[repo, tag]]);
  assert.deepEqual(mocked.calls.latest, [repo]);
});

test('accepts a bare version and looks up the v-prefixed tag', async () => {
  const mocked = lookups();

  const result = await verifyReleasePublication({ tag: version, repo, ...mocked });

  assert.equal(result.tag, tag);
  assert.deepEqual(mocked.calls.release, [[repo, tag]]);
});

test('a finish run accepts an older release without comparing latest.yml', async () => {
  const mocked = lookups({ latest: 'version: 0.0.1\n' });

  const result = await verifyReleasePublication({ tag, repo, checkLatest: false, ...mocked });

  assert.deepEqual(result, { tag, repo, version, asset });
  assert.deepEqual(mocked.calls.latest, []);
});

test('fails when the release does not exist', async () => {
  const mocked = lookups({ releaseError: new Error('release not found') });

  await assert.rejects(
    verifyReleasePublication({ tag, repo, ...mocked }),
    new RegExp(`release ${tag} not found in ${repo}`),
  );
});

test('fails while the release is still a draft', async () => {
  const mocked = lookups({ release: { ...publishedRelease, isDraft: true } });

  await assert.rejects(
    verifyReleasePublication({ tag, repo, ...mocked }),
    new RegExp(`release ${tag} is still a DRAFT`),
  );
});

test('fails on a prerelease', async () => {
  const mocked = lookups({ release: { ...publishedRelease, isPrerelease: true } });

  await assert.rejects(
    verifyReleasePublication({ tag, repo, ...mocked }),
    new RegExp(`release ${tag} is marked prerelease`),
  );
});

test('fails without the Windows x64 installer on the release', async () => {
  const mocked = lookups({
    release: { ...publishedRelease, assets: [{ name: `${asset}.blockmap` }] },
  });

  await assert.rejects(
    verifyReleasePublication({ tag, repo, ...mocked }),
    new RegExp(`release ${tag} is missing the Windows x64 asset ${asset}`),
  );
});

test('fails when the live latest.yml reports a different version', async () => {
  const mocked = lookups({ latest: latestYml.replace(`version: ${version}`, 'version: 9.9.8') });

  await assert.rejects(
    verifyReleasePublication({ tag, repo, ...mocked }),
    new RegExp(`live latest\\.yml for ${repo} reports version 9\\.9\\.8, expected ${version} for ${tag}`),
  );
});

test('fails when the live latest.yml cannot be read', async () => {
  const mocked = lookups({ latestError: new Error(`HTTP 404 for https://github.com/${repo}/releases/latest/download/latest.yml`) });

  await assert.rejects(
    verifyReleasePublication({ tag, repo, ...mocked }),
    new RegExp(`live latest\\.yml for ${repo} could not be read: HTTP 404`),
  );
});
