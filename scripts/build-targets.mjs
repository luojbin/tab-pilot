/**
 * 多目标构建：Firefox / Chromium（Chrome + Edge 共用）
 *
 * - manifests/base.json 放共享字段
 * - manifests/manifest.<target>.json 放该目标独有的字段
 * - 版本号统一从 package.json 注入
 * - 产物：dist/<target>/ 与 output/tabpilot-<version>-<target>.zip
 *
 * 用法：
 *   node scripts/build-targets.mjs            # 两个目标都构建
 *   node scripts/build-targets.mjs firefox
 *   node scripts/build-targets.mjs chromium
 */
import fs from 'node:fs';
import path from 'node:path';
import { ZipArchive } from 'archiver';
import { fileURLToPath } from 'node:url';
import { build as bundle } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const TARGETS = {
  firefox: {
    manifest: 'manifest.firefox.json',
    output: (version) => `tabpilot-${version}-firefox.zip`
  },
  chromium: {
    manifest: 'manifest.chromium.json',
    output: (version) => `tabpilot-${version}-chromium.zip`
  }
};

const COPY_ENTRIES = ['_locales', 'icons', 'LICENSE', 'src/ui/options.html'];
const ENTRY_POINTS = ['src/app/background.js', 'src/app/content.js', 'src/ui/options.js'];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function buildManifest(target) {
  const base = readJson('manifests/base.json');
  const overlay = readJson(path.join('manifests', TARGETS[target].manifest));
  return { ...base, ...overlay, version: pkg.version };
}

function zipDirectory(dir, outFile) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outFile);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', reject);
    archive.pipe(output);
    archive.directory(dir, false);
    archive.finalize().catch(reject);
  });
}

async function build(target) {
  const config = TARGETS[target];
  if (!config) throw new Error(`未知构建目标：${target}`);

  const distDir = path.join(root, 'dist', target);
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  fs.writeFileSync(
    path.join(distDir, 'manifest.json'),
    `${JSON.stringify(buildManifest(target), null, 2)}\n`,
    'utf8'
  );

  for (const entry of COPY_ENTRIES) {
    fs.mkdirSync(path.dirname(path.join(distDir, entry)), { recursive: true });
    fs.cpSync(path.join(root, entry), path.join(distDir, entry), { recursive: true });
  }

  // 源码使用 ESM，三个入口分别打包成普通脚本，供后台/内容脚本/配置页加载。
  await bundle({
    absWorkingDir: root,
    entryPoints: ENTRY_POINTS,
    outbase: '.',
    outdir: distDir,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: target === 'firefox' ? 'firefox140' : 'chrome116',
    charset: 'utf8',
    minify: false
  });

  const outDir = path.join(root, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, config.output(pkg.version));
  fs.rmSync(outFile, { force: true });
  await zipDirectory(distDir, outFile);

  const kb = (fs.statSync(outFile).size / 1024).toFixed(1);
  console.log(`[${target}] ${path.relative(root, outFile)} (${kb} KB)`);
}

const requested = process.argv.slice(2);
const targets = requested.length > 0 ? requested : Object.keys(TARGETS);
for (const target of targets) {
  if (!TARGETS[target]) throw new Error(`未知构建目标：${target}`);
}
for (const target of targets) {
  await build(target);
}
