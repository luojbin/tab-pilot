/**
 * Chromium 兼容层
 *
 * Firefox 自带 `browser` 命名空间；Chromium 只有 `chrome`。
 * 其他脚本统一使用 `browser.*`，所以在最前面把 `chrome` 暴露成 `browser`。
 */
(function (global) {
  'use strict';
  if (!global.browser && typeof global.chrome !== 'undefined') {
    global.browser = global.chrome;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
