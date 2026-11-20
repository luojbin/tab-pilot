/** 工具栏结果只描述已完成的动作，不使用批量归组中的估算数量。 */
export function toolbarFeedback(result, language, failed = false) {
  const en = language === 'en';
  if (failed) return en ? 'TabPilot: Action failed. Try again.' : 'TabPilot：操作失败，请重试。';
  if (result.paused) return en ? 'TabPilot: Paused. No action taken.' : 'TabPilot：全局已暂停，未执行操作。';
  const parts = [en ? 'TabPilot: Sync complete' : 'TabPilot：同步完成'];
  const actions = {
    syncRuleCollapse: en ? 'collapsed by rule' : '按规则折叠',
    syncCollapseInactive: en ? 'collapsed inactive groups' : '折叠非活动分组',
    syncCollapseAll: en ? 'collapsed all groups' : '折叠所有分组'
  };
  if (actions[result.action]) parts.push(`${actions[result.action]} ${result.collapsed}`);
  if (result.failed) parts.push(en ? `${result.failed} failed` : `${result.failed} 项失败`);
  return parts.join(' · ');
}
