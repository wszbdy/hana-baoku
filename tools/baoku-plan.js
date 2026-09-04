// 王之宝库 · 套餐额度查询（agent 工具）：智谱 GLM Coding Plan + MiniMax Token Plan
// 解析逻辑复用 routes/api.js 的 planParsers，与面板 /api/plans 同口径
import { planParsers } from '../routes/api.js';

export const name = 'baoku_plan';
export const description =
  '查询已配置的套餐额度：智谱 GLM Coding Plan（5 小时窗口与周额度的已用/剩余/重置时间）与 MiniMax Token Plan（5h 滚动窗 + 周窗，需 Subscription Key）。' +
  '只查询已在插件设置中配置凭证的平台；未配置的平台自动跳过。';
export const parameters = { type: 'object', properties: {} };
export const sessionPermission = { readOnly: true };

const fmtWindows = (planName, windows) =>
  windows.map((w) => {
    const label = w.type === '5h' ? '5 小时窗口' : w.type === 'weekly' ? '周额度' : w.type;
    const used = w.used != null ? w.used.toLocaleString('zh-CN') : '未知';
    const total = w.total != null ? w.total.toLocaleString('zh-CN') : '未知';
    const reset = w.resetAt ? new Date(w.resetAt).toLocaleString('zh-CN') : '未知';
    return `${label}：已用 ${used} / ${total} tokens（${w.percent}%），${reset} 重置`;
  }).join('\n');

export async function execute(input, toolCtx) {
  const cfg = toolCtx.config;
  const getKey = async (k) => {
    if (!cfg) return '';
    if (typeof cfg.get === 'function') {
      try { return (await cfg.get(k)) || ''; } catch (e) { return ''; }
    }
    return cfg[k] || (cfg.global && cfg.global[k]) || '';
  };

  const lines = [];
  let queried = false;

  // 智谱 GLM Coding Plan（登录态三件套）
  const [token, org, project] = await Promise.all([
    getKey('glmAccessToken'), getKey('glmOrgId'), getKey('glmProjectId'),
  ]);
  if (!token || !org || !project) {
    lines.push('智谱 GLM：未配置登录态三件套（access_token / 组织ID / 项目ID），已跳过。');
  } else {
    queried = true;
    try {
      const url = 'https://open.bigmodel.cn/api/monitor/usage/quota/limit';
      const headers = {
        Authorization: token,
        'Bigmodel-Organization': org,
        'Bigmodel-Project': project,
        Accept: 'application/json',
      };
      const res = await toolCtx.network.fetch(url, { headers, timeoutMs: 8000 });
      if (!res.ok) lines.push(`智谱 GLM：查询失败（HTTP ${res.status}），请检查登录态是否过期。`);
      else {
        const parsed = planParsers.parseGlmPlanQuota(await res.json());
        lines.push(parsed.exhausted
          ? '智谱 GLM Coding Plan：套餐积分已用尽，等待额度重置（5 小时窗口滚动恢复）。'
          : parsed.windows.length === 0
            ? `智谱 GLM：暂未查询到套餐用量——可能未订阅套餐（${parsed.planName || '智谱'}）。`
            : `智谱 GLM Coding Plan（${parsed.planName || '智谱'}）：\n` + fmtWindows(parsed.planName, parsed.windows));
      }
    } catch (e) { lines.push(`智谱 GLM：查询失败（${e.message}）`); }
  }

  // MiniMax Token Plan（Subscription Key，非 pay-as-you-go API Key）
  const mmKey = await getKey('minimaxSubscriptionKey');
  if (!mmKey) {
    lines.push('MiniMax：未配置 Subscription Key（Billing > Token Plan 页获取），已跳过。');
  } else {
    queried = true;
    try {
      const res = await toolCtx.network.fetch('https://api.minimax.io/v1/token_plan/remains', {
        headers: { Authorization: `Bearer ${mmKey}`, Accept: 'application/json' }, timeoutMs: 8000,
      });
      if (!res.ok) lines.push(`MiniMax：查询失败（HTTP ${res.status}）。注意此接口需要 Subscription Key，pay-as-you-go API Key 会 401/403。`);
      else {
        const parsed = planParsers.parseMiniMaxPlanRemains(await res.json());
        lines.push(parsed.exhausted
          ? 'MiniMax Token Plan：各窗口额度已用尽（有 Credits 时会自动顶上）。'
          : `MiniMax Token Plan（${parsed.planName}）：\n` + fmtWindows(parsed.planName, parsed.windows));
      }
    } catch (e) { lines.push(`MiniMax：查询失败（${e.message}）`); }
  }

  if (!queried) {
    return '未配置任何套餐平台的凭证。可在插件设置中填写：智谱登录态三件套（GLM Coding Plan）或 MiniMax Subscription Key（Token Plan）。';
  }
  return `王之宝库套餐报告（${new Date().toLocaleString('zh-CN')}）：\n` + lines.join('\n');
}