# Changelog

所有重要变更记录于此。格式参考 [Keep a Changelog](https://keepachangelog.com/)，版本号遵循语义化版本。

## [0.9.0] - 2026-09-04

- **错误二分法**（借鉴 cc-switch 的语义区分）：查询失败按 `kind` 分类 ——
  `auth`（凭证无效/登录态过期，提示去修）、`exhausted`（欠费/额度耗尽，含 DeepSeek `is_available:false`）、
  `transient`（网络/超时/限流/5xx，可自动重试）；前端卡片与套餐区块按类渲染文案
- **keep-last-good 快照**：查询失败时返回上次成功数据 + `数据截至 HH:mm` 角标（琥珀色），不再空白报错
- **瞬时故障自动重试**：网络异常/超时/429/5xx 延迟 1.2s 重试一次，结论性失败（401/403/402）不重试
- **新增厂商**（对齐 cc-switch 支持范围）：
  - 阶跃 StepFun 余额（`/v1/accounts`，CNY，balance 字符串/数字兼容）
  - Novita AI 余额（`/v3/user/balance`，USD，availableBalance 精度 0.0001 需除 10000）
  - MiniMax Token Plan 套餐用量（`/v1/token_plan/remains`，Subscription Key，5h 滚动窗 + 周窗）
- 套餐路由重构：新增聚合入口 `GET /api/plans`，`/api/glm-plan` 兼容保留（旧调用方不受影响）
- 新增配置项：`stepfunApiKey` / `novitaApiKey` / `minimaxSubscriptionKey`；白名单加 `api.stepfun.com` / `api.novita.ai` / `api.minimax.io` / `api.minimaxi.com`
- 新增 parser 自验脚本 `tools/test-parsers.mjs`（12 用例）；tsconfig 排除 `vite.config.ts` 修复既存 typecheck 报错

## [0.8.0] - 2026-08-29

- **新增 agent 工具三件套**（readOnly，全 agent 可调用）：
  - `baoku_balance`：五平台余额聚合，逐家报数 + 停服标记
  - `baoku_plan`：GLM Coding Plan 套餐额度（5h / 周窗口）
  - `baoku_usage`：套餐 API 用量（可选 `hours` 参数，默认 24，最大 720）
- 新增 `tools/` 目录（zip 包含 tools/）

## [0.7.1] - 2026-08-29

- 插件显示名统一为「王之宝库」

## [0.7.0] - 2026-08-29

- 新增「套餐 API 用量」板块：接入智谱 `monitor/usage/model-usage` 接口，按模型 token 消耗汇总 + 每小时消耗柱状图
- 新增配置项 `glmPlanKey`（套餐 Key，Claude Code 的 `ANTHROPIC_AUTH_TOKEN`）

## [0.6.1] - 2026-08-29

- 套餐区块标题显示厂商名（套餐用量 · 智谱 GLM Coding Plan）

## [0.6.0] - 2026-08-29

- 新增「套餐用量」板块：GLM Coding Plan 5 小时 / 周额度进度条，用量分级变色（金 → 琥珀 → 红），积分耗尽优雅降级
- 复用智谱登录态三件套，无新增配置

## [0.5.1] - 2026-08-29

- 修复硅基流动端点迁移：`.cn` → `.com`（旧端点 410），白名单同步

## [0.5.0] - 2026-08-29

- **多供应商余额聚合**：Kimi / 硅基流动 / OpenRouter 接入
- 前端余额区改为卡片流：按配置自动显隐，单家失败不拖垮其他家

## [0.4.0] - 2026-08-29

- 新增近 30 天趋势图（纯 SVG，无图表库依赖）
- 新增月度费用预测（近 7 天 / 近 30 天双情景，峰谷时段拆分 × 价格时间线）
- UI 升级：区块标题层级、tabular-nums、CVD 友好配色验证

## [0.3.1]

- 模型列表按 token 用量降序排序

## [0.3.0]

- GLM 余额改用官方登录态接口（access_token + org + project），弃用不可靠的社区接口

## [0.2.0]

- 源码基线：DeepSeek 余额 + GLM 余额接口 + 峰谷价格时间线
