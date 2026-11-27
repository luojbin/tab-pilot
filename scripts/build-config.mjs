/** 所有目标差异集中声明；构建主流程不判断具体浏览器。 */
export const TARGETS = {
  firefox: { manifest: 'manifest.firefox.json', build: 'firefox140', theme: 'firefox-light', colorLabels: 'standard',
    output: version => `tabpilot-${version}-firefox.zip` },
  chrome: { manifest: 'manifest.chrome.json', build: 'chrome116', theme: 'chrome-light', colorLabels: 'standard',
    output: version => `tabpilot-${version}-chrome.zip` },
  edge: { manifest: 'manifest.edge.json', build: 'chrome116', theme: 'vivid-light', colorLabels: 'edge',
    output: version => `tabpilot-${version}-edge.zip` }
};

export function buildDefines(target) {
  const config = TARGETS[target];
  return {
    __TABPILOT_TARGET__: JSON.stringify(target),
    __TABPILOT_DEFAULT_THEME__: JSON.stringify(config.theme),
    __TABPILOT_COLOR_LABEL_SET__: JSON.stringify(config.colorLabels)
  };
}

/** 普通字段由 overlay 覆盖；权限声明始终做并集，避免丢失公共权限。 */
export function mergeManifest(base, overlay, version) {
  const manifest = { ...base, ...overlay, version };
  for (const key of ['permissions', 'optional_permissions', 'host_permissions', 'optional_host_permissions']) {
    if (!(key in base) && !(key in overlay)) continue;
    for (const source of [base, overlay]) {
      if (key in source && !Array.isArray(source[key])) throw new Error(`${key} must be an array`);
    }
    manifest[key] = [...new Set([...(base[key] || []), ...(overlay[key] || [])])];
  }
  return manifest;
}
