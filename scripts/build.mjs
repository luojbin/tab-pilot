/**
 * 打包扩展为 zip（Firefox 临时加载 / AMO 上传都用它）
 *
 * 不依赖任何第三方包：自己按 ZIP 格式写文件（deflate 用 node:zlib）。
 * 只打包扩展运行需要的文件，测试、文档、脚本本身都不进包。
 *
 * 用法：npm run build
 * 产物：output/tabpilot-<version>.zip
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

const INCLUDE = ['manifest.json', 'LICENSE'];
const INCLUDE_DIRS = ['src', 'icons'];
const EXCLUDE_DIRS = new Set(['test', 'docs', 'output', 'node_modules', 'scripts', '.git']);

function listFiles(dir, relative) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      files.push(...listFiles(full, rel));
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
  return files;
}

const entries = [];
for (const file of INCLUDE) {
  if (fs.existsSync(path.join(root, file))) entries.push(file);
}
for (const dir of INCLUDE_DIRS) {
  const full = path.join(root, dir);
  if (fs.existsSync(full)) entries.push(...listFiles(full, dir));
}
entries.sort();

// ---------------- 最小 ZIP 写入 ----------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

const localParts = [];
const centralParts = [];
let offset = 0;

for (const name of entries) {
  const data = fs.readFileSync(path.join(root, name));
  const compressed = zlib.deflateRawSync(data, { level: 9 });
  const nameBytes = Buffer.from(name, 'utf8');
  const crc = crc32(data);
  const { time, day } = dosDateTime(fs.statSync(path.join(root, name)).mtime);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // UTF-8 文件名
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(day, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28);

  localParts.push(local, nameBytes, compressed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(day, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(offset, 42);

  centralParts.push(central, nameBytes);
  offset += local.length + nameBytes.length + compressed.length;
}

const centralDirectory = Buffer.concat(centralParts);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(entries.length, 8);
eocd.writeUInt16LE(entries.length, 10);
eocd.writeUInt32LE(centralDirectory.length, 12);
eocd.writeUInt32LE(offset, 16);
eocd.writeUInt16LE(0, 20);

const zip = Buffer.concat([...localParts, centralDirectory, eocd]);

const outDir = path.join(root, 'output');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `tabpilot-${manifest.version}.zip`);
fs.writeFileSync(outFile, zip);

const kb = (zip.length / 1024).toFixed(1);
console.log(`已打包 ${entries.length} 个文件 -> ${path.relative(root, outFile)} (${kb} KB)`);
for (const name of entries) console.log(`  ${name}`);
