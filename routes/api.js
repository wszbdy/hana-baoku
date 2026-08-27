import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance';
// 智谱 GLM 余额接口（官方控制台业务接口），需登录态：Authorization(access_token) + 组织/项目 ID
const ZHIPU_BALANCE_URL = 'https://open.bigmodel.cn/api/biz/account/query-customer-account-report';

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
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
         d.getMonth() === now.getMonth() &&
         d.getDate() === now.getDate();
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

function estimateCost(rec) {
  const u = extractUsage(rec);
  const pricing = pricingFor(rec.model && rec.model.provider, rec.model && rec.model.modelId);
  if (!pricing) return 0;
  const start = Date.parse(rec.startedAt);
  if (!Number.isFinite(start)) return 0;
  // 取时间线中最后一个 from <= start 的价格条目（条目按 from 升序）
  let table = pricing.timeline[0];
  for (const t of pricing.timeline) {
    if (start >= t.from) table = t;
    else break;
  }
  const p = isPeakBeijing(rec.startedAt) ? table.peak : table.offpeak;
  const miss = u.cacheMiss;
  return (u.cacheRead / 1e6) * p.hit + (miss / 1e6) * p.miss + (u.output / 1e6) * p.out;
}

export default function registerPluginUiRoutes(app, ctx) {
  const log = (msg) => { try { if (ctx && ctx.log) ctx.log.info('[dsum] ' + msg); } catch (e) {} };

  const getApiKey = async (c) => {
    const rctx = (c && c.get && c.get('pluginCtx')) || ctx;
    const cfg = rctx && rctx.config;
    if (!cfg) return '';
    if (typeof cfg.get === 'function') {
      try { const v = await cfg.get('deepseekApiKey'); return v || ''; }
      catch (e) { return ''; }
    }
    return cfg.deepseekApiKey || (cfg.global && cfg.global.deepseekApiKey) || '';
  };

  const getGlmAuth = async (c) => {
    const rctx = (c && c.get && c.get('pluginCtx')) || ctx;
    const cfg = rctx && rctx.config;
    const get = async (key) => {
      if (!cfg) return '';
      if (typeof cfg.get === 'function') {
        try { const v = await cfg.get(key); return v || ''; }
        catch (e) { return ''; }
      }
      return cfg[key] || (cfg.global && cfg.global[key]) || '';
    };
    return { token: await get('glmAccessToken'), org: await get('glmOrgId'), project: await get('glmProjectId') };
  };

  const configShape = async (c) => {
    try {
      const rctx = (c && c.get && c.get('pluginCtx')) || ctx;
      const cfg = rctx && rctx.config;
      if (!cfg) return 'null';
      if (typeof cfg.get === 'function') return 'has-get-method';
      const s = JSON.stringify(cfg);
      return s.length > 400 ? s.slice(0, 400) + '...' : s;
    } catch (e) { return 'err:' + e.message; }
  };

  // ---- 余额查询（DeepSeek API）----
  app.get('/api/balance', async (c) => {
    log('balance request');
    const apiKey = await getApiKey(c);
    if (!apiKey) {
      log('balance: no key. configShape=' + await configShape(c));
      return c.json({ ok: false, needKey: true, message: '未配置 DeepSeek API Key，请在插件设置中填写。' });
    }
    try {
      const rctx = c.get('pluginCtx') || ctx;
      const res = await rctx.network.fetch(DEEPSEEK_BALANCE_URL, {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeoutMs: 8000,
      });
      log('balance: status=' + res.status);
      if (!res.ok) {
        return c.json({ ok: false, message: `余额接口返回 ${res.status}` });
      }
      const data = await res.json();
      const infos = (data && data.balance_infos) || [];
      const cny = infos.find((i) => i && i.currency === 'CNY') || infos[0];
      log('balance: ok');
      return c.json({
        ok: true,
        available: data && data.is_available,
        balance: cny ? {
          currency: cny.currency,
          total: num(cny.total_balance),
          granted: num(cny.granted_balance),
          toppedUp: num(cny.topped_up_balance),
        } : null,
      });
    } catch (err) {
      log('balance error: ' + String(err && err.message || err));
      return c.json({ ok: false, message: String(err && err.message || err) });
    }
  });

  // ---- 余额查询（智谱 GLM API）----
  // 官方控制台业务接口，需登录态（非 API Key）：Authorization=access_token + Bigmodel-Organization + Bigmodel-Project
  // 返回 data: { balance, availableBalance, rechargeAmount, giveAmount, totalSpendAmount, frozenBalance }
  app.get('/api/glm-balance', async (c) => {
    log('glm balance request');
    const auth = await getGlmAuth(c);
    if (!auth.token || !auth.org || !auth.project) {
      return c.json({ ok: false, needKey: true, message: '未配置智谱 GLM 登录态。请在插件设置中填写 access_token / 组织ID / 项目ID。' });
    }
    try {
      const rctx = c.get('pluginCtx') || ctx;
      const res = await rctx.network.fetch(ZHIPU_BALANCE_URL, {
        headers: {
          Authorization: auth.token,
          'Bigmodel-Organization': auth.org,
          'Bigmodel-Project': auth.project,
          'Content-Type': 'application/json',
        },
        timeoutMs: 8000,
      });
      log('glm balance: status=' + res.status);
      if (!res.ok) {
        return c.json({ ok: false, message: `智谱余额接口返回 ${res.status}` });
      }
      const data = await res.json();
      if (data && data.code && data.code !== 200) {
        return c.json({ ok: false, message: data.msg || '智谱余额查询失败' });
      }
      const inner = (data && data.data) || {};
      const total = num(inner.balance != null ? inner.balance : inner.availableBalance);
      return c.json({
        ok: true,
        balance: {
          currency: 'CNY',
          total,
          available: num(inner.availableBalance),
          recharge: num(inner.rechargeAmount),
          give: num(inner.giveAmount),
        },
      });
    } catch (err) {
      log('glm balance error: ' + String(err && err.message || err));
      return c.json({ ok: false, message: String(err && err.message || err) });
    }
  });

  // ---- 用量统计（本地 usage-ledger）----
  app.get('/api/usage', async (c) => {
    const data = readLedger();
    if (data.error) return c.json({ ok: false, message: data.error });

    const byModel = new Map();
    const stats = { today: { calls: 0, tokens: 0, cost: 0, cacheRead: 0, cacheMiss: 0 }, total: { calls: 0, tokens: 0, cost: 0, cacheRead: 0, cacheMiss: 0 } };

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

    return c.json({
      ok: true,
      estimated: true,
      pricing: '官方定价估算（DeepSeek 峰谷价，MiMo 统一价，GLM-5.3-Flash 8/26 起五折、9/9 恢复原价）',
      today: { ...stats.today, hitRate: hitRate(stats.today) },
      total: { ...stats.total, hitRate: hitRate(stats.total) },
      byModel: [...byModel.values()].map((m) => ({ ...m, hitRate: hitRate(m) })),
      ledgerPath: ledgerPath(),
    });
  });

  // ---- 配置状态 ----
  app.get('/api/status', async (c) => {
    const a = await getGlmAuth(c);
    return c.json({ ok: true, hasKey: !!(await getApiKey(c)), hasGlmKey: !!(a.token && a.org && a.project) });
  });
}
