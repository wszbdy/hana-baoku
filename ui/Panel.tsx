import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { hana } from '@hana/plugin-sdk';
import { Button, CardShell, HanaThemeProvider, EmptyState } from '@hana/plugin-components';
import '@hana/plugin-components/styles.css';
import './panel.css';

/* ─── 图表配色（已过 dataviz 调色板验证：CVD ΔE 12.5 / 对比度 ≥3:1 / 浅色表面 #fcfaf8）─── */
const SERIES_TOKEN = '#b8860b'; // token 用量 = 金
const SERIES_COST = '#0d9488'; // 费用 = 青碧（暖冷对比）
const INK_1 = '#3d3427';
const INK_2 = 'rgba(61, 52, 39, 0.66)';
const INK_3 = 'rgba(61, 52, 39, 0.45)';
const GRID = '#efe7d7';
const AXIS = '#ddd2ba';
const SURFACE = '#fcfaf8';

function fmtNum(n: number) {
  if (!n && n !== 0) return '-';
  if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(Math.round(n));
}

function fmtMoney(n: number, sym = '¥') {
  if (!n && n !== 0) return '-';
  if (n > 0 && n < 0.01) return sym + Number(n).toFixed(4);
  return sym + Number(n).toFixed(2);
}

// 坐标轴刻度用：去尾零（0.5 / 1.2 / 40）
function fmtTick(n: number) {
  const s = n >= 100 ? String(Math.round(n)) : Number(n.toFixed(2)).toString();
  return n >= 1000 ? fmtNum(n) : s;
}

// 轴上限取整到 1/2/5×10^n，刻度保持干净
function niceMax(v: number) {
  if (v <= 0) return 1;
  const base = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 5, 10]) {
    if (v <= m * base) return m * base;
  }
  return 10 * base;
}

/* ─── 月度费用预测卡：本月账单区间 + 进度条（剩余预算轨道）─── */
function ForecastCard({ forecast }: { forecast: any }) {
  if (!forecast || !forecast.ok) return null;
  if (forecast.empty) {
    return (
      <section style={{ marginBottom: 14 }}>
        <SectionTitle>本月费用预测</SectionTitle>
        <div style={{ fontSize: 12, color: INK_3, padding: '6px 2px' }}>{forecast.message}</div>
      </section>
    );
  }
  const m = forecast.month || {};
  const lo = Number(forecast.projectedLow) || 0;
  const hi = Number(forecast.projectedHigh) || 0;
  const spent = Number(forecast.spentToDate) || 0;
  // 进度条以高情景为满格轨道（最坏情况占满），已花费用系列色填充
  const trackMax = Math.max(hi, spent, 0.01);
  const pct = (v: number) => Math.max(0, Math.min(100, (v / trackMax) * 100));

  return (
    <section style={{ marginBottom: 14 }}>
      <SectionTitle>本月费用预测</SectionTitle>
      <div className="forecast-card">
        <div className="forecast-range">
          <span className="forecast-range-value">
            {fmtMoney(lo)} – {fmtMoney(hi)}
          </span>
          <span className="forecast-range-note">
            {m.month} 月 · 第 {m.dayOfMonth}/{m.days} 天 · 剩 {m.daysLeft} 天
          </span>
        </div>
        {/* 预测区间轨道：已花（实色）+ 低到高情景区间（10% 洗色） */}
        <div className="forecast-track" role="img" aria-label={`本月已花费 ${fmtMoney(spent)}，预测全月 ${fmtMoney(lo)} 到 ${fmtMoney(hi)}`}>
          <div className="forecast-track-fill" style={{ width: pct(spent) + '%' }} />
          {lo > spent && (
            <div
              className="forecast-track-band"
              style={{ left: pct(lo) + '%', width: Math.max(pct(hi) - pct(lo), 0) + '%' }}
            />
          )}
        </div>
        <div className="forecast-meta">
          <span>已花 {fmtMoney(spent)}</span>
          <span>剩余预计 {fmtMoney(forecast.remainingLow)} – {fmtMoney(forecast.remainingHigh)}</span>
        </div>
        <div className="forecast-method">{forecast.method}</div>
      </div>
    </section>
  );
}

const statBoxStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 118,
  padding: '14px 16px',
  borderRadius: 14,
  background: 'rgba(255, 255, 255, 0.72)',
  border: '1px solid rgba(218, 165, 32, 0.14)',
  backdropFilter: 'blur(8px)',
  transition: 'all 0.2s ease',
  boxShadow: '0 2px 8px rgba(184, 134, 11, 0.06)',
};

const statLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'rgba(184, 134, 11, 0.75)',
  fontWeight: 600,
  letterSpacing: '0.08em',
  fontFamily: "'STKaiti', 'KaiTi', serif",
};

const statValueStyle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 700,
  marginTop: 6,
  color: INK_1,
  lineHeight: 1.15,
};

const statSubStyle: React.CSSProperties = {
  fontSize: 11,
  color: INK_3,
  marginTop: 4,
};

function StatBox({ label, value, sub, big }: { label: string; value: React.ReactNode; sub?: React.ReactNode; big?: boolean }) {
  return (
    <div style={statBoxStyle}>
      <div style={statLabelStyle}>{label}</div>
      <div style={{ ...statValueStyle, fontSize: big ? 28 : 24 }}>{value}</div>
      {sub ? <div style={statSubStyle}>{sub}</div> : null}
    </div>
  );
}

/* ─── 余额供应商卡片：按各家响应结构渲染主值 + 副行；失败态显示错误信息 ─── */
type BalResult = {
  id: string;
  name: string;
  currency: string;
  ok: boolean;
  available?: boolean;
  balance?: any;
  message?: string;
};

function BalanceCard({ r }: { r: BalResult }) {
  let value: React.ReactNode = '-';
  let sub: React.ReactNode = '';
  let fail = false;
  const b = r.balance;

  if (!r.ok) {
    fail = true;
    sub = '查询失败' + (r.message ? '：' + r.message : '');
  } else if (b) {
    switch (r.id) {
      case 'deepseek':
        value = fmtMoney(b.total);
        sub = `赠送 ${fmtMoney(b.granted)} · 充值 ${fmtMoney(b.toppedUp)}` + (r.available === false ? ' · API 欠费不可用' : '');
        break;
      case 'glm':
        value = fmtMoney(b.total);
        sub = `可用 ${fmtMoney(b.available)} · 赠送 ${fmtMoney(b.give)}`;
        break;
      case 'kimi':
        value = fmtMoney(b.total);
        sub = `代金券 ${fmtMoney(b.voucher)} · 现金 ${fmtMoney(b.cash)}`;
        break;
      case 'siliconflow':
        value = fmtMoney(b.total);
        sub = `充值 ${fmtMoney(b.charge)} · 总额度 ${fmtMoney(b.all)}` + (b.status ? ` · ${b.status}` : '');
        break;
      case 'openrouter':
        if (b.unlimited) {
          value = '无限额度';
          sub = `已用 ${fmtMoney(b.used, '$')}` + (b.freeTier ? ' · 免费层' : '');
        } else {
          value = fmtMoney(b.remaining, '$');
          sub = `额度 ${fmtMoney(b.limit, '$')} · 已用 ${fmtMoney(b.used, '$')}` + (b.freeTier ? ' · 免费层' : '');
        }
        break;
      default:
        value = '-';
    }
  }

  return (
    <div style={{ ...statBoxStyle, ...(fail ? { borderColor: 'rgba(200, 80, 60, 0.25)' } : null) }}>
      <div style={statLabelStyle}>{r.name}</div>
      <div style={{ ...statValueStyle, ...(fail ? { color: 'rgba(160, 90, 74, 0.75)' } : null) }}>{value}</div>
      {sub ? (
        <div style={{ ...statSubStyle, ...(fail ? { color: 'rgba(160, 90, 74, 0.65)' } : null), lineHeight: 1.4 }}>{sub}</div>
      ) : null}
    </div>
  );
}

/* ─── 套餐（Plan）用量区块：GLM Coding Plan 的 5h / 周额度进度条 ─── */
type PlanWindow = {
  type: string;
  used: number | null;
  total: number | null;
  percent: number;
  resetAt: number | null;
};

type PlanInfo = {
  ok: boolean;
  hasPlan?: boolean;
  reason?: string;
  name?: string;
  planName?: string;
  exhausted?: boolean;
  window?: PlanWindow[];
  message?: string;
};

const PLAN_TYPE_LABEL: Record<string, string> = {
  '5h': '5 小时窗口',
  weekly: '周额度',
};

// meter 填充色随用量分级：<80% 金、80–95% 琥珀、≥95% 红（严重度语义）
function planFill(pct: number) {
  if (pct >= 95) return '#b91c1c';
  if (pct >= 80) return '#b45309';
  return 'linear-gradient(90deg, #b8860b, #daa520)';
}

function fmtReset(ts: number | null) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const hm = p(d.getHours()) + ':' + p(d.getMinutes());
  return (sameDay ? '' : d.getMonth() + 1 + '/' + d.getDate() + ' ') + hm;
}

function PlanWindowBar({ w }: { w: PlanWindow }) {
  const pct = Math.max(0, Math.min(100, Number(w.percent) || 0));
  const label = PLAN_TYPE_LABEL[w.type] || w.type;
  const usedStr = w.used != null ? fmtNum(w.used) : null;
  const totalStr = w.total != null ? fmtNum(w.total) : null;
  const ratio = usedStr && totalStr ? `${usedStr} / ${totalStr}` : '';
  const reset = fmtReset(w.resetAt);

  return (
    <div className="plan-window">
      <div className="plan-window-head">
        <span className="plan-window-label">{label}</span>
        <span className="plan-window-ratio">
          {ratio ? ratio + ' · ' : ''}
          {pct}%
        </span>
      </div>
      <div
        className="plan-track"
        role="img"
        aria-label={`${label}：已用 ${pct}%${ratio ? '（' + ratio + '）' : ''}${reset ? '，重置于 ' + reset : ''}`}
      >
        <div className="plan-track-fill" style={{ width: pct + '%', background: planFill(pct) }} />
      </div>
      {reset ? <div className="plan-window-reset">重置于 {reset}</div> : null}
    </div>
  );
}

function PlanSection({ plan }: { plan: PlanInfo | null }) {
  if (!plan) return null;
  return (
    <section style={{ marginBottom: 14 }}>
      <SectionTitle>套餐用量</SectionTitle>
      {!plan.ok ? (
        <div className="plan-note plan-note-fail">GLM Coding Plan 查询失败{plan.message ? '：' + plan.message : ''}</div>
      ) : !plan.hasPlan ? (
        plan.reason === 'needKey' ? (
          <div className="balance-guide">
            未配置智谱 GLM 登录态 —— 在插件设置中填写 access_token / 组织ID / 项目ID 后点刷新，即可查看 GLM Coding Plan 的 5 小时与周额度用量。
          </div>
        ) : (
          <div className="plan-note">{plan.message || '当前账号未查询到套餐用量'}</div>
        )
      ) : plan.exhausted ? (
        <div className="plan-note plan-note-exhausted">套餐积分已用尽，等待额度重置</div>
      ) : (
        <div className="plan-card">
          {plan.planName ? <div className="plan-name">{plan.planName}</div> : null}
          {(plan.window || []).map((w, i) => (
            <PlanWindowBar key={w.type + i} w={w} />
          ))}
        </div>
      )}
    </section>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="section-title">
      <span className="section-title-mark" aria-hidden="true" />
      {children}
    </div>
  );
}

/* ─── 容器宽度自适应 hook（SVG 按真实像素渲染，文字不变形）─── */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

type TrendPoint = { label: string; date: string; v: number; extra?: string };

/* ─── 纯 SVG 趋势图：单系列单轴，2px 线 + 10% 面积洗色 + 十字线 tooltip + 键盘焦点 ─── */
function TrendChart({ title, unit, data, color, format }: {
  title: string;
  unit: string;
  data: TrendPoint[];
  color: string;
  format: (n: number) => string;
}) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState(-1);
  const H = 148;
  const PAD_L = 44;
  const PAD_R = 16;
  const PAD_T = 18;
  const PAD_B = 22;
  const w = Math.max(width || 0, 220);
  const iw = w - PAD_L - PAD_R;
  const ih = H - PAD_T - PAD_B;
  const n = data.length;
  const maxV = n ? Math.max(...data.map((d) => d.v)) : 0;
  const sumV = n ? data.reduce((s, d) => s + d.v, 0) : 0;
  const yMax = niceMax(maxV);
  const x = (i: number) => PAD_L + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => PAD_T + ih - (yMax > 0 ? (v / yMax) * ih : 0);

  const linePath = data.map((d, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(d.v).toFixed(1)).join(' ');
  const areaPath = n > 1
    ? linePath + ' L' + x(n - 1).toFixed(1) + ',' + (PAD_T + ih) + ' L' + x(0).toFixed(1) + ',' + (PAD_T + ih) + ' Z'
    : '';
  const ticks = [0, yMax / 2, yMax];
  const xTicks = n > 1 ? [0, Math.round((n - 1) / 2), n - 1] : [0];
  const hoverPt = hover >= 0 && hover < n ? data[hover] : null;

  const onPointerMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left + PAD_L;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - PAD_L) / Math.max(iw, 1)) * (n - 1))));
    setHover(i);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') { setHover((h) => Math.max(0, h < 0 ? n - 1 : h - 1)); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { setHover((h) => Math.min(n - 1, h < 0 ? 0 : h + 1)); e.preventDefault(); }
    else if (e.key === 'Escape') { setHover(-1); }
  };

  // tooltip 横向位置钳制在容器内
  const tipX = hover >= 0 ? Math.min(Math.max(x(hover), 64), w - 64) : 0;

  return (
    <div className="trend-chart" style={{ flex: 1, minWidth: 250 }}>
      <div className="trend-chart-head">
        <span className="trend-chart-key" style={{ background: color }} aria-hidden="true" />
        <span className="trend-chart-title">{title}</span>
        {sumV > 0 ? <span className="trend-chart-sum">{format(sumV)}{unit}</span> : null}
      </div>
      <div ref={wrapRef} className="trend-chart-body" style={{ position: 'relative' }}>
        {width > 0 && (
          <svg
            width={w}
            height={H}
            tabIndex={0}
            role="img"
            aria-label={`${title}：最近 30 天，方向键查看每日数值`}
            onKeyDown={onKeyDown}
            onBlur={() => setHover(-1)}
            style={{ display: 'block', outline: 'none' }}
          >
            {/* 网格线：细实线，退后 */}
            {ticks.map((t) => (
              <line key={t} x1={PAD_L} x2={w - PAD_R} y1={y(t)} y2={y(t)} stroke={t === 0 ? AXIS : GRID} strokeWidth={1} />
            ))}
            {/* y 刻度：文字用墨色 token，不用系列色 */}
            {ticks.map((t) => (
              <text key={'l' + t} x={PAD_L - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill={INK_3} style={{ fontVariantNumeric: 'tabular-nums' }}>
                {fmtTick(t)}
              </text>
            ))}
            {/* x 刻度：首 / 中 / 尾 */}
            {xTicks.map((i) => (
              <text key={'x' + i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize={10} fill={INK_3}>
                {data[i] ? data[i].label : ''}
              </text>
            ))}
            {sumV > 0 && n > 1 && (
              <>
                <path d={areaPath} fill={color} opacity={0.1} />
                <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {/* 端点：r4 + 2px 表面色描边环 */}
                <circle cx={x(n - 1)} cy={y(data[n - 1].v)} r={4} fill={color} stroke={SURFACE} strokeWidth={2} />
                {/* 端点直标（只标终点，不放每点数值） */}
                <text x={x(n - 1) - 7} y={y(data[n - 1].v) - 8} textAnchor="end" fontSize={11} fontWeight={600} fill={INK_1}>
                  {format(data[n - 1].v)}
                </text>
              </>
            )}
            {sumV === 0 && (
              <text x={PAD_L + iw / 2} y={PAD_T + ih / 2} textAnchor="middle" fontSize={11} fill={INK_3}>
                近 30 天暂无数据
              </text>
            )}
            {/* 十字线 + 焦点标记 */}
            {hoverPt && (
              <>
                <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={PAD_T + ih} stroke={AXIS} strokeWidth={1} />
                <circle cx={x(hover)} cy={y(hoverPt.v)} r={4} fill={color} stroke={SURFACE} strokeWidth={2} />
              </>
            )}
            {/* 命中层：整个绘图区都是热区 */}
            <rect
              x={PAD_L}
              y={PAD_T}
              width={Math.max(iw, 1)}
              height={ih}
              fill="transparent"
              onPointerMove={onPointerMove}
              onPointerLeave={() => setHover(-1)}
            />
          </svg>
        )}
        {hoverPt && (
          <div
            className="chart-tooltip"
            style={{ left: tipX, transform: 'translateX(-50%)' }}
            role="status"
          >
            <div className="chart-tooltip-value">
              <span className="trend-chart-key" style={{ background: color }} aria-hidden="true" />
              {format(hoverPt.v)}{unit}
            </div>
            <div className="chart-tooltip-label">
              {hoverPt.date}
              {hoverPt.extra ? ' · ' + hoverPt.extra : ''}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── 趋势数据表（tooltip 之外的无障碍兜底视图）─── */
type DailyPoint = { date: string; label: string; tokens: number; cost: number; calls: number };

function TrendTable({ daily }: { daily: DailyPoint[] }) {
  const rows = daily.slice().reverse();
  return (
    <details className="trend-table">
      <summary>逐日数据表</summary>
      <table>
        <thead>
          <tr>
            <th>日期</th>
            <th>Token</th>
            <th>费用（估）</th>
            <th>调用</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{fmtNum(d.tokens)}</td>
              <td>{Number(d.cost).toFixed(3)}</td>
              <td>{d.calls}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function Panel() {
  const surface = document.getElementById('root')?.dataset.surface || 'page';
  const isWidget = surface === 'widget';
  const [balances, setBalances] = useState<BalResult[] | null>(null);
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [usage, setUsage] = useState<any>(null);
  const [forecast, setForecast] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    hana.api
      .fetch('api/usage')
      .then((r) => r.json())
      .then((u) => {
        setUsage(u);
        if (u && !u.ok && u.message) setError('用量：' + u.message);
      })
      .catch(() => setError('用量读取失败'));
    hana.api
      .fetch('api/forecast')
      .then((r) => r.json())
      .then((f) => setForecast(f))
      .catch(() => { /* 预测失败不阻塞主面板 */ });
    // 余额聚合：单家失败由各家卡片自己展示，不进全局 error
    hana.api
      .fetch('api/balances')
      .then((r) => r.json())
      .then((b) => {
        if (b && b.ok) setBalances(b.results || []);
        else if (b && b.message) setError('余额：' + b.message);
      })
      .catch(() => setError('余额查询失败'));
    // 套餐用量：失败态由区块自己展示，不阻塞主面板
    hana.api
      .fetch('api/glm-plan')
      .then((r) => r.json())
      .then((p) => setPlan(p))
      .catch(() => setPlan({ ok: false, message: '请求失败' }));
    setLoading(false);
  }, []);

  useEffect(() => {
    hana.ready();
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [load]);

  // 高度实测自适应：内容（图表/表格展开）变化后重设 iframe 高度
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      try {
        const h = Math.ceil(document.body.scrollHeight);
        hana.ui.resize({ height: Math.max(isWidget ? 320 : 560, h) });
      } catch (e) { /* 忽略：宿主不支持 resize 时保持初始高度 */ }
    });
    return () => cancelAnimationFrame(raf);
  }, [isWidget, usage, forecast, balances, plan, error]);

  const rows: any[] = ((usage && usage.byModel) || []).slice().sort((a: any, b: any) => (Number(b.tokens) || 0) - (Number(a.tokens) || 0));
  const today = usage && usage.today;
  const total = usage && usage.total;
  const daily: DailyPoint[] = (usage && usage.daily) || [];
  const tokenSeries: TrendPoint[] = daily.map((d) => ({ label: d.label, date: d.date, v: Number(d.tokens) || 0, extra: d.calls + ' 次调用' }));
  const costSeries: TrendPoint[] = daily.map((d) => ({ label: d.label, date: d.date, v: Number(d.cost) || 0, extra: d.calls + ' 次调用' }));

  const modelRowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 12.5,
    padding: '7px 0',
    borderBottom: '1px solid rgba(218, 165, 32, 0.08)',
    color: 'rgba(60, 52, 39, 0.72)',
  };

  return (
    <HanaThemeProvider mode="inherit" className="plugin-panel">
      <CardShell
        title="王之宝库"
        description="余额 / token / 缓存命中 / 费用"
        actions={
          <Button variant="ghost" onClick={load} disabled={loading}>
            {loading ? '…' : '刷新'}
          </Button>
        }
      >
        {error ? <EmptyState title="需要处理" description={error} /> : null}

        {/* 余额卡片流：只渲染配置了 key 的平台；全未配时显示引导 */}
        <SectionTitle>平台余额</SectionTitle>
        {balances === null ? null : balances.length === 0 ? (
          <div className="balance-guide">
            尚未配置任何平台的密钥 —— 在插件设置中填写 DeepSeek / 智谱 GLM / Kimi / 硅基流动 / OpenRouter
            的 Key 后点刷新，余额卡片会自动出现。
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            {balances.map((r: BalResult) => (
              <BalanceCard key={r.id} r={r} />
            ))}
          </div>
        )}

        {!isWidget && <PlanSection plan={plan} />}

        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <StatBox label="今日 Token" value={today ? fmtNum(today.tokens) : '-'} sub={today ? `${today.calls} 次调用` : ''} />
          <StatBox label="今日费用" value={today ? fmtMoney(today.cost) : '-'} sub="按官方定价估算" />
          <StatBox label="缓存命中率" value={today ? today.hitRate + '%' : '-'} sub={today && today.cacheRead ? `命中 ${fmtNum(today.cacheRead)}` : ''} />
        </div>

        {!isWidget && tokenSeries.length > 0 && (
          <section style={{ marginBottom: 14 }}>
            <SectionTitle>近 30 天趋势</SectionTitle>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <TrendChart title="Token 用量" unit="" data={tokenSeries} color={SERIES_TOKEN} format={(v) => fmtTick(v)} />
              <TrendChart title="费用（估）" unit=" 元" data={costSeries} color={SERIES_COST} format={(v) => '¥' + fmtTick(v)} />
            </div>
            <TrendTable daily={daily} />
          </section>
        )}

        {!isWidget && <ForecastCard forecast={forecast} />}

        {rows.length > 0 && (
          <section style={{ marginBottom: 12 }}>
            <SectionTitle>按模型统计（累计）</SectionTitle>
            {rows.map((m: any) => (
              <div key={m.model} style={modelRowStyle}>
                <span style={{ color: 'rgba(184, 134, 11, 0.8)', fontWeight: 500 }}>{m.model}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {fmtNum(m.tokens)} tok · ¥{Number(m.cost).toFixed(3)} · {m.hitRate}% hit
                </span>
              </div>
            ))}
          </section>
        )}

        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <StatBox label="累计 Token" value={total ? fmtNum(total.tokens) : '-'} sub={total ? `${total.calls} 次调用` : ''} />
          <StatBox label="累计费用" value={total ? fmtMoney(total.cost) : '-'} sub="按官方定价估算" />
          <StatBox label="累计命中率" value={total ? total.hitRate + '%' : '-'} sub={total && total.cacheRead ? `命中 ${fmtNum(total.cacheRead)}` : ''} />
        </div>

        <div style={{ fontSize: 11, color: INK_3, marginTop: 4, fontStyle: 'italic' }}>
          {usage && usage.estimated ? '费用为估算：DeepSeek 按峰谷价（高峰 9-12/14-18 点），MiMo 统一价' : ''}
          <br />
          {usage && usage.ledgerPath ? '数据源：' + usage.ledgerPath : ''}
        </div>
      </CardShell>
    </HanaThemeProvider>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<Panel />);
