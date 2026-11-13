/**
 * Chromium MV3 service worker 入口
 *
 * Chromium 的 MV3 后台是 service worker，只能指定一个入口文件；
 * 这里用 importScripts 按 Firefox background.scripts 的顺序加载，
 * 保持两边共享同一套后台代码。
 */
importScripts(
  'browser-shim.js',
  '../../core/highlight.js',
  '../../core/title-rule.js',
  '../../app/store.js',
  '../../core/logger.js',
  '../../core/rules.js',
  '../../app/actions.js',
  '../../app/background.js'
);
