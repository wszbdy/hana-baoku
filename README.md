# DeepSeek Usage Monitor

Hana plugin id: `deepseek-usage-monitor`.

## Contents

- `manifest.json`: plugin metadata and capability declarations.
- `routes/ui.js`: iframe shell and static asset route.
- `ui/Panel.tsx`: React iframe UI built with Hana SDK components.
- `vite.config.ts`: builds `assets/panel.js` and `assets/panel.css`.

## Development

```bash
npm install
npm run build:ui
npm run typecheck
```

Install by dragging this folder into Hana Settings > Plugins, or place it under the user plugin directory reported by `/api/plugins/settings`.

## File and resource rules

- The sample note tool writes plugin-owned output under `ctx.dataDir`, then returns it through `stageFile()` as SessionFile media.
- If you add a feature that reads, edits, or watches user files, use `ctx.resources` with ResourceRef inputs and declare the matching `resource.read`, `resource.search`, `resource.write`, `resource.materialize`, or `resource.watch` capability.
- Use `ctx.resources.watch()` / `ctx.resources.subscribe()` for backend resource watches, release the returned handle, and filter `resource.changed` / `resource.deleted` / `resource.renamed` bus events by `resourceKeys`.
- Browser iframe code may open, pick, or request access to resources through `hana.resources.*`, but real file reads and writes belong in server-side plugin tools, routes, or lifecycle code.
- Do not treat `SessionFile`, mount, URL, or future remote resources as host-local paths. Use `ctx.resources.materialize(ref)` only for libraries that require a concrete execution path, and write back through ResourceIO explicitly.
- If you create plugin-only chat runs, create sessions with `visibility: "plugin_private"` and return `createChatSurfaceCard(ctx, session.sessionRef ?? session, options)` from `details.card`. Do not hand-build path-only chat surface payloads.
This plugin requires full-access because Hana page and widget contributions are route-backed WebView/iframe UI.
Use WebView/iframe cards for existing web apps, remote sites, or standalone HTML. Use native `chat.surface` only for plugin-owned private session transcripts.
The starter manifest grants only the host calls used by the sample panel. If you add `hana.resources.open()`, `hana.resources.pick()`, or `hana.resources.requestAccess()` calls, add the matching `resource.open`, `resource.pick`, or `resource.requestAccess` entries under `ui.hostCapabilities`.
