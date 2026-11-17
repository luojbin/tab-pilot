TabPilot — Plugin Overview

TabPilot is a lightweight tab manager: it groups tabs by URL rules, colors the groups, shows an in-page marker on matching pages, and rewrites tab titles with rules. It runs fully locally — no network requests, no data collection. 

Features
- Auto-grouping: new tabs go into the matching group with the configured color and collapse state.
- Manual re-sync: re-applies the rules to open tabs when you save the config or click the toolbar button.
- In-page highlight: a colored border and group-name banner on matching pages, so you can tell which environment you are in at a glance.
- Tab renaming: rewrite titles with regular expressions, including capture-group reordering and prefixes, with a multi-line preview.
- Backup and restore: export / import the config as JSON to move it between machines or after reinstalling.

How rules work
- One rule = one group; a group can have multiple match patterns and matches if any of them does.
- Group order is priority. A rule can require a minimum number of matching tabs in the same window before grouping.
- Match patterns accept shorthand such as localhost or 192.168.0.123:3000 and are expanded on save.
- Each rule and the global switch can be turned off at any time.

Details
- Highlights support borders on any side and banners on edges or corners, with adjustable width, size, font size and opacity.
- Title rules match in order and stop at the first match; replacements support $1, $<name>, $& and more.
- The settings page is available in Chinese and English and follows the browser language by default.

Permissions and privacy
- In-page highlights and title rewriting need permission to access all websites. On Firefox you can grant / revoke it in the settings page; on Edge / Chrome manage it under the extension details' site access settings.
- No network requests, no data collection, no analytics; the config is stored locally.
