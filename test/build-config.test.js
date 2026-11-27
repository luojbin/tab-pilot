import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TARGETS, mergeManifest, buildDefines } from '../scripts/build-config.mjs';
import { COLOR_THEME_IDS, COLOR_LABEL_SETS } from '../src/core/color-themes.js';

const json = file => JSON.parse(fs.readFileSync(new URL(`../manifests/${file}`, import.meta.url)));

test('权限合并为去重并集，普通字段覆盖，输入不变', () => {
  const base = { permissions: ['tabs', 'storage'], host_permissions: ['https://a/*'], name: 'Base' };
  const overlay = { permissions: ['storage', 'menus'], host_permissions: ['https://b/*'], optional_permissions: ['notifications'], name: 'Target' };
  const result = mergeManifest(base, overlay, '1.2.3');
  assert.deepEqual(result.permissions, ['tabs', 'storage', 'menus']);
  assert.deepEqual(result.host_permissions, ['https://a/*', 'https://b/*']);
  assert.deepEqual(result.optional_permissions, ['notifications']);
  assert.equal(result.name, 'Target');
  assert.equal(result.version, '1.2.3');
  assert.deepEqual(base.permissions, ['tabs', 'storage']);
  assert.deepEqual(overlay.permissions, ['storage', 'menus']);
  assert.throws(() => mergeManifest(base, { permissions: 'menus' }, '1'), /must be an array/);
});

test('三个声明式目标包含编译目标、主题和独立产物，Firefox 字段不泄露', () => {
  assert.deepEqual(Object.keys(TARGETS), ['firefox', 'chrome', 'edge']);
  assert.deepEqual(Object.fromEntries(Object.entries(TARGETS).map(([target, config]) => [target, config.theme])),
    { firefox: 'firefox-light', chrome: 'chrome-light', edge: 'vivid-light' });
  const names = new Set();
  for (const [target, config] of Object.entries(TARGETS)) {
    assert.ok(config.build);
    assert.ok(COLOR_LABEL_SETS[config.colorLabels]);
    assert.equal(JSON.parse(buildDefines(target).__TABPILOT_COLOR_LABEL_SET__), target === 'edge' ? 'edge' : 'standard');
    assert.ok(COLOR_THEME_IDS.includes(config.theme));
    names.add(config.output('1.3.0'));
    const manifest = mergeManifest(json('base.json'), json(config.manifest), '1.3.0');
    for (const permission of ['tabs', 'tabGroups', 'storage']) assert.ok(manifest.permissions.includes(permission));
    if (target === 'firefox') {
      assert.ok(manifest.permissions.includes('menus'));
      assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.required, ['none']);
    } else {
      assert.ok(manifest.permissions.includes('contextMenus'));
      assert.equal(manifest.browser_specific_settings, undefined);
      assert.equal(manifest.optional_host_permissions, undefined);
    }
  }
  assert.equal(names.size, 3);
});
