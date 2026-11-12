/**
 * TabPilot 动作执行层
 *
 * 这是唯一直接调用 browser.tabs.group / browser.tabGroups.* 的层，
 * 规则引擎只产出 actions[]，不关心浏览器 API。
 *
 * 注意：Firefox 的 tab groups WebExtension API 形态需要在本机 139+ 实测确认；
 * 若 API 名称有出入，只需改这一个文件。
 */
(function (global) {
  'use strict';

  const FALLBACK_COLOR = 'grey';

  function colorOf(action) {
    return typeof action.color === 'string' ? action.color : FALLBACK_COLOR;
  }

  async function findGroupByTitle(windowId, title) {
    const groups = await browser.tabGroups.query({ windowId });
    return groups.find((group) => group.title === title) || null;
  }

  /** 只把与目标值不同的字段放进 patch，避免无意义的更新事件。 */
  function buildGroupPatch(group, action) {
    const patch = {};
    if (group.title !== action.name) patch.title = action.name;
    if (group.color !== colorOf(action)) patch.color = colorOf(action);
    if (typeof action.collapsed === 'boolean' && group.collapsed !== action.collapsed) {
      patch.collapsed = action.collapsed;
    }
    return patch;
  }

  /**
   * @param {object} action
   * @param {object} tab 触发事件的标签页，始终会被归组
   * @param {Array<object>} [companions] 同一规则下要一起归组的其他标签页
   */
  async function applyGroupAction(action, tab, companions) {
    const windowId = tab.windowId;
    const existing = await findGroupByTitle(windowId, action.name);

    // 目标标签一定在列；其余只在“尚未归入任何分组”时才一并移动，
    // 避免把手动整理到别的组里的标签硬拽过来。
    const tabIds = [tab.id];
    for (const other of companions || []) {
      if (!other || other.id === tab.id || other.windowId !== windowId) continue;
      if (other.groupId !== -1) continue;
      tabIds.push(other.id);
    }

    if (existing) {
      const patch = buildGroupPatch(existing, action);
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

    const updateProperties = { title: action.name, color: colorOf(action) };
    if (typeof action.collapsed === 'boolean') {
      updateProperties.collapsed = action.collapsed;
    }
    await browser.tabGroups.update(groupId, updateProperties);

    return { ok: true, skipped: false, groupId, created: true, tabIds };
  }

  /**
   * 依次执行动作；单个动作失败不阻断其他动作，只把错误写进结果。
   * @param {Array} actions
   * @param {object} tab 触发事件的标签页
   * @param {{tabs?: Array, tabIds?: number[]}} [context] 需要一起归组的候选标签
   * @returns {Promise<Array<{ok: boolean, groupId?: number, skipped?: boolean, error?: string, reason?: string}>>}
   */
  async function apply(actions, tab, context) {
    const results = [];
    if (!Array.isArray(actions) || !tab) return results;

    // 版本不支持时给出明确日志，而不是抛一个难懂的 TypeError
    if (!browser.tabs || typeof browser.tabs.group !== 'function' || !browser.tabGroups) {
      results.push({
        ok: false,
        error: '当前 Firefox 不支持 tabs.group / tabGroups API（需要 Firefox 139+）'
      });
      return results;
    }

    const ctx = context || {};
    const wanted = new Set(
      Array.isArray(ctx.tabIds) && ctx.tabIds.length > 0 ? ctx.tabIds : [tab.id]
    );
    const companions = Array.isArray(ctx.tabs)
      ? ctx.tabs.filter((item) => item && wanted.has(item.id))
      : [];

    for (const action of actions) {
      if (!action || action.type !== 'group') {
        results.push({
          ok: false,
          skipped: true,
          reason: `不支持的 action 类型：${action && action.type}`
        });
        continue;
      }
      try {
        results.push(await applyGroupAction(action, tab, companions));
      } catch (err) {
        results.push({ ok: false, error: String((err && err.message) || err) });
      }
    }
    return results;
  }

  const api = { apply, applyGroupAction, findGroupByTitle, buildGroupPatch };

  global.TabPilotActions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
