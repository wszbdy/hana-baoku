// 王之宝库 · 五平台余额聚合查询（agent 工具）
// 解析逻辑复用 routes/api.js 的 balanceParsers，与面板 /api/balances 同口径
import { balanceParsers } from '../routes/api.js';

const P = balanceParsers;

export const name = 'baoku_balance';
export const description =
  '查询王之宝库支持的全部平台账户余额（DeepSeek / 智谱 GLM / Kimi / 硅基流动 / OpenRouter / 阶跃 StepFun / Novita AI）。' +
  '只查询已在插件设置中配置凭证的平台；未配置的平台自动跳过。返回每家余额与人话摘要。';
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
  const fetchJson = async (url, headers) => {
    const res = await toolCtx.network.fetch(url, { headers, timeoutMs: 8000 });
    const json = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, json };
  };

  const lines = [];
  let okCount = 0, failCount = 0, skipCount = 0;
  const push = (s) => lines.push(s);

  // DeepSeek
  try {
    const k = await getKey('deepseekApiKey');
    if (!k) { skipCount++; }
    else {
      const r = await fetchJson('https://api.deepseek.com/user/balance', { Authorization: `Bearer ${k}` });
      if (!r.ok) { push(`DeepSeek：查询失败（HTTP ${r.status}）`); failCount++; }
      else {
        const p = P.parseDeepSeekBalance(r.json);
        if (!p.balance) { push('DeepSeek：响应缺少余额信息'); failCount++; }
        else {
          push(`DeepSeek：余额 ¥${p.balance.total.toFixed(2)}（充值 ${p.balance.toppedUp.toFixed(2)} + 赠送 ${p.balance.granted.toFixed(2)}）${p.available ? '' : '【账户已停服，需充值】'}`);
          okCount++;
        }
      }
    }
  } catch (e) { push(`DeepSeek：查询失败（${e.message}）`); failCount++; }

  // 智谱 GLM（登录态三件套）
  try {
    const [token, org, project] = await Promise.all([
      getKey('glmAccessToken'), getKey('glmOrgId'), getKey('glmProjectId'),
    ]);
    if (!token || !org || !project) { skipCount++; }
    else {
      const r = await fetchJson('https://open.bigmodel.cn/api/biz/account/query-customer-account-report', {
        Authorization: token, 'Bigmodel-Organization': org, 'Bigmodel-Project': project,
      });
      if (!r.ok) { push(`智谱 GLM：查询失败（HTTP ${r.status}）`); failCount++; }
      else {
        const p = P.parseGlmBalance(r.json);
        push(`智谱 GLM：余额 ¥${p.balance.total.toFixed(2)}（可用 ${p.balance.available.toFixed(2)}，充值 ${p.balance.recharge.toFixed(2)}，赠送 ${p.balance.give.toFixed(2)}）`);
        okCount++;
      }
    }
  } catch (e) { push(`智谱 GLM：查询失败（${e.message}）`); failCount++; }

  // Kimi
  try {
    const k = await getKey('kimiApiKey');
    if (!k) { skipCount++; }
    else {
      const r = await fetchJson('https://api.moonshot.cn/v1/users/me/balance', { Authorization: `Bearer ${k}` });
      if (!r.ok) { push(`Kimi：查询失败（HTTP ${r.status}）`); failCount++; }
      else {
        const p = P.parseKimiBalance(r.json);
        push(`Kimi：可用 ¥${p.balance.total.toFixed(2)}（现金 ${p.balance.cash.toFixed(2)} + 代金券 ${p.balance.voucher.toFixed(2)}）`);
        okCount++;
      }
    }
  } catch (e) { push(`Kimi：查询失败（${e.message}）`); failCount++; }

  // 硅基流动（国际端点）
  try {
    const k = await getKey('siliconflowApiKey');
    if (!k) { skipCount++; }
    else {
      const r = await fetchJson('https://api.siliconflow.com/v1/user/info', { Authorization: `Bearer ${k}` });
      if (!r.ok) { push(`硅基流动：查询失败（HTTP ${r.status}）`); failCount++; }
      else {
        const p = P.parseSiliconFlowBalance(r.json);
        push(`硅基流动：可用 ¥${p.balance.total.toFixed(2)}（充值 ${p.balance.charge.toFixed(2)}，总额度 ${p.balance.all.toFixed(2)}）`);
        okCount++;
      }
    }
  } catch (e) { push(`硅基流动：查询失败（${e.message}）`); failCount++; }

  // OpenRouter
  try {
    const k = await getKey('openrouterApiKey');
    if (!k) { skipCount++; }
    else {
      const r = await fetchJson('https://openrouter.ai/api/v1/key', { Authorization: `Bearer ${k}` });
      if (!r.ok) { push(`OpenRouter：查询失败（HTTP ${r.status}）`); failCount++; }
      else {
        const p = P.parseOpenRouterBalance(r.json);
        push(p.balance.unlimited
          ? `OpenRouter：无限额度，已用 $${p.balance.used.toFixed(2)}`
          : `OpenRouter：剩余 $${p.balance.remaining.toFixed(2)}（额度 $${p.balance.limit.toFixed(2)}，已用 $${p.balance.used.toFixed(2)}）`);
        okCount++;
      }
    }
  } catch (e) { push(`OpenRouter：查询失败（${e.message}）`); failCount++; }

  // 阶跃 StepFun
  try {
    const k = await getKey('stepfunApiKey');
    if (!k) { skipCount++; }
    else {
      const r = await fetchJson('https://api.stepfun.com/v1/accounts', { Authorization: `Bearer ${k}`, Accept: 'application/json' });
      if (!r.ok) { push(`阶跃 StepFun：查询失败（HTTP ${r.status}）`); failCount++; }
      else {
        const p = P.parseStepfunBalance(r.json);
        push(`阶跃 StepFun：余额 ¥${p.balance.total.toFixed(2)}（现金 ${p.balance.cash.toFixed(2)} + 代金券 ${p.balance.voucher.toFixed(2)}）`);
        okCount++;
      }
    }
  } catch (e) { push(`阶跃 StepFun：查询失败（${e.message}）`); failCount++; }

  // Novita AI（availableBalance 精度 0.0001 USD，parser 内已除 10000）
  try {
    const k = await getKey('novitaApiKey');
    if (!k) { skipCount++; }
    else {
      const r = await fetchJson('https://api.novita.ai/v3/user/balance', { Authorization: `Bearer ${k}`, Accept: 'application/json' });
      if (!r.ok) { push(`Novita AI：查询失败（HTTP ${r.status}）`); failCount++; }
      else {
        const p = P.parseNovitaBalance(r.json);
        push(`Novita AI：可用 $${p.balance.total.toFixed(4)}（现金 $${p.balance.cash.toFixed(4)}，信用额度 $${p.balance.creditLimit.toFixed(2)}）`);
        okCount++;
      }
    }
  } catch (e) { push(`Novita AI：查询失败（${e.message}）`); failCount++; }

  const summary = skipCount > 0
    ? `${okCount} 家查询成功，${failCount} 家失败，${skipCount} 家未配置已跳过。`
    : `${okCount} 家查询成功，${failCount} 家失败。`;
  return `王之宝库余额报告（${new Date().toLocaleString('zh-CN')}）：\n` + lines.join('\n') + `\n\n${summary}`;
}