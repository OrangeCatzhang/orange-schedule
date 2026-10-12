// Run only after the stable release and installer are publicly downloadable.
const fs = require('node:fs');
const path = require('node:path');
const { parseRelease } = require('../src/update-checker.cjs');

function createManifest(release) {
  const parsed = parseRelease(release, '0.0.0');
  if (!parsed || !parsed.publishedAt) throw new Error('A published stable release with a valid publication date is required.');
  const name = 'OrangeSchedule-Setup-' + parsed.version + '.exe';
  const asset = release.assets.find(item => item && item.name === name);
  return {
    tag_name: 'v' + parsed.version,
    draft: false,
    prerelease: false,
    published_at: parsed.publishedAt,
    body: parsed.notes,
    assets: [{ name, state: 'uploaded', size: asset.size, browser_download_url: parsed.url }]
  };
}

if (require.main === module) {
  const input = process.argv[2];
  if (!input || process.argv.length !== 3) {
    console.error('Usage: node scripts/write-update-manifest.cjs <public-release-json>');
    process.exitCode = 1;
  } else {
    const release = JSON.parse(fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, ''));
    const manifest = createManifest(release);
    const destination = path.join(__dirname, '..', 'docs', 'updates', 'latest.json');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    console.log('Wrote ' + manifest.tag_name + ' to docs/updates/latest.json');
  }
}
module.exports = { createManifest };
