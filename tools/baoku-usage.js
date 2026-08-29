// 王之宝库 · 智谱套餐 API 用量查询（agent 工具）
// 解析逻辑复用 routes/api.js 的 usageParsers，与面板 /api/glm-usage 同口径
import { usageParsers } from '../routes/api.js';

export const name = 'baoku_usage';
export const description =
  '查询智谱套餐 Key 的 API 调用用量：按模型 token 消耗汇总与每小时消耗序列。' +
  '需要在插件设置中配置智谱套餐 Key（glmPlanKey，Claude Code 的 ANTHROPIC_AUTH_TOKEN）。' +
  '可选参数 hours 指定回溯小时数（默认 24，最大 720）。';
export const parameters = {
  type: 'object',
  properties: {
    hours: {
      type: 'number',
      description: '回溯小时数（默认 24）',
      minimum: 1,
      maximum: 720,
    },
  },
};
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

  const planKey = await getKey('glmPlanKey');
  if (!planKey) {
    return '未配置智谱套餐 Key（glmPlanKey）。请在插件设置中填写（Claude Code 里 ANTHROPIC_AUTH_TOKEN 那把）后重试。';
  }

  const hours = input && Number(input.hours) > 0 ? Math.min(720, Math.round(Number(input.hours))) : 24;
  const now = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const fmt = (d) => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
  const start = fmt(new Date(now.getTime() - hours * 3600000));
  const end = fmt(now);
  const url = 'https://open.bigmodel.cn/api/monitor/usage/model-usage'
    + '?startTime=' + encodeURIComponent(start)
    + '&endTime=' + encodeURIComponent(end);

  const res = await toolCtx.network.fetch(url, {
    headers: { Authorization: planKey, 'Accept-Language': 'zh-CN,zh', 'Content-Type': 'application/json' },
    timeoutMs: 8000,
  });
  if (!res.ok) return `智谱用量接口返回 HTTP ${res.status}，请检查套餐 Key 是否有效。`;
  const parsed = usageParsers.parseGlmUsage(await res.json());

  const models = parsed.summary.length > 0
    ? '\n按模型：\n' + parsed.summary.map((s) => `  ${s.model}：${s.totalTokens.toLocaleString('zh-CN')} tokens`).join('\n')
    : '';
  const peaks = parsed.byHour.filter((b) => b.tokens > 0).sort((a, b) => b.tokens - a.tokens).slice(0, 3);
  const peakLine = peaks.length > 0
    ? '\n消耗最高时段：' + peaks.map((b) => `${b.time}（${b.tokens.toLocaleString('zh-CN')} tok）`).join('、')
    : '';

  return `智谱套餐 API 用量（近 ${hours} 小时，${start} 起）：\n`
    + `总计 ${parsed.totalTokens.toLocaleString('zh-CN')} tokens，${parsed.totalCalls.toLocaleString('zh-CN')} 次调用。`
    + models
    + peakLine;
}