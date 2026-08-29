# 王之宝库 · Baoku Monitor

> HanaAgent 余额与用量监控插件 —— 一个面板看全所有 AI 账户的钱。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## 功能

- **五平台余额聚合**：DeepSeek / 智谱 GLM / Kimi (Moonshot) / 硅基流动 / OpenRouter。填了 key 自动显示，没填自动隐藏，单家失败不拖垮其他家
- **套餐用量仪表**：GLM Coding Plan 的 5 小时 / 周额度进度条，用量分级变色（金 → 琥珀 → 红），积分耗尽优雅提示
- **套餐 API 用量**：接入智谱 `monitor/usage` 接口家族，按模型 token 消耗汇总 + 每小时消耗柱状图（纯 SVG）
- **30 天趋势**：token / 费用日曲线，悬浮读数 + 键盘可访问
- **月度费用预测**：近 7 天 / 近 30 天双情景外推，峰谷时段拆分 × 价格时间线，输出本月账单区间
- **峰谷价格时间线**：DeepSeek 峰谷价（2026-08-17 起）、GLM 限时折扣（2026-08-26 起）等调价节点自动生效，无需手工改表

## 支持平台与认证方式

| 平台 | 余额 | 套餐用量 | 认证方式 |
|---|---|---|---|
| DeepSeek | ✅ | —（无订阅制） | API Key |
| 智谱 GLM | ✅ | ✅ Coding Plan | 网页登录态三件套（access_token / 组织ID / 项目ID）|
| Kimi (Moonshot) | ✅ | — | API Key |
| 硅基流动 | ✅* | — | API Key（*国内账号余额接口官方迁移中暂未开放）|
| OpenRouter | ✅ | — | API Key |

## 安装

HanaAgent → 设置 → 插件 → 拖入 zip 包（从 [Releases](../../releases) 下载或按下方自行构建）。

## 构建

```bash
npm install
npm run build:ui
```

产物为 `assets/panel.js` 与 `assets/deepseek-usage-monitor.css`。打包安装：将 `manifest.json`、`routes/`、`assets/` 压成 zip 拖入 Hana。

## 配置

所有凭证通过 Hana 插件设置页填入，**仅存本机**（`plugin-data/<id>/config.json`），不参与构建、不上传。

| 字段 | 说明 |
|---|---|
| `deepseekApiKey` | DeepSeek API Key（`sk-` 开头）|
| `glmAccessToken` / `glmOrgId` / `glmProjectId` | 智谱网页登录态三件套（浏览器 F12 获取），余额与套餐共用 |
| `kimiApiKey` | Moonshot API Key（`sk-` 开头）|
| `siliconflowApiKey` | 硅基流动 API Key（`sk-` 开头）|
| `openrouterApiKey` | OpenRouter API Key（`sk-or-` 开头）|
| `glmPlanKey` | 智谱套餐 Key（Claude Code 的 `ANTHROPIC_AUTH_TOKEN`），仅用于用量查询 |

## 费用估算口径

费用为**估算值**（面板有标注），基于本地 usage-ledger 的 token 记录与公开定价：

- DeepSeek：峰谷价（高峰 9:00-12:00 / 14:00-18:00，谷时减半），2026-08-17 起生效
- 智谱 GLM：限时折扣价（2026-08-26 起，到期自动回落原价），以价格时间线表达
- MiMo：统一价

定价变动只需在 `routes/api.js` 的 `PRICING` 时间线追加条目，历史记录自动按时间归属。

## 结构

```
manifest.json   插件元数据、能力声明、配置项
routes/api.js   后端路由：余额聚合 / 套餐额度 / API 用量 / 用量统计 / 费用预测 / 价格时间线
routes/ui.js    iframe 壳与静态资源路由
ui/Panel.tsx    React 面板（余额卡片流 / 套餐进度条 / SVG 图表）
ui/panel.css    样式（金/米色系，tabular-nums，CVD 友好配色验证）
```

## License

[MIT](LICENSE)
