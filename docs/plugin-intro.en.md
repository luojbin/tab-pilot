# TabPilot — Plugin Overview

TabPilot is a local tab manager for Firefox, Chrome, and Edge. Shared URL rules group and color tabs, highlight pages, and rewrite titles. It makes no network requests and uploads no data.

## Features

- Auto-grouping: match URLs in rule order, set group names, colors, and collapse state, and optionally require a minimum number of matching tabs in the same window.
- Rule management: a visual two-column settings page with per-rule toggles, duplication, drag-and-drop priority, and rule drafts generated from groups in the current window.
- In-page markers: optional colored borders and group-name banners to distinguish development, test, and production environments.
- Title rewriting: apply the first matching regular expression, with capture-group reordering, prefixes, multiline testing, saved test text, and retries when pages change their titles.
- Toolbar popup: run the configured sync/collapse action, show its result for 3 seconds before fading and closing, and provide a settings shortcut.
- Groups first: optionally arrange pinned tabs, groups, then ungrouped tabs without changing group membership or relative order.
- Learn from manual grouping: ask to append an editable website pattern when a tab is moved into a group with an existing rule; unmanaged groups stay silent.
- Strict mode: optionally ungroup a tab when it navigates to an HTTP/HTTPS URL outside its current enabled rule.
- Config portability: JSON export, full replacement import, or append-only import that keeps current global settings and resolves name/id conflicts.
- Chinese and English: settings and popup follow the browser language by default, with a manual override.

## Rules and settings

One rule corresponds to one group and can contain multiple URL patterns. The first applicable rule wins. Shorthand such as localhost is expanded automatically. Duplicated and generated rules remain drafts until saved; append import saves and syncs after confirmation.

Global settings use a two-column card layout for language, toolbar behavior, and four feature switches. Manual-group rule prompts and action results are enabled by default; groups-first ordering and strict mode are off by default. There is no extension-wide pause switch; each rule can still be disabled independently.

## Permissions and privacy

HTTP/HTTPS content scripts provide page markers and title rewriting. Firefox users grant/revoke site access from settings; Chrome/Edge users manage it from the extension details page. The toolbar popup needs neither page injection nor system notifications. Firefox uses the menus permission for its toolbar icon’s Options entry.

Automatically opening a popup after grouping requires Firefox 149+ / Chromium 127+. Older versions or failed attempts use a badge so users can click the icon to respond. Core features support Firefox 140+ / Chromium 116+.

No network requests, uploads, analytics, or telemetry. Config and pending confirmations stay on the device; logs remain in memory and the console. See the [development plan](development-plan.md) for current source features and browser validation; this overview does not indicate store release status.
