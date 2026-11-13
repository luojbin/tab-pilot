/**
 * 多目标构建：Firefox / Chromium（Chrome + Edge 共用）
 *
 * - manifests/base.json 放共享字段
 * - manifests/manifest.<target>.json 放该目标独有的字段
 * - 版本号统一从 package.json 注入
 * - 产物：dist/<target>/ 与 output/tabpilot-<version>[-chromium].zip
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

const COPY_ENTRIES = ['src', 'icons', 'LICENSE'];

const CHROMIUM_SHIM_TAG = '<script src="../platform/chromium/browser-shim.js"></script>';

/**
 * Chromium 的配置页需要先加载 browser shim；Firefox 自带 browser，不注入。
 * options.html 是共享文件，这里只在 Chromium 产物里插入一个 script 标签。
 */
function injectChromiumOptionsShim(distDir) {
  const page = path.join(distDir, 'src/ui/options.html');
  let html = fs.readFileSync(page, 'utf8');
  if (html.includes(CHROMIUM_SHIM_TAG)) return;

  const storeTag = '<script src="../app/store.js"></script>';
  if (!html.includes(storeTag)) {
    throw new Error('options.html 缺少 store.js 脚本标签，无法注入 Chromium shim');
  }
  html = html.replace(storeTag, `${CHROMIUM_SHIM_TAG}\n${storeTag}`);
  fs.writeFileSync(page, html, 'utf8');
}

// 某个目标专用的源文件，不复制到其他目标的产物里
const TARGET_EXCLUDES = {
  firefox: ['src/platform/chromium'],
  chromium: []
};

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
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(dir, false);
    archive.finalize();
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
    fs.cpSync(path.join(root, entry), path.join(distDir, entry), { recursive: true });
  }

  for (const relativePath of TARGET_EXCLUDES[target] || []) {
    fs.rmSync(path.join(distDir, relativePath), { recursive: true, force: true });
  }

  // 排除后若 platform 目录已空，一并删掉，避免产物里留空目录
  const platformDir = path.join(distDir, 'src', 'platform');
  if (fs.existsSync(platformDir) && fs.readdirSync(platformDir).length === 0) {
    fs.rmdirSync(platformDir);
  }

  if (target === 'chromium') {
    injectChromiumOptionsShim(distDir);
  }

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
  await build(target);
}
