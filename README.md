# Pi Atelier for OMP

This fork brings Pi Atelier v0.12.0's live sidebar to [Oh My Pi (OMP)](https://omp.sh). It uses an OMP-owned full-height sidebar slot, preserving the main transcript, editor, modal overlays, and native scrollback.

[Quick start](#quick-start) · [Features](#features) · [Use](#use) · [Configuration](#configuration) · [Troubleshooting](#troubleshooting)


## Quick start

This fork needs an OMP build with `ExtensionUIContext.setSidebar(factory, { width, minMainWidth })`. The [companion OMP sidebar branch](https://github.com/lukeanthony007/animus-ts/tree/feat/omp-atelier-sidebar/omp) supplies it. That source is based on OMP 18.1.10; stock OMP 18.3.5 lacks the slot. Run the companion branch separately rather than replacing a newer OMP installation.

From this fork's checkout, set `OMP_SOURCE` to the absolute path of the companion OMP checkout, then launch it with the extension:

```bash
export OMP_SOURCE=/absolute/path/to/patched/omp
npm ci
bun "$OMP_SOURCE/packages/coding-agent/src/cli.ts" --no-extensions -e "$PWD/extensions/index.ts"
```

`OMP_SOURCE` must point to a built checkout of the companion OMP sidebar branch. OMP runs in interactive TUI mode; open `/atelier` or press **F6** to inspect the sidebar. Use `/atelier sidebar on|off` to toggle it and `Ctrl+Shift+R` to resize it.

### Requirements

- OMP with the `setSidebar` extension UI API
- Bun and a terminal at least 92 columns wide for the default sidebar
- A monospace terminal font; Plain text mode works without a Nerd Font

### Terminal font

Plain text mode works with a standard monospace font and preserves colors, metrics, and responsive layout. The default Nerd Font mode requires a Nerd Font selected in your terminal settings.

See the [font setup guide and Plain text preview](https://github.com/michaelmjhhhh/pi-atelier/blob/main/docs/usage.md#terminal-font) for installation instructions and configuration details.

## Features

- **Live sidebar:** model, thinking level, context, usage, tool and agent activity, workspace status, TODOs, and optional subagent cost charts.
- **Controls:** `/atelier` menu, sidebar toggle, keyboard or mouse resize, sidebar panels and font settings.
- **Responsive layout:** hides the pane when the main view would be narrower than 64 columns.

OMP's built-in status line remains the live status rail. This fork does not replace OMP's footer; display presets for Atelier's original Pi footer affect its preview only. Graphics in the sidebar use text rendering on this OMP port.

No telemetry or external network requests. See [Privacy](#privacy).

## Use

Open `/atelier` or press **F6** for sidebar controls, model and tool selection, or session actions.

```text
/atelier display            # display settings
/atelier sidebar            # toggle sidebar
/atelier sidebar on|off     # set sidebar visibility
/atelier sidebar tools      # toggle tool names
/atelier enable|disable     # set extension state
```

The sidebar starts visible and hides when the terminal is too narrow. Press `Ctrl+Shift+R` to resize it. Its TODO panel reads OMP `todo` results.

## Configuration

User configuration:

```text
~/.omp/agent/pi-atelier.json
```

Trusted project configuration:

```text
<project>/.omp/pi-atelier.json
```

Project settings override user settings. Session changes override both. Global font mode, sidebar startup, and notification preferences remain user-only.

```json
{
  "preset": "editorial",
  "nerdFont": true,
  "shortcut": "f6",
  "density": "comfortable",
  "contextWarning": 70,
  "contextDanger": 90,
  "showSidebarOnStartup": true,
  "showSidebarToolNames": false,
  "completionNotifications": true
}
```

Use **Settings → Display** to reorder sidebar panels. OMP owns the footer shown beneath the editor; configure it with OMP's `statusLine` settings.

## Troubleshooting

- Shortcut unavailable: use `/atelier`, change `shortcut`, then run `/reload`. The default is `f6` on both macOS and Windows; keyboards with media keys may require Fn+F6 on either platform. Saved `alt+a` settings now resolve to `f6`; Alt+A is no longer registered. Other custom `shortcut` settings add an alternative binding alongside F6. Other extensions or terminal key mappings can still intercept F6.
- Status line missing: inspect OMP `statusLine` settings; Atelier's Pi footer is not mounted in this port.
- Missing icon glyphs: choose **Settings → Font mode: Plain text**, or select a Nerd Font in your terminal settings.
- Metric mismatch: token and cost totals cover the session; context usage covers the current model context.

## Privacy

Pi Atelier:

- Does not collect telemetry or analytics
- Does not store prompts, responses, or credentials
- For subagent usage, reads local metadata and owner-validated diagnostic event logs; retains only numeric cost/time projections in memory and saves only run IDs and artifact paths in the Pi session. Prompt/reply content in those logs is discarded. Active background runs refresh until they settle
- Uses read-only Git inspection for workspace status only after the project is trusted
- Does not read untracked file contents
- Reads project configuration only for trusted projects
- Does not include prompts or responses in notifications

## Development

```bash
git clone https://github.com/lukeanthony007/pi-atelier.git
cd pi-atelier
npm ci
npm run check
bun "$OMP_SOURCE/packages/coding-agent/src/cli.ts" --no-extensions -e "$PWD/extensions/index.ts"
```


## License

[MIT](https://github.com/michaelmjhhhh/pi-atelier/blob/main/LICENSE)
