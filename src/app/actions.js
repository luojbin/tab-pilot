import { normalizeTabGroup, tabGroupEnabled } from '../core/tab-group.js';
import browser from '../platform/browser.js';
import { markAutomaticGrouping, clearAutomaticGrouping, finishAutomaticGrouping } from '../core/manual-group-rule.js';

/**
 * TabPilot 动作执行层
 *
 * 这是唯一直接调用 browser.tabs.group / browser.tabGroups.* 的层，
 * 规则引擎只产出“命中了哪条规则”，不关心浏览器 API。
 *
 * 一条规则对应一个分组，分组属性取自规则的 name / color 及 tabGroup.collapsed。
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

/** 名称/颜色只更新差异字段；折叠单独在实际入组后处理。 */
function buildGroupPatch(group, rule) {
  const patch = {};
  if (group.title !== nameOf(rule)) patch.title = nameOf(rule);
  if (group.color !== colorOf(rule)) patch.color = colorOf(rule);
  return patch;
}

/**
 * @param {object} rule 命中的规则，其 name / color / tabGroup.collapsed 决定分组属性
 * @param {object} tab 触发事件的标签页，始终会被归组
 * @param {Array<object>} [companions] 同一规则下要一起归组的其他标签页
 */
async function applyRule(rule, tab, companions) {
  if (!tabGroupEnabled(rule)) return { ok: true, skipped: true, reason: 'tab-group-disabled', tabIds: [] };
  const groupOptions = normalizeTabGroup(rule);
  const groupName = nameOf(rule);
  if (groupName === '') {
    return { ok: false, error: '规则的 name 为空，无法确定目标分组' };
  }

  const windowId = tab.windowId;
  const existing = await findGroupByTitle(windowId, groupName);

  // 读取最新成员，避免同批阈值处理或延迟事件使用旧快照重复触发折叠。
  const currentTabs = await browser.tabs.query({ windowId });
  const current = currentTabs.find(item => item.id === tab.id);
  if (!current) return { ok: true, skipped: true, reason: 'tab-gone', tabIds: [] };
  const tabIds = existing && current.groupId === existing.id ? [] : [current.id];
  const companionIds = new Set((companions || []).map(item => item?.id));
  for (const other of currentTabs) {
    if (other.id === current.id || !companionIds.has(other.id) || other.groupId !== -1) continue;
    tabIds.push(other.id);
  }

  if (existing) {
    const patch = buildGroupPatch(existing, rule);
    const entering = tabIds.length > 0;
    if (entering) {
      markAutomaticGrouping(tabIds, existing.id);
      try {
        await browser.tabs.group({ tabIds, groupId: existing.id });
      } catch (err) {
        clearAutomaticGrouping(tabIds);
        throw err;
      }
      // 自动折叠仅在实际有标签入组成功后触发；关闭也不主动展开已有组。
      if (groupOptions.collapsed === true) patch.collapsed = true;
    }
    if (Object.keys(patch).length > 0) await browser.tabGroups.update(existing.id, patch);
    return { ok: true, skipped: !entering, groupId: existing.id, created: false, tabIds };
  }

  // 先建组，再单独设属性：tabs.group 的 createProperties 只保证支持 windowId，
  // title / color / collapsed 用 tabGroups.update 设置才是跨浏览器都稳的路径。
  markAutomaticGrouping(tabIds);
  let groupId;
  try {
    groupId = await browser.tabs.group({ tabIds, createProperties: { windowId } });
    finishAutomaticGrouping(tabIds, groupId);
  } catch (err) {
    clearAutomaticGrouping(tabIds);
    throw err;
  }

  const updateProperties = { title: groupName, color: colorOf(rule) };
  if (typeof groupOptions.collapsed === 'boolean') {
    updateProperties.collapsed = groupOptions.collapsed;
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

  if (!tabGroupEnabled(rule) || context?.thresholdMet === false) return [{ ok: true, skipped: true, reason: 'group-not-requested' }];

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
