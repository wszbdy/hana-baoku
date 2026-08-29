import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance';
// 智谱 GLM 余额接口（官方控制台业务接口），需登录态：Authorization(access_token) + 组织/项目 ID
const ZHIPU_BALANCE_URL = 'https://open.bigmodel.cn/api/biz/account/query-customer-account-report';
// Kimi (Moonshot) 余额接口
const KIMI_BALANCE_URL = 'https://api.moonshot.cn/v1/users/me/balance';
// 硅基流动用户信息接口（含余额）
const SILICONFLOW_INFO_URL = 'https://api.siliconflow.com/v1/user/info';
// OpenRouter Key 信息接口（usage / limit）
const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key';
// 智谱 GLM Coding Plan 用量接口（官方 zai-coding-plugins 插件同款，国内站）
const GLM_PLAN_QUOTA_URL = 'https://open.bigmodel.cn/api/monitor/usage/quota/limit';
// 官方 glm-plan-usage 插件源码（zai-org/zai-coding-plugins）确认的用量监控接口家族：
// Authorization 直接用套餐 Key（Claude Code 的 ANTHROPIC_AUTH_TOKEN，无 Bearer 前缀）
const GLM_MODEL_USAGE_URL = 'https://open.bigmodel.cn/api/monitor/usage/model-usage';

function hanaDataDir() {
  return process.env.HANA_HOME || path.join(os.homedir(), '.hanako');
}

function ledgerPath() {
  return path.join(hanaDataDir(), 'usage-ledger.json');
}

function readLedger() {
  try {
    const raw = fs.readFileSync(ledgerPath(), 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : (data.entries || data.records || []);
  } catch (err) {
    return { error: String(err && err.message || err) };
  }
}

function num(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isToday(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return false;
  return dayKey(d) === dayKey(new Date());
}

// 本地时区的 YYYY-MM-DD 日键（日聚合、近 N 天窗口都用它，与 isToday 口径一致）
function dayKey(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function extractUsage(rec) {
  const u = rec.usage || {};
  const inp = u.input || {};
  const out = u.output || {};
  const cache = u.cache || {};
  const input = num(inp.totalTokens);
  const cacheRead = num(cache.readTokens);
  const reportedMiss = num(cache.missTokens);
  // DeepSeek 未命中字段可能缺失（null），此时用 input.totalTokens（未命中输入部分）兜底
  const cacheMiss = reportedMiss > 0 ? reportedMiss : Math.max(0, input);
  return {
    input,
    output: num(out.totalTokens),
    cacheRead,
    cacheMiss,
    totalTokens: num(u.totalTokens),
    cost: num(u.costTotal),
  };
}

// ---- 费用估算定价（元 / 百万 token）----
// 每个模型一条价格时间线 timeline，按 from（华北时间 0 点对应的 UTC 时间戳）升序排列；
// estimateCost 取「from <= 记录时间」的最后一个条目；条目含 peak/offpeak，不分时段则两者相同。
// 价格变更只清在对应 timeline 加一条，不用改 estimateCost。
const PRICING = {
  // DeepSeek：自 2026-08-17 00:00（北京时间）起峰谷定价，此前用旧价（旧价不分峰谷）
  'deepseek-flash': {
    timeline: [
      { from: 0, peak: { hit: 0.05, miss: 1, out: 2 }, offpeak: { hit: 0.05, miss: 1, out: 2 } },
      { from: Date.parse('2026-08-16T16:00:00Z'), peak: { hit: 0.1, miss: 3, out: 9 }, offpeak: { hit: 0.05, miss: 1.5, out: 4.5 } },
    ],
  },
  'deepseek-pro': {
    timeline: [
      { from: 0, peak: { hit: 0.025, miss: 3, out: 6 }, offpeak: { hit: 0.025, miss: 3, out: 6 } },
      { from: Date.parse('2026-08-16T16:00:00Z'), peak: { hit: 0.3, miss: 9, out: 27 }, offpeak: { hit: 0.15, miss: 4.5, out: 13.5 } },
    ],
  },
  // MiMo 统一价，不分时段
  'mimo-v2.5': {
    timeline: [
      { from: 0, peak: { hit: 0.02, miss: 1, out: 2 }, offpeak: { hit: 0.02, miss: 1, out: 2 } },
    ],
  },
  // GLM-5.3-Flash（320B-A18B），国内版 BigModel 人民币价（每百万 token）：
  //   三者均参与五折活动（2026-08-26 00:00 起约两周至 9/9）：
  //   原价：命中 ¥0.23 / 输入 ¥0.8 / 输出 ¥2.8
  //   五折（活动期）：命中 ¥0.115 / 输入 ¥0.4 / 输出 ¥1.4
  //   timeline 第三段（9/9 起）即恢复后的原价，届时自动生效，无需手工改
  'glm-flash': {
    timeline: [
      { from: 0, peak: { hit: 0.23, miss: 0.8, out: 2.8 }, offpeak: { hit: 0.23, miss: 0.8, out: 2.8 } },
      { from: Date.parse('2026-08-25T16:00:00Z'), peak: { hit: 0.115, miss: 0.4, out: 1.4 }, offpeak: { hit: 0.115, miss: 0.4, out: 1.4 } },
      { from: Date.parse('2026-09-08T16:00:00Z'), peak: { hit: 0.23, miss: 0.8, out: 2.8 }, offpeak: { hit: 0.23, miss: 0.8, out: 2.8 } },
    ],
  },
};

function isPeakBeijing(isoTs) {
  const d = new Date(isoTs);
  if (isNaN(d.getTime())) return false;
  const bjH = (d.getUTCHours() + 8) % 24;
  return (bjH >= 9 && bjH < 12) || (bjH >= 14 && bjH < 18);
}

function pricingFor(provider, modelId) {
  const mid = String(modelId || '').toLowerCase();
  const prov = String(provider || '').toLowerCase();
  if (prov === 'mimo') return PRICING['mimo-v2.5'];
  if (prov === 'deepseek') return mid.includes('pro') ? PRICING['deepseek-pro'] : PRICING['deepseek-flash'];
  if (mid.includes('glm')) {
    if (mid.includes('flash')) return PRICING['glm-flash'];
    return null; // 其他 GLM 型号暂无价格表，不估算费用（避免错计）
  }
  return null;
}

// 时间线取段：取 from <= ts 的最后一个条目（条目按 from 升序）
function priceTableAt(pricing, ts) {
  let table = pricing.timeline[0];
  for (const t of pricing.timeline) {
    if (ts >= t.from) table = t;
    else break;
  }
  return table;
}

function estimateCost(rec) {
  const u = extractUsage(rec);
  const pricing = pricingFor(rec.model && rec.model.provider, rec.model && rec.model.modelId);
  if (!pricing) return 0;
  const start = Date.parse(rec.startedAt);
  if (!Number.isFinite(start)) return 0;
  const table = priceTableAt(pricing, start);
  const p = isPeakBeijing(rec.startedAt) ? table.peak : table.offpeak;
  const miss = u.cacheMiss;
  return (u.cacheRead / 1e6) * p.hit + (miss / 1e6) * p.miss + (u.output / 1e6) * p.out;
}

// ---- 各家余额响应解析（纯函数：输入响应 JSON，输出 { balance, ... }；形态异常时 throw）----

// DeepSeek: { is_available, balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }] }
function parseDeepSeekBalance(data) {
  if (!data || !Array.isArray(data.balance_infos) || data.balance_infos.length === 0) {
    throw new Error("DeepSeek 响应缺少 balance_infos");
  }
  const infos = data.balance_infos;
  const cny = infos.find((i) => i && i.currency === 'CNY') || infos[0];
  return {
    available: !!(data && data.is_available),
    balance: cny
      ? { total: num(cny.total_balance), granted: num(cny.granted_balance), toppedUp: num(cny.topped_up_balance) }
      : null,
  };
}

// 智谱 GLM: { code, msg, data: { balance, availableBalance, rechargeAmount, giveAmount } }
function parseGlmBalance(data) {
  if (data && data.code && data.code !== 200) throw new Error(data.msg || '智谱余额查询失败');
  const inner = (data && data.data) || {};
  const total = num(inner.balance != null ? inner.balance : inner.availableBalance);
  return {
    balance: { total, available: num(inner.availableBalance), recharge: num(inner.rechargeAmount), give: num(inner.giveAmount) },
  };
}

// Kimi: { status: true, data: { available_balance, voucher_balance, cash_balance } }
function parseKimiBalance(data) {
  if (!data || data.status !== true || !data.data) {
    throw new Error((data && (data.message || data.msg)) || 'Kimi 接口返回异常');
  }
  const d = data.data;
  return {
    balance: { total: num(d.available_balance), voucher: num(d.voucher_balance), cash: num(d.cash_balance) },
  };
}

// 硅基流动: { data: { balance, chargeBalance, totalBalance, status } }（字段形态容错：data 缺失时直接看顶层）
function parseSiliconFlowBalance(data) {
  const d = (data && data.data && typeof data.data === 'object') ? data.data : data;
  if (!d || d.balance == null) throw new Error((data && (data.message || data.msg)) || '硅基流动响应缺少 balance 字段');
  return {
    balance: { total: num(d.balance), charge: num(d.chargeBalance), all: num(d.totalBalance), status: d.status != null ? String(d.status) : '' },
  };
}

// OpenRouter: { data: { usage, limit, is_free_tier } }，limit 为 null 表示不限额（显示「无限额度」+ 已用）
function parseOpenRouterBalance(data) {
  const d = (data && data.data) || null;
  if (!d || (d.limit == null && d.usage == null)) {
    throw new Error("OpenRouter 响应缺少 usage/limit");
  }
  const used = num(d.usage);
  if (d.limit == null) return { balance: { unlimited: true, used, freeTier: !!d.is_free_tier } };
  const limit = num(d.limit);
  return { balance: { unlimited: false, used, limit, remaining: limit - used, freeTier: !!d.is_free_tier } };
}

// 供 node 内联 mock 自验使用（插件运行时只取 default 导出，此处无副作用）
export const balanceParsers = {
  parseDeepSeekBalance,
  parseGlmBalance,
  parseKimiBalance,
  parseSiliconFlowBalance,
  parseOpenRouterBalance,
};

// ---- 套餐（Plan）用量解析（纯函数）----
// 智谱 quota/limit 响应（官方 zai-coding-plugins 与 CodexBar 交叉验证）：
//   { success, code, msg, data: { planName, limits: [{
//       type: 'TOKENS_LIMIT' | 'TIME_LIMIT' | 'CREDIT_LIMIT',
//       unit: 1天|3小时|5分钟|6周, number: 数量, percentage: 已用百分比,
//       usage: 总额度, currentValue: 已用, remaining: 剩余,
//       nextResetTime: 重置时间(epoch ms), usageDetails: [...] }] } }
//   TOKENS_LIMIT 会出现多条：最短的是 5h 窗，最长的是周额度；TIME_LIMIT 是 MCP 通道（不进窗口）。
const PLAN_UNIT_MINUTES = { 1: 1440, 3: 60, 5: 1, 6: 10080 };

function parseGlmPlanQuota(data) {
  // 业务错误响应：积分耗尽做优雅降级（exhausted），其余抛错
  if (data && data.code && data.code !== 200) {
    const msg = String(data.msg || data.message || '');
    if (/耗尽|用尽|exhaust|insufficient|欠费/i.test(msg)) {
      return { exhausted: true, planName: '', windows: [] };
    }
    throw new Error(msg || '智谱套餐用量查询失败');
  }
  const d = (data && data.data) || {};
  const limits = d.limits;
  if (!Array.isArray(limits)) throw new Error('智谱套餐响应缺少 limits 字段');
  if (limits.length === 0) return { exhausted: false, planName: d.planName || '', windows: [] };

  const windows = [];
  for (const raw of limits) {
    if (!raw || typeof raw !== 'object') continue;
    // TIME_LIMIT 是 MCP 用量通道，不属于 Coding Plan token 窗口
    if (raw.type !== 'TOKENS_LIMIT' && raw.type !== 'CREDIT_LIMIT') continue;
    const total = num(raw.usage);
    const remaining = raw.remaining != null ? num(raw.remaining) : null;
    const current = raw.currentValue != null ? num(raw.currentValue) : null;
    // 已用值口径与 CodexBar 一致：优先 total-remaining（与 currentValue 取大），回落 currentValue
    let used = null;
    if (total > 0 && remaining != null) used = Math.max(total - remaining, current != null ? current : total - remaining);
    else if (current != null) used = current;
    const windowMinutes = num(raw.number) > 0 && PLAN_UNIT_MINUTES[raw.unit] ? num(raw.number) * PLAN_UNIT_MINUTES[raw.unit] : null;
    const type = windowMinutes === 300 ? '5h'
      : windowMinutes === 10080 ? 'weekly'
      : windowMinutes != null ? Math.round(windowMinutes / 60) + 'h'
      : 'unknown';
    let percent = used != null && total > 0 ? (used / total) * 100 : num(raw.percentage);
    percent = Math.max(0, Math.min(100, Math.round(percent * 10) / 10));
    windows.push({
      type,
      windowMinutes,
      used: used != null ? used : null,
      total: total > 0 ? total : null,
      percent,
      resetAt: raw.nextResetTime != null ? num(raw.nextResetTime) : null,
    });
  }
  // 按窗口时长升序：5h 在前、周额度在后
  windows.sort((a, b) => (a.windowMinutes ?? Infinity) - (b.windowMinutes ?? Infinity));
  return { exhausted: false, planName: d.planName || '', windows };
}

// 供 mock 自验使用
export const planParsers = { parseGlmPlanQuota };

// ---- 套餐 API 用量解析（model-usage，纯函数）----
// 实测响应：{ code:200, data: { x_time:[小时刻度], modelCallCount:[每小时调用],
//   tokensUsage:[每小时 token], totalUsage: { totalModelCallCount, totalTokensUsage,
//   modelSummaryList: [{ modelName, totalTokens }] }, modelDataList: [...] } }
function parseGlmUsage(data) {
  if (!data || typeof data !== 'object') throw new Error('智谱用量响应结构异常');
  const d = (data && data.data) || data;
  if (!Array.isArray(d.x_time)) throw new Error('智谱用量响应缺少 x_time');
  const totalUsage = d.totalUsage || {};
  const summary = Array.isArray(totalUsage.modelSummaryList)
    ? totalUsage.modelSummaryList.map((s) => ({ model: s.modelName, totalTokens: num(s.totalTokens) }))
    : [];
  const byHour = d.x_time.map((t, i) => ({
    time: t,
    tokens: num((d.tokensUsage || [])[i]),
    calls: num((d.modelCallCount || [])[i]),
  }));
  return {
    totalCalls: num(totalUsage.totalModelCallCount),
    totalTokens: num(totalUsage.totalTokensUsage),
    summary,
    byHour,
  };
}
export const usageParsers = { parseGlmUsage };

// ---- 余额供应商注册表：每家一个 adapter（端点 + 头 + 解析），新增平台只需追加一条 ----
// query(env) 返回 null 表示「未配置 key，跳过」；{ ok, ... } 为查询结果；throw 由路由层兜底为 ok:false
const BALANCE_PROVIDERS = [
  {
    id: 'deepseek', name: 'DeepSeek', currency: 'CNY',
    keys: ['deepseekApiKey'],
    async query(env) {
      const key = await env.getKey('deepseekApiKey');
      if (!key) return null;
      const res = await env.fetch(DEEPSEEK_BALANCE_URL, {
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        timeoutMs: 8000,
      });
      if (!res.ok) return { ok: false, message: `余额接口返回 ${res.status}` };
      const { available, balance } = parseDeepSeekBalance(await res.json());
      return { ok: true, available, balance };
    },
  },
  {
    id: 'glm', name: '智谱 GLM', currency: 'CNY',
    keys: ['glmAccessToken', 'glmOrgId', 'glmProjectId'],
    async query(env) {
      const [token, org, project] = await Promise.all([
        env.getKey('glmAccessToken'), env.getKey('glmOrgId'), env.getKey('glmProjectId'),
      ]);
      if (!token || !org || !project) return null;
      const res = await env.fetch(ZHIPU_BALANCE_URL, {
        headers: {
          Authorization: token,
          'Bigmodel-Organization': org,
          'Bigmodel-Project': project,
          'Content-Type': 'application/json',
        },
        timeoutMs: 8000,
      });
      if (!res.ok) return { ok: false, message: `智谱余额接口返回 ${res.status}` };
      const { balance } = parseGlmBalance(await res.json());
      return { ok: true, balance };
    },
  },
  {
    id: 'kimi', name: 'Kimi', currency: 'CNY',
    keys: ['kimiApiKey'],
    async query(env) {
      const key = await env.getKey('kimiApiKey');
      if (!key) return null;
      const res = await env.fetch(KIMI_BALANCE_URL, {
        headers: { Authorization: `Bearer ${key}` },
        timeoutMs: 8000,
      });
      if (!res.ok) return { ok: false, message: `Kimi 余额接口返回 ${res.status}` };
      const { balance } = parseKimiBalance(await res.json());
      return { ok: true, balance };
    },
  },
  {
    id: 'siliconflow', name: '硅基流动', currency: 'CNY',
    keys: ['siliconflowApiKey'],
    async query(env) {
      const key = await env.getKey('siliconflowApiKey');
      if (!key) return null;
      const res = await env.fetch(SILICONFLOW_INFO_URL, {
        headers: { Authorization: `Bearer ${key}` },
        timeoutMs: 8000,
      });
      if (!res.ok) return { ok: false, message: `硅基流动接口返回 ${res.status}` };
      const { balance } = parseSiliconFlowBalance(await res.json());
      return { ok: true, balance };
    },
  },
  {
    id: 'openrouter', name: 'OpenRouter', currency: 'USD',
    keys: ['openrouterApiKey'],
    async query(env) {
      const key = await env.getKey('openrouterApiKey');
      if (!key) return null;
      const res = await env.fetch(OPENROUTER_KEY_URL, {
        headers: { Authorization: `Bearer ${key}` },
        timeoutMs: 8000,
      });
      if (!res.ok) return { ok: false, message: `OpenRouter 接口返回 ${res.status}` };
      const { balance } = parseOpenRouterBalance(await res.json());
      return { ok: true, balance };
    },
  },
];

// ---- 套餐用量供应商注册表（与 BALANCE_PROVIDERS 同模式）----
// 目前只实装智谱 GLM Coding Plan；未来新厂商（如 MiMo Token Plan 的 tp- key 体系，
// 暂无公开用量接口）在此追加条目即可，路由层与前端卡片是通用的。
// query(env) 约定与余额 adapter 一致：null=未配置跳过；{ ok, ... }=结果；throw=路由层兜底。
const PLAN_PROVIDERS = [
  {
    id: 'glm', name: '智谱 GLM Coding Plan',
    keys: ['glmAccessToken', 'glmOrgId', 'glmProjectId'],
    async query(env) {
      const [token, org, project] = await Promise.all([
        env.getKey('glmAccessToken'), env.getKey('glmOrgId'), env.getKey('glmProjectId'),
      ]);
      if (!token || !org || !project) return null;
      const headers = {
        Authorization: token,
        'Bigmodel-Organization': org,
        'Bigmodel-Project': project,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      };
      const call = (url) => env.fetch(url, { headers, timeoutMs: 8000 });
      // 先按控制台默认形态请求；limits 为空可能是 scope 问题（CodexBar 文档：缺选择器时返回空限额），
      // 回落 team scope（?type=2）再试一次，仍空则维持原结果（视为未订阅套餐）
      let res = await call(GLM_PLAN_QUOTA_URL);
      if (!res.ok) return { ok: false, message: `智谱套餐接口返回 ${res.status}` };
      let parsed = parseGlmPlanQuota(await res.json());
      if (parsed.windows.length === 0 && !parsed.exhausted) {
        try {
          const retry = await call(GLM_PLAN_QUOTA_URL + '?type=2');
          if (retry.ok) {
            const r2 = parseGlmPlanQuota(await retry.json());
            if (r2.windows.length > 0 || r2.exhausted) parsed = r2;
          }
        } catch (e) { /* 回落失败维持原结果 */ }
      }
      return { ok: true, ...parsed };
    },
  },
];

export default function registerPluginUiRoutes(app, ctx) {
  const log = (msg) => { try { if (ctx && ctx.log) ctx.log.info('[dsum] ' + msg); } catch (e) {} };

  // 配置读取器：兼容 cfg.get() 方法与普通对象两种宿主形态
  const makeKeyGetter = (c) => {
    const rctx = (c && c.get && c.get('pluginCtx')) || ctx;
    const cfg = rctx && rctx.config;
    return async (key) => {
      if (!cfg) return '';
      if (typeof cfg.get === 'function') {
        try { const v = await cfg.get(key); return v || ''; }
        catch (e) { return ''; }
      }
      return cfg[key] || (cfg.global && cfg.global[key]) || '';
    };
  };

  // ---- 余额聚合：按配置了 key 的供应商逐家查询，单家失败不影响其他家 ----
  // 请求头组装与响应解析都在各家的 adapter（BALANCE_PROVIDERS）里，新增平台只需追加一条
  app.get('/api/balances', async (c) => {
    log('balances request');
    const getKey = makeKeyGetter(c);
    const rctx = (c && c.get && c.get('pluginCtx')) || ctx;
    const fetcher = rctx && rctx.network && rctx.network.fetch;
    if (!fetcher) return c.json({ ok: false, message: '宿主未提供 network.fetch 能力' });

    const results = await Promise.all(BALANCE_PROVIDERS.map(async (p) => {
      let r;
      try {
        r = await p.query({ getKey, fetch: fetcher, log });
      } catch (err) {
        r = { ok: false, message: String(err && err.message || err) };
      }
      if (!r) return null; // 未配置 key，跳过该家
      log('balances[' + p.id + ']: ' + (r.ok ? 'ok' : 'fail ' + (r.message || '')));
      return { id: p.id, name: p.name, currency: p.currency, ...r };
    }));

    const list = results.filter(Boolean);
    return c.json({ ok: true, configured: list.length, results: list });
  });

  // ---- 套餐（Plan）用量：当前实装智谱 GLM Coding Plan，按 PLAN_PROVIDERS 逐家查询 ----
  app.get('/api/glm-plan', async (c) => {
    log('glm-plan request');
    const getKey = makeKeyGetter(c);
    const rctx = (c && c.get && c.get('pluginCtx')) || ctx;
    const fetcher = rctx && rctx.network && rctx.network.fetch;
    if (!fetcher) return c.json({ ok: false, message: '宿主未提供 network.fetch 能力' });

    const provider = PLAN_PROVIDERS.find((p) => p.id === 'glm');
    let r;
    try {
      r = await provider.query({ getKey, fetch: fetcher, log });
    } catch (err) {
      return c.json({ ok: false, message: String(err && err.message || err) });
    }
    if (!r) {
      return c.json({ ok: true, hasPlan: false, reason: 'needKey', message: '未配置智谱 GLM 登录态（access_token / 组织ID / 项目ID）' });
    }
    if (!r.ok) {
      return c.json({ ok: false, hasPlan: true, name: provider.name, message: r.message });
    }
    // 窗口为空且非「积分耗尽」→ 视为当前账号未订阅套餐
    if (!r.exhausted && (!r.windows || r.windows.length === 0)) {
      return c.json({ ok: true, hasPlan: false, reason: 'noPlan', message: '当前账号未查询到 Coding Plan 用量（可能未订阅）', planName: r.planName || '' });
    }
    log('glm-plan: ok, windows=' + r.windows.length + (r.exhausted ? ' (exhausted)' : ''));
    return c.json({
      ok: true,
      hasPlan: true,
      name: provider.name,
      planName: r.planName || '',
      exhausted: !!r.exhausted,
      window: r.windows, // [{ type:'5h'|'weekly'|..., used, total, percent, resetAt }]
      message: r.exhausted ? '套餐积分已用尽' : '',
    });
  });

  // ---- 套餐 API 用量（model-usage，套餐 Key 认证）----
  // GET /api/glm-usage?hours=24 —— 回溯 N 小时的按模型 token 消耗与每小时序列
  app.get('/api/glm-usage', async (c) => {
    log('glm-usage request');
    const rctx = (c && c.get && c.get('pluginCtx')) || ctx;
    const cfg = rctx && rctx.config;
    const getKey = async (key) => {
      if (!cfg) return '';
      if (typeof cfg.get === 'function') {
        try { const v = await cfg.get(key); return v || ''; }
        catch (e) { return ''; }
      }
      return cfg[key] || (cfg.global && cfg.global[key]) || '';
    };
    const planKey = await getKey('glmPlanKey');
    if (!planKey) return c.json({ ok: true, hasKey: false, message: '未配置智谱套餐 Key。' });

    const hoursRaw = num(c.query.hours);
    const hours = hoursRaw > 0 && hoursRaw <= 720 ? Math.round(hoursRaw) : 24;
    const now = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const fmt = (d) => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
    const start = fmt(new Date(now.getTime() - hours * 3600000));
    const end = fmt(now);
    const url = GLM_MODEL_USAGE_URL + '?startTime=' + encodeURIComponent(start) + '&endTime=' + encodeURIComponent(end);

    try {
      const res = await (c.get('pluginCtx') || ctx).network.fetch(url, {
        headers: { Authorization: planKey, 'Accept-Language': 'zh-CN,zh', 'Content-Type': 'application/json' },
        timeoutMs: 8000,
      });
      log('glm-usage: status=' + res.status);
      if (!res.ok) return c.json({ ok: false, hasKey: true, message: `智谱用量接口返回 ${res.status}` });
      const parsed = parseGlmUsage(await res.json());
      return c.json({ ok: true, hasKey: true, hours, startTime: start, endTime: end, ...parsed });
    } catch (err) {
      log('glm-usage error: ' + String(err && err.message || err));
      return c.json({ ok: false, hasKey: true, message: String(err && err.message || err) });
    }
  });

  // ---- 用量统计（本地 usage-ledger）----
  app.get('/api/usage', async (c) => {
    const data = readLedger();
    if (data.error) return c.json({ ok: false, message: data.error });

    const byModel = new Map();
    const stats = { today: { calls: 0, tokens: 0, cost: 0, cacheRead: 0, cacheMiss: 0 }, total: { calls: 0, tokens: 0, cost: 0, cacheRead: 0, cacheMiss: 0 } };

    // 近 30 天按日聚合（本地时区日键），供趋势曲线使用
    const TREND_DAYS = 30;
    const dailyMap = new Map(); // dayKey -> { tokens, cost, calls }
    const day0 = new Date();
    day0.setHours(0, 0, 0, 0);
    const trendStart = day0.getTime() - (TREND_DAYS - 1) * 86400000;

    for (const rec of data) {
      if (!rec || rec.status !== 'ok') continue;
      const model = (rec.model && (rec.model.provider || '') + '/' + (rec.model.modelId || 'unknown')) || 'unknown';
      const u = extractUsage(rec);
      const cost = estimateCost(rec);
      const entry = byModel.get(model) || { model, calls: 0, tokens: 0, cost: 0, cacheRead: 0, cacheMiss: 0 };
      entry.calls += 1;
      entry.tokens += u.totalTokens;
      entry.cost += cost;
      entry.cacheRead += u.cacheRead;
      entry.cacheMiss += u.cacheMiss;
      byModel.set(model, entry);

      stats.total.calls += 1;
      stats.total.tokens += u.totalTokens;
      stats.total.cost += cost;
      stats.total.cacheRead += u.cacheRead;
      stats.total.cacheMiss += u.cacheMiss;

      const ts = Date.parse(rec.startedAt);
      if (Number.isFinite(ts) && ts >= trendStart) {
        const k = dayKey(new Date(ts));
        const d = dailyMap.get(k) || { tokens: 0, cost: 0, calls: 0 };
        d.tokens += u.totalTokens;
        d.cost += cost;
        d.calls += 1;
        dailyMap.set(k, d);
      }

      if (isToday(rec.startedAt)) {
        stats.today.calls += 1;
        stats.today.tokens += u.totalTokens;
        stats.today.cost += cost;
        stats.today.cacheRead += u.cacheRead;
        stats.today.cacheMiss += u.cacheMiss;
      }
    }

    const hitRate = (m) => {
      const denom = m.cacheRead + m.cacheMiss;
      return denom > 0 ? Math.round((m.cacheRead / denom) * 1000) / 10 : 0;
    };

    // 生成连续 30 天序列（缺数据的天补零），旧 → 新
    const daily = [];
    for (let i = TREND_DAYS - 1; i >= 0; i--) {
      const d = new Date(day0.getTime() - i * 86400000);
      const k = dayKey(d);
      const agg = dailyMap.get(k) || { tokens: 0, cost: 0, calls: 0 };
      daily.push({ date: k, label: (d.getMonth() + 1) + '/' + d.getDate(), ...agg });
    }

    return c.json({
      ok: true,
      estimated: true,
      pricing: '官方定价估算（DeepSeek 峰谷价，MiMo 统一价，GLM-5.3-Flash 8/26 起五折、9/9 恢复原价）',
      today: { ...stats.today, hitRate: hitRate(stats.today) },
      total: { ...stats.total, hitRate: hitRate(stats.total) },
      byModel: [...byModel.values()].map((m) => ({ ...m, hitRate: hitRate(m) })),
      daily,
      ledgerPath: ledgerPath(),
    });
  });

  // ---- 月度费用预测 ----
  // 思路：不做简单「月至今日均 × 天数」外推，而是取近 N 天的日均 token 结构
  // （命中/未命中/输出 三分量），对本月剩余每一天，把该结构按时段拆到峰/谷，
  // 再套当天的价格时间线（自动反映调价与限时折扣），得到账单区间：
  //   低情景 = 近 30 天日均节奏（长期习惯）
  //   高情景 = 近 7 天日均节奏（近期加速）
  app.get('/api/forecast', async (c) => {
    const data = readLedger();
    if (data.error) return c.json({ ok: false, message: data.error });

    const now = new Date();
    const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const daysInMonth = Math.round((monthEnd - monthStart) / 86400000);
    const dayOfMonth = Math.round((day0 - monthStart) / 86400000) + 1; // 今天是本月第几天
    const daysLeft = daysInMonth - dayOfMonth; // 今天之后剩余天数

    // 本月至今：实际费用 + 各模型 token 三分量累计（token 结构用于外推）
    let monthCost = 0;
    const byModel = new Map(); // model -> { read, miss, out, cost }
    // 近 7 / 30 天日均分量（按记录的模型归属统计）
    const recent7 = new Map();
    const recent30 = new Map();
    const t7 = day0.getTime() - 6 * 86400000;
    const t30 = day0.getTime() - 29 * 86400000;

    let anyLedger = false;
    for (const rec of data) {
      if (!rec || rec.status !== 'ok') continue;
      const ts = Date.parse(rec.startedAt);
      if (!Number.isFinite(ts)) continue;
      anyLedger = true;
      const model = (rec.model && (rec.model.provider || '') + '/' + (rec.model.modelId || 'unknown')) || 'unknown';
      const u = extractUsage(rec);
      const cost = estimateCost(rec);

      const parts = (m) => {
        let e = m.get(model);
        if (!e) { e = { read: 0, miss: 0, out: 0, cost: 0 }; m.set(model, e); }
        return e;
      };

      if (ts >= monthStart.getTime()) {
        monthCost += cost;
        const e = parts(byModel);
        e.read += u.cacheRead; e.miss += u.cacheMiss; e.out += u.output; e.cost += cost;
      }
      if (ts >= t7) {
        const e = parts(recent7); e.read += u.cacheRead; e.miss += u.cacheMiss; e.out += u.output;
      }
      if (ts >= t30) {
        const e = parts(recent30); e.read += u.cacheRead; e.miss += u.cacheMiss; e.out += u.output;
      }
    }

    if (!anyLedger) {
      return c.json({ ok: true, empty: true, message: 'usage-ledger 暂无成功记录，无法预测。' });
    }

    // 情景日均：近 7 天 / 近 30 天的每模型日均 token 分量；无数据的模型不参与外推
    const scenarioDaily = (src, days) => {
      const out = [];
      for (const [model, e] of src) {
        out.push({ model, read: e.read / days, miss: e.miss / days, out: e.out / days });
      }
      return out;
    };
    const daily7 = scenarioDaily(recent7, 7);
    const daily30 = scenarioDaily(recent30, 30);

    // 一天 24 小时（北京时间）中峰时共 7h（9-12、14-18），谷时 17h。
    // 拆分假设：调用在全天均匀分布 → 峰时占 7/24，谷时占 17/24。
    const PEAK_SHARE = 7 / 24;
    const OFFPEAK_SHARE = 1 - PEAK_SHARE;

    // 未来某天某模型一天的成本：日分量按峰谷拆分后套当天价格
    const dayCost = (entry, ts) => {
      const prov = entry.model.split('/')[0];
      const mid = entry.model.split('/')[1] || '';
      const pricing = pricingFor(prov, mid);
      if (!pricing) return 0;
      const table = priceTableAt(pricing, ts);
      const peak = (entry.read * PEAK_SHARE / 1e6) * table.peak.hit
        + (entry.miss * PEAK_SHARE / 1e6) * table.peak.miss
        + (entry.out * PEAK_SHARE / 1e6) * table.peak.out;
      const off = (entry.read * OFFPEAK_SHARE / 1e6) * table.offpeak.hit
        + (entry.miss * OFFPEAK_SHARE / 1e6) * table.offpeak.miss
        + (entry.out * OFFPEAK_SHARE / 1e6) * table.offpeak.out;
      return peak + off;
    };

    let lowRemaining = 0; // 近 30 天节奏
    let highRemaining = 0; // 近 7 天节奏
    for (let i = 1; i <= daysLeft; i++) {
      const ts = day0.getTime() + i * 86400000 + 12 * 3600000; // 该天正午（取价用）
      for (const e of daily30) lowRemaining += dayCost(e, ts);
      for (const e of daily7) highRemaining += dayCost(e, ts);
    }

    return c.json({
      ok: true,
      month: { year: now.getFullYear(), month: now.getMonth() + 1, days: daysInMonth, dayOfMonth, daysLeft },
      spentToDate: monthCost,
      projectedLow: monthCost + lowRemaining,
      projectedHigh: monthCost + highRemaining,
      remainingLow: lowRemaining,
      remainingHigh: highRemaining,
      method: '近 30 天日均节奏（低）与近 7 天日均节奏（高），按峰谷时段拆分并套价格时间线外推',
    });
  });

  // ---- 配置状态：每家供应商的 hasKey 布尔（多字段的家要求全部填齐才算 true）----
  app.get('/api/status', async (c) => {
    const getKey = makeKeyGetter(c);
    const providers = {};
    for (const p of BALANCE_PROVIDERS) {
      const vals = await Promise.all(p.keys.map((k) => getKey(k)));
      providers[p.id] = vals.every(Boolean);
    }
    return c.json({ ok: true, providers, configured: Object.values(providers).filter(Boolean).length });
  });
}
