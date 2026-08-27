import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { hana } from '@hana/plugin-sdk';
import { Button, CardShell, HanaThemeProvider, EmptyState } from '@hana/plugin-components';
import '@hana/plugin-components/styles.css';
import './panel.css';

function fmtNum(n) {
  if (!n && n !== 0) return '-';
  if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(Math.round(n));
}

function fmtMoney(n) {
  if (!n && n !== 0) return '-';
  if (n > 0 && n < 0.01) return '¥' + Number(n).toFixed(4);
  return '¥' + Number(n).toFixed(2);
}

const statBoxStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 100,
  padding: '12px 14px',
  borderRadius: 12,
  background: 'rgba(255, 255, 255, 0.6)',
  border: '1px solid rgba(218, 165, 32, 0.12)',
  backdropFilter: 'blur(8px)',
  transition: 'all 0.2s ease',
  boxShadow: '0 2px 8px rgba(184, 134, 11, 0.06)',
};

const statLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'rgba(184, 134, 11, 0.6)',
  fontWeight: 500,
  letterSpacing: '0.05em',
  textTransform: 'uppercase' as const,
  fontFamily: "'STKaiti', 'KaiTi', serif",
};

const statValueStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  marginTop: 4,
  background: 'linear-gradient(135deg, #b8860b, #daa520, #ffd700)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
};

const statSubStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'rgba(60, 52, 39, 0.4)',
  marginTop: 3,
};

function StatBox({ label, value, sub }) {
  return (
    <div style={statBoxStyle}>
      <div style={statLabelStyle}>{label}</div>
      <div style={statValueStyle}>{value}</div>
      {sub ? <div style={statSubStyle}>{sub}</div> : null}
    </div>
  );
}

function Panel() {
  const surface = document.getElementById('root')?.dataset.surface || 'page';
  const isWidget = surface === 'widget';
  const [balance, setBalance] = useState<any>(null);
  const [glmBalance, setGlmBalance] = useState<any>(null);
  const [usage, setUsage] = useState<any>(null);
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
      .fetch('api/balance')
      .then((r) => r.json())
      .then((b) => {
        setBalance(b);
        if (b && !b.ok && b.needKey) setError('未配置 DeepSeek API Key：插件设置 → 填写 sk- 开头的 Key 后点刷新');
        else if (b && !b.ok && b.message) setError('余额：' + b.message);
      })
      .catch(() => setError('余额查询失败'));
    hana.api
      .fetch('api/glm-balance')
      .then((r) => r.json())
      .then((b) => {
        setGlmBalance(b);
        if (b && !b.ok && b.needKey) setError('未配置智谱 GLM API Key：插件设置 → 填写后点刷新');
        else if (b && !b.ok && b.message) setError('GLM 余额：' + b.message);
      })
      .catch(() => setError('GLM 余额查询失败'));
    setLoading(false);
  }, []);

  useEffect(() => {
    hana.ready();
    hana.ui.resize({ height: isWidget ? 340 : 580 });
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [isWidget, load]);

  const rows = (usage && usage.byModel) || [];
  const today = usage && usage.today;
  const total = usage && usage.total;

  const modelRowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 12,
    padding: '6px 0',
    borderBottom: '1px solid rgba(218, 165, 32, 0.08)',
    color: 'rgba(60, 52, 39, 0.7)',
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

        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <StatBox
            label="DeepSeek 余额"
            value={balance && balance.ok && balance.balance ? fmtMoney(balance.balance.total) : '-'}
            sub={balance && balance.balance ? `赠送 ${fmtMoney(balance.balance.granted)} · 充值 ${fmtMoney(balance.balance.toppedUp)}` : balance && balance.needKey ? '需配置 API Key' : '查询失败'}
          />
          <StatBox
            label="GLM 余额"
            value={glmBalance && glmBalance.ok && glmBalance.balance ? fmtMoney(glmBalance.balance.total) : '-'}
            sub={glmBalance && glmBalance.needKey ? '需配置 API Key' : glmBalance && !glmBalance.ok ? '查询失败' : '智谱现金余额'}
          />
          <StatBox label="今日 Token" value={today ? fmtNum(today.tokens) : '-'} sub={today ? `${today.calls} 次调用` : ''} />
          <StatBox label="今日费用" value={today ? fmtMoney(today.cost) : '-'} sub="按官方定价估算" />
          <StatBox label="缓存命中率" value={today ? today.hitRate + '%' : '-'} sub={today && today.cacheRead ? `命中 ${fmtNum(today.cacheRead)}` : ''} />
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <StatBox label="累计 Token" value={total ? fmtNum(total.tokens) : '-'} sub={total ? `${total.calls} 次调用` : ''} />
          <StatBox label="累计费用" value={total ? fmtMoney(total.cost) : '-'} sub="按官方定价估算" />
          <StatBox label="累计命中率" value={total ? total.hitRate + '%' : '-'} sub={total && total.cacheRead ? `命中 ${fmtNum(total.cacheRead)}` : ''} />
        </div>

        {rows.length > 0 && (
          <div style={{ borderTop: '1px solid rgba(218, 165, 32, 0.1)', paddingTop: 10 }}>
            {rows.map((m) => (
              <div key={m.model} style={modelRowStyle}>
                <span style={{ color: 'rgba(184, 134, 11, 0.7)', fontWeight: 500 }}>{m.model}</span>
                <span>
                  {fmtNum(m.tokens)} tok · ¥{Number(m.cost).toFixed(3)} · {m.hitRate}% hit
                </span>
              </div>
            ))}
          </div>
        )}

        <div style={{ fontSize: 11, color: 'rgba(60, 52, 39, 0.35)', marginTop: 12, fontStyle: 'italic' }}>
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
