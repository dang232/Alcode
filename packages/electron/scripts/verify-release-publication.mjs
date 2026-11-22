#!/usr/bin/env node
// Asserts that a release publication actually completed: the release exists,
// is public (not a draft, not a prerelease), carries the Windows x64
// installer, and the live latest.yml reports the same version. A release run
// that dies before finalize-release publishes leaves a draft behind while
// releases/latest/download/latest.yml keeps serving the previous version, so
// nothing downstream notices; this check turns that state into a failed job.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const windowsX64Asset = (version) => `Alcode-${version}-win-x64.exe`;

// gh reads GITHUB_TOKEN from the environment, and `release view` answers for
// drafts too - the by-tag REST endpoint answers 404 for them.
export const ghReleaseLookup = (repo, tag) => {
  const stdout = execFileSync(
    'gh',
    ['release', 'view', tag, '--repo', repo, '--json', 'isDraft,isPrerelease,assets'],
    { encoding: 'utf8' },
  );
  return JSON.parse(stdout);
};

// releases/latest only resolves to a published, non-prerelease release, so
// this URL is exactly what an updater following the latest channel receives.
export const liveLatestYmlLookup = async (repo) => {
  const url = `https://github.com/${repo}/releases/latest/download/latest.yml`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
};

export const verifyReleasePublication = async ({
  tag,
  repo,
  fetchRelease = ghReleaseLookup,
  fetchLatestYml = liveLatestYmlLookup,
  checkLatest = true,
}) => {
  const version = tag.replace(/^v/, '');
  const releaseTag = `v${version}`;

  let release;
  try {
    release = await fetchRelease(repo, releaseTag);
  } catch (error) {
    const detail = (error.stderr ? String(error.stderr) : error.message || '').trim().split('\n')[0];
    throw new Error(`release ${releaseTag} not found in ${repo}${detail ? `: ${detail}` : ''}`);
  }

  if (release.isDraft) {
    throw new Error(`release ${releaseTag} is still a DRAFT; finalize-release did not publish it`);
  }
  if (release.isPrerelease) {
    throw new Error(`release ${releaseTag} is marked prerelease; it is not the stable publication`);
  }

  const expectedAsset = windowsX64Asset(version);
  const assetNames = (release.assets || []).map((asset) => asset.name);
  if (!assetNames.includes(expectedAsset)) {
    throw new Error(
      `release ${releaseTag} is missing the Windows x64 asset ${expectedAsset}; assets: ${assetNames.join(', ') || '(none)'}`,
    );
  }

  if (checkLatest) {
    let latestYml;
    try {
      latestYml = await fetchLatestYml(repo);
    } catch (error) {
      throw new Error(`live latest.yml for ${repo} could not be read: ${error.message}`);
    }
    const reportedVersion = latestYml.match(/^version:\s*(\S+)\s*$/m)?.[1];
    if (reportedVersion !== version) {
      throw new Error(
        `live latest.yml for ${repo} reports version ${reportedVersion || '(missing)'}, expected ${version} for ${releaseTag}`,
      );
    }
  }

  return { tag: releaseTag, repo, version, asset: expectedAsset };
};

const main = async () => {
  const finish = process.argv.includes('--finish');
  const [tag, repo] = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
  if (!tag || !repo) {
    throw new Error('Usage: verify-release-publication.mjs <tag|version> <repo> [--finish]');
  }
  const result = await verifyReleasePublication({ tag, repo, checkLatest: !finish });
  console.log(
    `release publication verified: ${result.tag} is public with ${result.asset}${finish ? ' (finish run: latest.yml not compared)' : ` and live latest.yml reports ${result.version}`}`,
  );
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
