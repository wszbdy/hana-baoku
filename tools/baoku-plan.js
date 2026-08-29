// 王之宝库 · GLM Coding Plan 套餐额度查询（agent 工具）
// 解析逻辑复用 routes/api.js 的 planParsers，与面板 /api/glm-plan 同口径
import { planParsers } from '../routes/api.js';

export const name = 'baoku_plan';
export const description =
  '查询智谱 GLM Coding Plan 套餐额度（5 小时窗口与周额度的已用/剩余/重置时间）。' +
  '需要在插件设置中配置智谱登录态三件套（access_token / 组织ID / 项目ID）。未配置时返回引导信息。';
export const parameters = { type: 'object', properties: {} };
export const sessionPermission = { readOnly: true };

export async function execute(input, toolCtx) {
  const cfg = toolCtx.config;
  const getKey = async (k) => {
    if (!cfg) return '';
    if (typeof cfg.get === 'function') {
      try { return (await cfg.get(k)) || ''; } catch (e) { return ''; }
    }
    return cfg[k] || (cfg.global && cfg.global[k]) || '';
  };

  const [token, org, project] = await Promise.all([
    getKey('glmAccessToken'), getKey('glmOrgId'), getKey('glmProjectId'),
  ]);
  if (!token || !org || !project) {
    return '未配置智谱登录态三件套（access_token / 组织ID / 项目ID）。请在插件设置中填写后重试，即可查看 GLM Coding Plan 的 5 小时与周额度用量。';
  }

  const url = 'https://open.bigmodel.cn/api/monitor/usage/quota/limit';
  const headers = {
    Authorization: token,
    'Bigmodel-Organization': org,
    'Bigmodel-Project': project,
    Accept: 'application/json',
  };
  const res = await toolCtx.network.fetch(url, { headers, timeoutMs: 8000 });
  if (!res.ok) return `智谱套餐接口返回 HTTP ${res.status}，请检查登录态是否过期。`;
  const parsed = planParsers.parseGlmPlanQuota(await res.json());

  if (parsed.exhausted) return 'GLM Coding Plan 套餐积分已用尽，等待额度重置（5 小时窗口滚动恢复）。';

  if (parsed.windows.length === 0) {
    return `账号（${parsed.planName || '智谱'}）暂未查询到套餐用量——可能未订阅套餐，或需要稍后重试。`;
  }

  const lines = parsed.windows.map((w) => {
    const label = w.type === '5h' ? '5 小时窗口' : w.type === 'weekly' ? '周额度' : w.type;
    const used = w.used != null ? w.used.toLocaleString('zh-CN') : '未知';
    const total = w.total != null ? w.total.toLocaleString('zh-CN') : '未知';
    const reset = w.resetAt ? new Date(w.resetAt).toLocaleString('zh-CN') : '未知';
    return `${label}：已用 ${used} / ${total} tokens（${w.percent}%），${reset} 重置`;
  });
  return `GLM Coding Plan（${parsed.planName || '智谱'}）套餐用量：\n` + lines.join('\n');
}