const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const asar = require('@electron/asar');

const defaultRoot = path.resolve(__dirname, '..');
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
const isExcludedNative = relative => /^src\/native\/[^/]+\.exe$/i.test(relative);

// Match this application's source whitelist without traversing unrelated workspace data.
async function listSourceFiles(rootDir, relative = 'src') {
  const directory = path.join(rootDir, relative);
  const info = await fs.lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('源码目录必须是普通目录：' + relative);
  const files = [], excluded = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const child = relative + '/' + entry.name;
    if (isExcludedNative(child)) {
      excluded.push(child);
    } else if (entry.isSymbolicLink()) {
      throw new Error('源码校验不跟随符号链接：' + child);
    } else if (entry.isDirectory()) {
      const nested = await listSourceFiles(rootDir, child);
      files.push(...nested.files);
      excluded.push(...nested.excluded);
    } else if (entry.isFile()) {
      files.push(child);
    } else {
      throw new Error('源码包含非普通文件：' + child);
    }
  }
  return { files: files.sort(), excluded: excluded.sort() };
}

function archiveName(entry) {
  const relative = entry.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!relative || relative.includes('\0') || relative.includes(':') ||
      relative.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('归档包含无效路径：' + JSON.stringify(entry));
  }
  return relative;
}

async function verifyPackageSource({ rootDir = defaultRoot, archivePath } = {}) {
  rootDir = path.resolve(rootDir);
  const sourcePackage = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
  const version = String(sourcePackage.version || 'unknown');
  const outputDir = sourcePackage.build?.directories?.output;
  archivePath = archivePath
    ? path.resolve(rootDir, archivePath)
    : path.resolve(rootDir, outputDir || 'dist', 'win-unpacked', 'resources', 'app.asar');
  const reportPath = path.join(rootDir, 'outputs', 'verification',
    'package-source-' + version.replace(/[^0-9A-Za-z._-]/g, '_') + '.json');
  const report = {
    passed: false,
    generatedAt: new Date().toISOString(),
    version,
    archive: archivePath,
    reportPath,
    expectedFileCount: 0,
    packagedFileCount: 0,
    metadata: null,
    files: [],
    excludedNativeExecutables: [],
    missingFiles: [],
    unexpectedFiles: [],
    errors: []
  };
  try {
    const source = await listSourceFiles(rootDir);
    const expected = new Set(['package.json', 'LICENSE', ...source.files]);
    report.expectedFileCount = expected.size;
    report.excludedNativeExecutables = source.excluded;
    asar.uncache(archivePath);
    const packaged = new Map();
    for (const entry of asar.listPackage(archivePath)) {
      const relative = archiveName(entry);
      const info = asar.statFile(archivePath, relative.split('/').join(path.sep), false);
      if ('files' in info) continue;
      if ('link' in info) {
        report.errors.push({ path: relative, message: '归档文件不能是符号链接。' });
        continue;
      }
      if (packaged.has(relative)) throw new Error('归档包含重复路径：' + relative);
      packaged.set(relative, info);
    }
    report.packagedFileCount = packaged.size;
    report.missingFiles = [...expected].filter(file => !packaged.has(file)).sort();
    // Unexpected archive entries fail without reading similarly named private local files.
    report.unexpectedFiles = [...packaged.keys()].filter(file => !expected.has(file)).sort();

    if (packaged.has('package.json')) {
      try {
        const packedPackage = JSON.parse(asar.extractFile(archivePath, 'package.json', false).toString('utf8'));
        const fields = ['name', 'version', 'main'].map(field => ({
          field, source: sourcePackage[field], packaged: packedPackage[field],
          matches: typeof sourcePackage[field] === 'string' &&
            sourcePackage[field].length > 0 && packedPackage[field] === sourcePackage[field]
        }));
        const sourceHasProductName = Object.hasOwn(sourcePackage, 'productName');
        const packagedHasProductName = Object.hasOwn(packedPackage, 'productName');
        report.metadata = {
          passed: fields.every(field => field.matches) && !sourceHasProductName && !packagedHasProductName,
          fields, sourceHasProductName, packagedHasProductName
        };
      } catch (error) {
        report.errors.push({ path: 'package.json', message: error.message });
      }
    }

    for (const relative of [...expected].sort()) {
      if (relative === 'package.json' || !packaged.has(relative)) continue;
      try {
        const localPath = path.join(rootDir, relative);
        const sourceInfo = await fs.lstat(localPath);
        if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) throw new Error('本地输入必须是普通文件。');
        const local = await fs.readFile(localPath);
        const packed = asar.extractFile(archivePath, relative.split('/').join(path.sep), false);
        report.files.push({
          path: relative,
          matches: local.equals(packed),
          sourceBytes: local.length,
          packagedBytes: packed.length,
          sourceSha256: sha256(local),
          packagedSha256: sha256(packed),
          unpacked: Boolean(packaged.get(relative).unpacked)
        });
      } catch (error) {
        report.errors.push({ path: relative, message: error.message });
      }
    }
    report.passed = report.metadata?.passed === true &&
      report.missingFiles.length === 0 && report.unexpectedFiles.length === 0 &&
      report.errors.length === 0 && report.files.every(file => file.matches);
  } catch (error) {
    report.errors.push({ message: error.message });
  } finally {
    asar.uncache(archivePath);
  }
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('用法：node scripts/verify-package-source.cjs [app.asar 路径]\n省略路径时使用 package.json 的 build.directories.output；报告保存在 outputs/verification/package-source-<version>.json。');
    return;
  }
  if (args.length > 1) throw new Error('只接受一个可选的 app.asar 路径；使用 --help 查看用法。');
  const report = await verifyPackageSource({ archivePath: args[0] });
  const mismatches = report.files.filter(file => !file.matches).map(file => file.path);
  console.log(JSON.stringify({
    passed: report.passed, version: report.version,
    sourceFilesCompared: report.files.length,
    metadataMatches: report.metadata?.passed === true,
    missingFiles: report.missingFiles,
    unexpectedFiles: report.unexpectedFiles,
    mismatchedFiles: mismatches,
    errors: report.errors,
    reportPath: report.reportPath
  }, null, 2));
  if (!report.passed) process.exitCode = 1;
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { verifyPackageSource };
