import { expandPattern } from './rules.js';

/** 只取网站 origin，避免将路径、账号或查询参数写入默认规则。 */
export function websitePattern(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? `${url.origin}/*` : null;
  } catch { return null; }
}

/** 与配置页共用扩写；只接受单行 HTTP(S) / 通配协议匹配路径。 */
export function expandWebsiteInput(value) {
  if (typeof value !== 'string' || /\s/.test(value.trim())) return [];
  const patterns = expandPattern(value);
  if (!patterns.length) return [];
  for (const pattern of patterns) {
    const match = /^(https?|\*):\/\/([^/]+)\//.exec(pattern);
    if (!match || /[@?#]/.test(match[2])) return [];
    try {
      const host = match[2].replace(/:\*$/, ':1234').replaceAll('*', 'example');
      if (!new URL(`https://${host}/`).hostname) return [];
    } catch { return []; }
  }
  return patterns;
}

// 只排除本插件发起的归组，保留浏览器或用户之后拖入其他组的事件。
const automatic = new Map();
export function markAutomaticGrouping(ids, groupId = null) {
  const now = Date.now();
  for (const [id, item] of automatic) if (item.expires < now) automatic.delete(id);
  for (const id of ids) automatic.set(id, { groupId, expires: now + 10000 });
}
export function consumeAutomaticGrouping(id, groupId) {
  const item = automatic.get(id);
  if (!item) return false;
  if (item.expires < Date.now()) { automatic.delete(id); return false; }
  if (item.groupId !== null && item.groupId !== groupId) return false;
  automatic.delete(id);
  return true;
}
export function clearAutomaticGrouping(ids) {
  for (const id of ids) automatic.delete(id);
}

export function finishAutomaticGrouping(ids, groupId) {
  for (const id of ids) {
    const item = automatic.get(id);
    if (item) item.groupId = groupId;
  }
}
