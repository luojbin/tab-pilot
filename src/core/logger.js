/**
 * TabPilot 日志层
 *
 * v0.1.0 只做控制台输出 + 内存环形缓冲，供 background 调试用。
 * v0.3.0 接入日志页时把缓冲换成 storage.local 落盘，接口保持不变。
 */
const MAX_ENTRIES = 200;
const buffer = [];
let sequence = 0;

function record(level, message, detail) {
  const entry = {
    seq: (sequence += 1),
    time: new Date().toISOString(),
    level,
    message,
    detail: detail === undefined ? null : detail
  };

  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ENTRIES);
  }

  const line = `[TabPilot] ${entry.time} ${level.toUpperCase()} ${message}`;
  const payload = detail === undefined ? undefined : detail;
  if (level === 'error') console.error(line, payload);
  else if (level === 'warn') console.warn(line, payload);
  else console.log(line, payload);

  return entry;
}

function info(message, detail) {
  return record('info', message, detail);
}

function warn(message, detail) {
  return record('warn', message, detail);
}

function error(message, detail) {
  return record('error', message, detail);
}

/** 最近 limit 条（默认全部，最多 MAX_ENTRIES 条）。 */
function recent(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return buffer.slice();
  return buffer.slice(-Math.min(MAX_ENTRIES, Math.floor(n)));
}

function clear() {
  buffer.length = 0;
}

export { MAX_ENTRIES, info, warn, error, recent, clear };
