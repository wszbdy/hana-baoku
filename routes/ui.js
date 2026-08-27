import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import registerApiRoutes from "./api.js";

function readAsset(name) {
  try {
    const base = path.join(process.env.HANA_HOME || path.join(os.homedir(), ".hanako"), "plugins", "deepseek-usage-monitor", "assets");
    return fs.readFileSync(path.join(base, name), "utf-8");
  } catch (e) {
    return "";
  }
}

export default function registerPluginUiRoutes(app, ctx) {
  app.get("/page", (c) => c.html(renderShell(c, ctx, "page")));
  app.get("/widget", (c) => c.html(renderShell(c, ctx, "widget")));
  registerApiRoutes(app, ctx);
}

function renderShell(c, ctx, surface) {
  const hanaCss = c.req.query("hana-css") || "";
  const theme = c.req.query("hana-theme") || "inherit";
  const assetBase = `/api/plugins/${encodeURIComponent(ctx.pluginId)}/assets`;
  const title = "DeepSeek Usage Monitor";
  const js = readAsset("panel.js").replace(/<\/script>/gi, "<\\/script>");
  const css = readAsset("deepseek-usage-monitor.css") || readAsset("panel.css");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  ${hanaCss ? `<link rel="stylesheet" href="${escapeAttr(hanaCss)}">` : ""}
  <style>${css}</style>
</head>
<body data-hana-theme="${escapeAttr(theme)}" data-surface="${surface}">
  <div id="root" data-surface="${surface}"></div>
  <script>window.process = window.process || { env: {} };</script>
  <script>${js}</script>
</body>
</html>`;
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function escapeHtml(value) {
  return escapeAttr(value).replace(/>/g, "&gt;");
}
