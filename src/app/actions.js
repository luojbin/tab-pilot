import browser from '../platform/browser.js';

/**
 * TabPilot 动作执行层
 *
 * 这是唯一直接调用 browser.tabs.group / browser.tabGroups.* 的层，
 * 规则引擎只产出“命中了哪条规则”，不关心浏览器 API。
 *
 * 一条规则对应一个分组，分组属性直接取自规则（name / color / collapsed）。
 */
const FALLBACK_COLOR = 'grey';

function colorOf(rule) {
  return rule && typeof rule.color === 'string' && rule.color ? rule.color : FALLBACK_COLOR;
}

function nameOf(rule) {
  return rule && typeof rule.name === 'string' ? rule.name : '';
}

async function findGroupByTitle(windowId, title) {
  const groups = await browser.tabGroups.query({ windowId });
  return groups.find((group) => group.title === title) || null;
}

/** 只把与目标值不同的字段放进 patch，避免无意义的更新事件。 */
function buildGroupPatch(group, rule) {
  const patch = {};
  if (group.title !== nameOf(rule)) patch.title = nameOf(rule);
  if (group.color !== colorOf(rule)) patch.color = colorOf(rule);
  if (typeof rule.collapsed === 'boolean' && group.collapsed !== rule.collapsed) {
    patch.collapsed = rule.collapsed;
  }
  return patch;
}

/**
 * @param {object} rule 命中的规则，其 name / color / collapsed 决定分组属性
 * @param {object} tab 触发事件的标签页，始终会被归组
 * @param {Array<object>} [companions] 同一规则下要一起归组的其他标签页
 */
async function applyRule(rule, tab, companions) {
  const groupName = nameOf(rule);
  if (groupName === '') {
    return { ok: false, error: '规则的 name 为空，无法确定目标分组' };
  }

  const windowId = tab.windowId;
  const existing = await findGroupByTitle(windowId, groupName);

  // 目标标签一定在列；其余只在“尚未归入任何分组”时才一并移动，
  // 避免把手动整理到别的组里的标签硬拽过来。
  const tabIds = [tab.id];
  for (const other of companions || []) {
    if (!other || other.id === tab.id || other.windowId !== windowId) continue;
    if (other.groupId !== -1) continue;
    tabIds.push(other.id);
  }

  if (existing) {
    const patch = buildGroupPatch(existing, rule);
    if (Object.keys(patch).length > 0) {
      await browser.tabGroups.update(existing.id, patch);
    }
    // 幂等：已在该组内且无新增标签则不再触发分组操作，避免 onUpdated 反复触发
    if (tab.groupId === existing.id && tabIds.length === 1) {
      return { ok: true, skipped: true, groupId: existing.id, created: false, tabIds };
    }
    await browser.tabs.group({ tabIds, groupId: existing.id });
    return { ok: true, skipped: false, groupId: existing.id, created: false, tabIds };
  }

  // 先建组，再单独设属性：tabs.group 的 createProperties 只保证支持 windowId，
  // title / color / collapsed 用 tabGroups.update 设置才是跨浏览器都稳的路径。
  const groupId = await browser.tabs.group({
    tabIds,
    createProperties: { windowId }
  });

  const updateProperties = { title: groupName, color: colorOf(rule) };
  if (typeof rule.collapsed === 'boolean') {
    updateProperties.collapsed = rule.collapsed;
  }
  await browser.tabGroups.update(groupId, updateProperties);

  return { ok: true, skipped: false, groupId, created: true, tabIds };
}

/**
 * @param {object} rule 命中的规则
 * @param {object} tab 触发事件的标签页
 * @param {{tabs?: Array, tabIds?: number[]}} [context] 需要一起归组的候选标签
 */
async function apply(rule, tab, context) {
  if (!rule || !tab) return [{ ok: false, error: '缺少规则或标签页信息' }];

  // 版本不支持时给出明确日志，而不是抛一个难懂的 TypeError
  if (!browser.tabs || typeof browser.tabs.group !== 'function' || !browser.tabGroups) {
    return [
      {
        ok: false,
        error: '当前浏览器不支持 tabs.group / tabGroups API（Firefox 140+ / Chromium 116+）'
      }
    ];
  }

  const ctx = context || {};
  const wanted = new Set(
    Array.isArray(ctx.tabIds) && ctx.tabIds.length > 0 ? ctx.tabIds : [tab.id]
  );
  const companions = Array.isArray(ctx.tabs)
    ? ctx.tabs.filter((item) => item && wanted.has(item.id))
    : [];

  try {
    return [await applyRule(rule, tab, companions)];
  } catch (err) {
    return [{ ok: false, error: String((err && err.message) || err) }];
  }
}

export { apply, applyRule, findGroupByTitle, buildGroupPatch, colorOf, nameOf };
