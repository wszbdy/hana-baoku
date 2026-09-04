// 余额/套餐 parser mock 自验（node 直接跑，与 api.js 内联导出配合）
import { balanceParsers, planParsers } from '../routes/api.js';

const { parseStepfunBalance, parseNovitaBalance } = balanceParsers;
const { parseMiniMaxPlanRemains } = planParsers;

function assertEq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error('✗ ' + label + '\n  期望: ' + e + '\n  实际: ' + a);
    process.exitCode = 1;
  } else {
    console.log('✓ ' + label);
  }
}

function assertThrow(fn, label, kindExpect) {
  try {
    fn();
    console.error('✗ ' + label + '（未抛错）');
    process.exitCode = 1;
  } catch (err) {
    if (kindExpect && err.kind !== kindExpect) {
      console.error('✗ ' + label + '（kind 期望 ' + kindExpect + '，实际 ' + err.kind + '）');
      process.exitCode = 1;
    } else {
      console.log('✓ ' + label);
    }
  }
}

// ---- StepFun ----
assertEq(parseStepfunBalance({ object: 'balance', balance: 12.34, total_cash_balance: 10.0, total_voucher_balance: 2.34 }),
  { balance: { total: 12.34, cash: 10, voucher: 2.34 } }, 'StepFun 数字 balance');
assertEq(parseStepfunBalance({ balance: '55.5' }), { balance: { total: 55.5, cash: 0, voucher: 0 } }, 'StepFun 字符串 balance 兼容');
assertThrow(() => parseStepfunBalance({}), 'StepFun 缺字段抛错');

// ---- Novita ----
assertEq(parseNovitaBalance({ availableBalance: 150000, cashBalance: 100000, creditLimit: 50000 }),
  { balance: { total: 15, cash: 10, creditLimit: 5 } }, 'Novita /10000 精度换算');
assertThrow(() => parseNovitaBalance({ msg: 'invalid key' }), 'Novita 缺字段抛错');

// ---- MiniMax ----
const mmOk = parseMiniMaxPlanRemains({
  base_resp: { status_code: 0, status_msg: 'success' },
  data: {
    current_interval_total_count: 5000000,
    current_interval_usage_count: 4250000,
    current_interval_reset_time: '2026-09-04T21:00:00+08:00',
    current_weekly_total_count: 35000000,
    current_weekly_usage_count: 8400000,
    current_weekly_reset_time: '2026-09-07T00:00:00+08:00',
  },
});
assertEq(mmOk.windows[0], { type: '5h', used: 4250000, total: 5000000, percent: 85, resetAt: Date.parse('2026-09-04T21:00:00+08:00') }, 'MiniMax 5h 窗口');
assertEq(mmOk.windows[1].type, 'weekly', 'MiniMax 周窗口');
assertEq(mmOk.exhausted, false, 'MiniMax 非耗尽');

// 1004 login fail → kind:'auth'
assertThrow(() => parseMiniMaxPlanRemains({ base_resp: { status_code: 1004, status_msg: 'login fail: Please carry the API secret key' } }),
  'MiniMax 1004 → auth', 'auth');

// 全耗尽 → exhausted
const mmUsed = parseMiniMaxPlanRemains({
  base_resp: { status_code: 0 },
  data: { current_interval_total_count: 100, current_interval_usage_count: 100, current_weekly_total_count: 100, current_weekly_usage_count: 100 },
});
assertEq(mmUsed.exhausted, true, 'MiniMax 全窗口耗尽 → exhausted');

// 顶层 code 兼容形态
assertEq(parseMiniMaxPlanRemains({ code: 0, data: { current_weekly_total_count: 700, current_weekly_usage_count: 70 } }).windows.length, 1, 'MiniMax 顶层 code 兼容（仅周窗）');

// ---- 智谱余额登录态过期 → auth（回归检查原 parser 未被破坏）----
assertThrow(() => balanceParsers.parseGlmBalance({ code: 401, msg: 'token 已过期' }), '智谱 token 过期 → auth', 'auth');

console.log(process.exitCode ? '\n存在失败用例' : '\n全部通过');
