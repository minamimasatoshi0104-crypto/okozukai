'use strict';

const CFG = window.OKOZUKAI_CONFIG;
const SESSION_KEY = 'okozukai.session';
const CAT_COLORS = { '食べ物': '#0E7C66', '遊び': '#F0A04B', '課金': '#4F4FC9', '買い物': '#7A8F2E', '交通': '#A9D3C7', '貯金': '#6B7FA8', '使途不明': '#C2410C', 'その他': '#9AA5A0' };
const MARKS = [
  { label: '未チェック', cls: '' },
  { label: '見たよ', cls: 'check' },
  { label: '注目中', cls: 'eye' },
  { label: 'ストップ', cls: 'stop' },
];

const S = {
  session: null,
  user: null,
  month: thisMonth(),
  data: null,
  loading: false,
  inputType: 'expense',
  inputCat: '食べ物',
  filter: 'all',
  presetDraft: null,
};

const app = document.getElementById('app');

// ---------- 小さな道具 ----------

function h(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function yen(n) {
  return '¥' + Number(n || 0).toLocaleString('ja-JP');
}
function today() {
  return new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD（端末のタイムゾーン）
}
function thisMonth() {
  return today().slice(0, 7);
}
function shiftMonth(m, d) {
  const [y, mo] = m.split('-').map(Number);
  const dt = new Date(y, mo - 1 + d, 1);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
}
function monthLabel(m) {
  const [y, mo] = m.split('-');
  return y + '年' + Number(mo) + '月';
}
function md(date) {
  const [, m, d] = date.split('-');
  return Number(m) + '/' + d;
}
function timeLabel(ms) {
  if (!ms) return '';
  const d = new Date(Number(ms));
  const sameDay = d.toLocaleDateString('sv-SE') === today();
  const hm = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
  return (sameDay ? '今日 ' : d.getMonth() + 1 + '/' + d.getDate() + ' ') + hm;
}
function storage(fn) {
  try {
    return fn(window.localStorage);
  } catch (e) {
    return null;
  }
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3000);
}

const ICON = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  stop: '<path d="M8 2.5h8l5.5 5.5v8L16 21.5H8L2.5 16V8z"/><path d="M7.5 12h9"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
};
function icon(name, size) {
  const s = size || 24;
  return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + '</svg>';
}
function markPill(m) {
  if (!m) return '';
  const name = m === 1 ? 'check' : m === 2 ? 'eye' : 'stop';
  return '<span class="pill ' + MARKS[m].cls + '">' + icon(name, 11) + MARKS[m].label + '</span>';
}

// ---------- 認証（Google ログイン） ----------

// Google の ID トークンはログイン時に一度だけサーバーへ渡し、以後はサーバーが発行したセッションを使う

function setSession(s) {
  S.session = s;
  storage((ls) => (s ? ls.setItem(SESSION_KEY, s) : ls.removeItem(SESSION_KEY)));
}

let googleReady = false;
let googleWait = 0;
function initGoogle() {
  if (!window.google || !google.accounts) {
    // 読み込めないまま真っ白にならないよう、10秒で案内を出す
    if (++googleWait === 50 && !S.session) renderLogin('ログインの準備ができませんでした。通信状態を確かめて、アプリを開き直してください。');
    setTimeout(initGoogle, 200);
    return;
  }
  google.accounts.id.initialize({
    client_id: CFG.clientId,
    auto_select: true,
    callback: onGoogleLogin,
  });
  googleReady = true;
  if (!S.session) {
    renderLogin();
    google.accounts.id.prompt();
  }
}

async function onGoogleLogin(res) {
  renderMessage('ログインしています…');
  try {
    const data = await api('login', { idToken: res.credential });
    setSession(data.session);
    S.user = data.user;
  } catch (e) {
    if (!S.user) renderLogin(e.message === 'forbidden' ? 'このアカウントは登録されていません。' : 'ログインできませんでした。もう一度試してください。');
    return;
  }
  await load(thisMonth());
}

function renderLogin(message) {
  app.innerHTML =
    '<div class="login"><h1>おこづかい帳</h1>' +
    '<p class="muted">家族の Google アカウントでログインしてください</p>' +
    '<div id="gbtn"></div>' +
    (message ? '<p class="small" style="color:var(--warn)">' + h(message) + '</p>' : '') +
    '</div>';
  if (googleReady) {
    google.accounts.id.renderButton(document.getElementById('gbtn'), { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'ja' });
  }
}

function renderMessage(message, retry) {
  app.innerHTML =
    '<div class="login"><h1>おこづかい帳</h1><p class="muted">' + h(message) + '</p>' +
    (retry ? '<button class="btn" data-act="retry">もう一度読み込む</button>' : '') +
    '</div>';
}

function signOut(message) {
  setSession(null);
  S.user = null;
  S.data = null;
  renderLogin(message);
  if (googleReady) google.accounts.id.prompt();
}

// ---------- API ----------

async function api(action, params) {
  const res = await fetch(CFG.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, params: params || {}, session: S.session }),
  });
  const json = await res.json();
  if (!json.ok && action !== 'login') {
    if (json.error === 'unauthenticated') signOut('ログインの有効期限が切れました。もう一度ログインしてください。');
    if (json.error === 'forbidden' && action === 'me') signOut('このアカウントは登録されていません。');
  }
  if (!json.ok) {
    throw new Error(json.error);
  }
  return json.data;
}

const ERRORS = {
  reason_required: '修正する理由を書いてください',
  bad_amount: '金額を正しく入れてください',
  bad_date: '日付を正しく入れてください',
  no_change: '変更がありません',
  forbidden: 'この操作はできません',
};
function fail(err) {
  toast(ERRORS[err.message] || '通信に失敗しました。もう一度試してください');
}

async function load(month) {
  S.month = month || S.month;
  S.loading = true;
  render();
  try {
    S.data = await api('month', { month: S.month });
  } catch (e) {
    fail(e);
  } finally {
    S.loading = false;
    render();
  }
}

async function start() {
  renderMessage('読み込み中…');
  try {
    S.user = await api('me');
  } catch (e) {
    // ログイン切れなどは api() がログイン画面に切り替える。それ以外は通信の失敗として案内する
    if (S.session) renderMessage('通信に失敗しました。電波の良いところで試してください。', true);
    return;
  }
  await load(thisMonth());
}

// ---------- 集計 ----------

function totals(d) {
  let income = 0;
  let expense = 0;
  const byCat = {};
  const marks = [0, 0, 0, 0];
  d.rows.forEach((t) => {
    marks[t.mark || 0]++;
    if (t.voided) return;
    if (t.type === 'income') income += t.amount;
    else {
      expense += t.amount;
      byCat[t.category] = (byCat[t.category] || 0) + t.amount;
    }
  });
  return { income: income, expense: expense, balance: d.opening + income - expense, byCat: byCat, marks: marks };
}

function donut(byCat, total) {
  const r = 54;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const arcs = Object.keys(byCat)
    .sort((a, b) => byCat[b] - byCat[a])
    .map((k) => {
      const len = (byCat[k] / total) * c;
      const s = '<circle cx="70" cy="70" r="54" stroke="' + (CAT_COLORS[k] || '#999') + '" stroke-dasharray="' + len.toFixed(1) + ' ' + c.toFixed(1) + '" stroke-dashoffset="' + (-offset).toFixed(1) + '"/>';
      offset += len;
      return s;
    })
    .join('');
  return (
    '<svg width="128" height="128" viewBox="0 0 140 140" role="img" aria-label="今月の支出の内訳">' +
    '<circle cx="70" cy="70" r="54" fill="none" stroke="#EEF1EF" stroke-width="22"/>' +
    '<g transform="rotate(-90 70 70)" fill="none" stroke-width="22">' + arcs + '</g>' +
    '<text x="70" y="66" text-anchor="middle" font-size="12" fill="#55625D">支出</text>' +
    '<text x="70" y="86" text-anchor="middle" font-size="18" font-weight="700" fill="#17211E">' + yen(total) + '</text></svg>'
  );
}

// ---------- 画面 ----------

function route() {
  const parts = (location.hash || '#/home').slice(2).split('/');
  return { name: parts[0] || 'home', id: parts[1] };
}

function nav(current) {
  const parent = S.user && S.user.role === 'parent';
  const items = parent
    ? [['home', 'ホーム', 'home'], ['history', '履歴', 'list'], ['check', 'チェック', 'eye']]
    : [['home', 'ホーム', 'home'], ['input', '入力', 'plus'], ['history', '履歴', 'list']];
  return (
    '<nav class="nav" aria-label="メニュー"><div class="nav-inner">' +
    items
      .map((it) => '<a href="#/' + it[0] + '" class="' + (it[0] === 'check' ? 'parent' : '') + '"' + (current === it[0] ? ' aria-current="page"' : '') + '>' + icon(it[2]) + it[1] + '</a>')
      .join('') +
    '</div></nav>'
  );
}

function monthSwitcher() {
  const next = shiftMonth(S.month, 1);
  return (
    '<div class="row" style="gap:4px">' +
    '<button class="btn ghost" style="min-height:36px;padding:0 10px" data-act="month" data-m="' + shiftMonth(S.month, -1) + '" aria-label="前の月">‹</button>' +
    '<strong style="font-size:14px;min-width:84px;text-align:center">' + monthLabel(S.month) + '</strong>' +
    '<button class="btn ghost" style="min-height:36px;padding:0 10px" data-act="month" data-m="' + next + '" aria-label="次の月"' + (next > thisMonth() ? ' disabled' : '') + '>›</button>' +
    '</div>'
  );
}

function itemRow(t, opts) {
  const o = opts || {};
  const sign = t.type === 'income' ? '+' : '−';
  const meta =
    '<span>' + h(t.category) + '</span>' +
    (t.voided ? '<span class="pill plain">取り消し</span>' : '') +
    (t.edited ? '<span class="pill edited">修正あり</span>' : '') +
    (t.needsCheck ? '<span class="pill need">要確認</span>' : '') +
    markPill(t.mark || 0);
  const inner =
    '<span class="date">' + md(t.date) + '</span>' +
    '<span class="body"><span class="name"' + (t.voided ? ' style="text-decoration:line-through;color:var(--sub)"' : '') + '>' + h(t.name || t.category) + '</span><span class="meta">' + meta + '</span></span>' +
    '<span class="amt' + (t.type === 'income' ? ' in' : '') + '"' + (t.voided ? ' style="text-decoration:line-through;color:var(--sub)"' : '') + '>' + sign + yen(t.amount) + '</span>';
  if (o.markButton) {
    const m = t.mark || 0;
    return (
      '<div class="item">' + inner +
      '<button class="markbtn m' + m + '" data-act="mark" data-id="' + h(t.id) + '" data-mark="' + m + '" aria-label="' + MARKS[m].label + '（押すと切り替え）">' +
      (m === 1 ? icon('check', 20) : m === 2 ? icon('eye', 22) : m === 3 ? icon('stop', 22) : '') +
      '</button></div>'
    );
  }
  return '<a class="item" href="#/edit/' + h(t.id) + '">' + inner + '</a>';
}

function viewHome() {
  const d = S.data;
  const t = totals(d);
  const isCurrent = S.month === thisMonth();
  const watch = d.lastParentCheck
    ? '<div class="watch">' + icon('eye', 22) +
      '<div style="flex:1;display:flex;flex-direction:column;gap:6px"><span><strong>保護者がチェックしました</strong>　' + timeLabel(d.lastParentCheck) + '</span>' +
      '<span class="chips">' +
      (t.marks[1] ? '<span class="pill check">✓ 見たよ ' + t.marks[1] + '</span>' : '') +
      (t.marks[2] ? '<span class="pill eye">注目中 ' + t.marks[2] + '</span>' : '') +
      (t.marks[3] ? '<a class="pill stop" href="#/history" style="text-decoration:none">ストップ ' + t.marks[3] + ' →</a>' : '') +
      (t.marks[0] ? '<span class="pill plain">未チェック ' + t.marks[0] + '</span>' : '') +
      '</span></div></div>'
    : '';
  const cats = Object.keys(t.byCat).sort((a, b) => t.byCat[b] - t.byCat[a]);
  const recent = d.rows.slice(0, 3);
  return (
    '<main class="main">' +
    '<div class="spread"><div><div class="eyebrow">' + monthLabel(S.month) + 'のおこづかい帳</div><h1>' + (S.user.role === 'parent' ? '保護者ビュー' : 'おかえり！') + '</h1></div>' +
    (isCurrent ? '' : '<button class="btn ghost" style="min-height:36px" data-act="month" data-m="' + thisMonth() + '">今月へ</button>') + '</div>' +
    '<section class="balance"><span style="font-size:13px;opacity:.85">' + (isCurrent ? 'いまの残高（記録上）' : '月末の残高（記録上）') + '</span>' +
    '<span class="big">' + yen(t.balance) + '</span>' +
    '<div class="stats"><span>収入 <strong>' + yen(t.income) + '</strong></span><span>支出 <strong>' + yen(t.expense) + '</strong></span><span>繰越 <strong>' + yen(d.opening) + '</strong></span></div></section>' +
    watch +
    (t.expense
      ? '<section class="card"><h2>何に使った？</h2><div class="donut-wrap">' + donut(t.byCat, t.expense) +
        '<div class="legend">' + cats.map((k) => '<div class="row" style="gap:8px"><span class="sw" style="background:' + (CAT_COLORS[k] || '#999') + '"></span><span style="flex:1">' + h(k) + '</span><strong>' + yen(t.byCat[k]) + '</strong></div>').join('') + '</div></div></section>'
      : '') +
    '<section class="list"><div class="spread" style="padding:12px 0 4px"><h2 style="margin:0;font-size:15px">最近の記録</h2><a href="#/history" style="font-size:13px;font-weight:700;text-decoration:none">すべて見る</a></div>' +
    (recent.length ? recent.map((x) => itemRow(x)).join('') : '<div class="empty">まだ記録がありません</div>') + '</section>' +
    (S.user.role === 'child' ? '<a class="btn block" href="#/input" style="min-height:56px;font-size:16px">＋ 記録する</a>' : '<a class="btn parent block" href="#/check">収支明細をチェック</a>') +
    '</main>'
  );
}

function viewInput() {
  const d = S.data;
  const cats = S.inputType === 'income' ? d.categories.income : d.categories.expense;
  if (cats.indexOf(S.inputCat) < 0) S.inputCat = cats[0];
  return (
    '<main class="main"><h1>記録する</h1>' +
    '<div class="seg"><button data-act="type" data-v="expense" aria-pressed="' + (S.inputType === 'expense') + '">使った（支出）</button><button data-act="type" data-v="income" aria-pressed="' + (S.inputType === 'income') + '">もらった（収入）</button></div>' +
    (S.inputType === 'expense'
      ? '<section style="display:flex;flex-direction:column;gap:10px"><div class="spread"><h2 style="margin:0;font-size:15px">ワンタップで記録</h2><a href="#/presets" style="font-size:13px;font-weight:700;text-decoration:none">ボタンを編集</a></div>' +
        '<div class="presets">' + d.presets.map((p) => '<button class="preset" data-act="preset" data-id="' + h(p.id) + '"><strong>' + h(p.label) + '</strong><span>' + h(p.category) + ' ・ ' + yen(p.amount) + '</span></button>').join('') + '</div></section>'
      : '') +
    '<form class="card" data-form="add"><h2>手で入力</h2>' +
    '<label class="field">金額<input name="amount" type="number" inputmode="numeric" min="1" placeholder="0" required></label>' +
    '<div class="chips">' + cats.map((c) => '<button type="button" class="cat" data-act="cat" data-v="' + h(c) + '" aria-pressed="' + (c === S.inputCat) + '">' + h(c) + '</button>').join('') + '</div>' +
    '<label class="field">内容（お店・買ったもの）<input name="name" type="text" maxlength="50" placeholder="例：ローソンでおにぎり"></label>' +
    '<label class="field">日付<input name="date" type="date" value="' + today() + '" max="' + today() + '" required></label>' +
    '<button class="btn block" type="submit">記録する</button></form>' +
    '</main>'
  );
}

function viewHistory() {
  const d = S.data;
  const rows = d.rows.filter((t) => S.filter === 'all' || (S.filter === 'marked' ? t.mark >= 2 : t.type === S.filter));
  const chip = (v, label) => '<button class="cat" data-act="filter" data-v="' + v + '" aria-pressed="' + (S.filter === v) + '">' + label + '</button>';
  return (
    '<main class="main"><div class="spread"><h1>履歴</h1>' + monthSwitcher() + '</div>' +
    '<div class="chips">' + chip('all', 'すべて') + chip('expense', '支出') + chip('income', '収入') + chip('marked', '注目・ストップ') + '</div>' +
    '<section class="card small" style="gap:6px;line-height:1.5"><strong style="font-size:13px">保護者のマーク</strong>' +
    '<span class="row" style="gap:8px">' + markPill(1) + '保護者が確認した記録</span>' +
    '<span class="row" style="gap:8px">' + markPill(2) + '保護者が気にしている記録</span>' +
    '<span class="row" style="gap:8px">' + markPill(3) + '話し合いが必要。終わるまで締められない</span></section>' +
    '<section class="list">' + (rows.length ? rows.map((t) => itemRow(t)).join('') : '<div class="empty">記録がありません</div>') + '</section>' +
    '<p class="muted" style="text-align:center;margin:0">記録をタップすると修正できます（理由の入力が必要です）</p>' +
    '</main>'
  );
}

function viewEdit(id) {
  const d = S.data;
  const t = d.rows.filter((x) => x.id === id)[0];
  if (!t) return '<main class="main"><a class="back" href="#/history">' + icon('back') + '</a><p class="empty">記録が見つかりません</p></main>';
  const cats = t.type === 'income' ? d.categories.income : d.categories.expense;
  const log = d.edits.filter((e) => e.txId === id);
  return (
    '<main class="main"><div class="row"><a class="back" href="#/history" aria-label="履歴に戻る">' + icon('back') + '</a><h1 style="font-size:20px">記録を修正</h1></div>' +
    '<section class="card"><span class="muted small">いまの記録</span><div class="spread"><span>' + md(t.date) + ' ' + h(t.name || t.category) + ' ・ ' + h(t.category) + '</span><strong>' + yen(t.amount) + '</strong></div>' +
    (t.mark ? '<div>' + markPill(t.mark) + '</div>' : '') + '</section>' +
    '<form class="card" data-form="edit" data-id="' + h(t.id) + '">' +
    '<label class="field">正しい金額<input name="amount" type="number" inputmode="numeric" min="1" value="' + t.amount + '" required></label>' +
    '<label class="field">分類<select name="category">' + cats.map((c) => '<option' + (c === t.category ? ' selected' : '') + '>' + h(c) + '</option>').join('') + '</select></label>' +
    '<label class="field">内容<input name="name" type="text" maxlength="50" value="' + h(t.name) + '"></label>' +
    '<label class="field">日付<input name="date" type="date" value="' + h(t.date) + '" max="' + today() + '" required></label>' +
    '<label class="row small" style="gap:8px;min-height:44px"><input name="voided" type="checkbox"' + (t.voided ? ' checked' : '') + ' style="width:22px;height:22px">この記録を取り消す（二重に記録したときなど）</label>' +
    '<label class="field required">修正する理由（必須）<textarea name="reason" rows="3" required></textarea></label>' +
    '<div class="notice">修正前の記録と理由は「変更履歴」に残り、保護者も見られます。記録を消すことはできません。</div>' +
    '<button class="btn block" type="submit">修正を保存</button></form>' +
    (log.length
      ? '<section class="card"><h2>この記録の変更履歴</h2>' + log.map(editLogItem).join('') + '</section>'
      : '') +
    '</main>'
  );
}

function editLogItem(e) {
  let b = {};
  let a = {};
  try {
    b = JSON.parse(e.before);
    a = JSON.parse(e.after);
  } catch (err) {}
  const names = { amount: '金額', category: '分類', name: '内容', date: '日付', voided: '取り消し', type: '種類', memo: 'メモ' };
  const fmt = (k, v) => (k === 'amount' ? yen(v) : k === 'voided' ? (v === true || v === 'true' ? 'あり' : 'なし') : v);
  return (
    '<div style="display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:12px;background:#F6F7FB;font-size:13px">' +
    '<span class="muted small">' + timeLabel(e.editedAt) + ' に修正（' + (e.editor === 'parent' ? '保護者' : '本人') + '）</span>' +
    Object.keys(a).map((k) => '<span>' + names[k] + ' <s style="color:var(--sub)">' + h(fmt(k, b[k])) + '</s> → <strong>' + h(fmt(k, a[k])) + '</strong></span>').join('') +
    '<span style="color:#3B3BA8">理由：' + h(e.reason) + '</span></div>'
  );
}

function viewCheck() {
  const d = S.data;
  const unseen = d.rows.filter((t) => !t.mark).length;
  const rows = d.rows.filter((t) => S.filter !== 'unseen' || !t.mark);
  const chip = (v, label) => '<button class="cat" data-act="filter" data-v="' + v + '" aria-pressed="' + (S.filter === v) + '">' + label + '</button>';
  return (
    '<main class="main"><div class="spread"><div><div class="eyebrow" style="color:var(--parent)">保護者用</div><h1>収支明細</h1></div>' + monthSwitcher() + '</div>' +
    '<div class="spread" style="padding:12px 14px;border-radius:16px;background:' + (unseen ? 'var(--parent);color:#fff' : 'var(--accent-soft);color:var(--accent)') + '">' +
    '<strong style="font-size:14px">' + (unseen ? '未チェック ' + unseen + '件' : 'すべてチェック済み') + '</strong>' +
    (unseen ? '<button class="btn ghost" style="min-height:40px;color:var(--parent)" data-act="markAll">まとめて見たよ</button>' : '') + '</div>' +
    '<div class="muted small">ボタンを押すたびに　未チェック → ✓見たよ → 注目中 → ストップ → 未チェック</div>' +
    '<div class="chips">' + chip('all', 'すべて') + chip('unseen', '未チェックだけ') + '</div>' +
    '<section class="list">' + (rows.length ? rows.map((t) => itemRow(t, { markButton: true })).join('') : '<div class="empty">記録がありません</div>') + '</section>' +
    (d.edits.length ? '<section class="card"><h2>変更履歴</h2>' + d.edits.slice().reverse().map(editLogItem).join('') + '</section>' : '') +
    '</main>'
  );
}

function viewPresets() {
  if (!S.presetDraft) S.presetDraft = S.data.presets.map((p) => Object.assign({}, p));
  const cats = S.data.categories.expense;
  return (
    '<main class="main"><div class="row"><a class="back" href="#/input" aria-label="入力に戻る">' + icon('back') + '</a><h1 style="font-size:20px">ワンタップのボタン</h1></div>' +
    '<form class="card" data-form="presets">' +
    S.presetDraft.map((p, i) =>
      '<div style="display:grid;grid-template-columns:1fr 84px;gap:8px;padding-bottom:12px;border-bottom:1px solid var(--soft)">' +
      '<label class="field">名前<input name="label' + i + '" value="' + h(p.label) + '" maxlength="30"></label>' +
      '<label class="field">金額<input name="amount' + i + '" type="number" min="1" value="' + h(p.amount) + '"></label>' +
      '<label class="field">分類<select name="category' + i + '">' + cats.map((c) => '<option' + (c === p.category ? ' selected' : '') + '>' + h(c) + '</option>').join('') + '</select></label>' +
      '<button type="button" class="btn ghost" style="align-self:end" data-act="presetRemove" data-i="' + i + '">削除</button></div>'
    ).join('') +
    '<button type="button" class="btn ghost block" data-act="presetAdd">＋ ボタンを追加</button>' +
    '<button type="submit" class="btn block">保存</button></form></main>'
  );
}

function render() {
  if (!S.user) return;
  const r = route();
  if (!S.data) {
    app.innerHTML = '<main class="main"><p class="empty">読み込み中…</p></main>';
    return;
  }
  const parent = S.user.role === 'parent';
  document.body.classList.toggle('parent-mode', parent && r.name === 'check');
  const views = {
    home: viewHome,
    input: parent ? viewHome : viewInput,
    history: viewHistory,
    edit: () => viewEdit(r.id),
    check: parent ? viewCheck : viewHome,
    presets: parent ? viewHome : viewPresets,
  };
  const navName = r.name === 'edit' ? 'history' : r.name === 'presets' ? 'input' : r.name;
  app.innerHTML = (views[r.name] || viewHome)() + nav(navName);
}

// ---------- 操作 ----------

function readPresetForm(form) {
  return S.presetDraft.map((p, i) => ({
    id: p.id,
    label: form.elements['label' + i].value,
    amount: form.elements['amount' + i].value,
    category: form.elements['category' + i].value,
  }));
}

app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'retry') return start();
  if (act === 'month') return load(el.dataset.m);
  if (act === 'type') {
    S.inputType = el.dataset.v;
    return render();
  }
  if (act === 'cat') {
    S.inputCat = el.dataset.v;
    el.parentNode.querySelectorAll('.cat').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
    return;
  }
  if (act === 'filter') {
    S.filter = el.dataset.v;
    return render();
  }
  if (act === 'preset') {
    const p = S.data.presets.filter((x) => x.id === el.dataset.id)[0];
    el.disabled = true;
    try {
      await api('add', { type: 'expense', category: p.category, name: p.label, amount: p.amount, date: today(), source: 'preset' });
      toast(p.label + ' ' + yen(p.amount) + ' を記録しました');
      await load(thisMonth());
    } catch (err) {
      fail(err);
      el.disabled = false;
    }
    return;
  }
  if (act === 'mark') {
    const next = (Number(el.dataset.mark) + 1) % 4;
    const t = S.data.rows.filter((x) => x.id === el.dataset.id)[0];
    t.mark = next; // 押した感触を優先して先に反映する
    S.data.lastParentCheck = Date.now();
    render();
    try {
      await api('mark', { id: t.id, mark: next });
    } catch (err) {
      fail(err);
      load();
    }
    return;
  }
  if (act === 'markAll') {
    try {
      const r = await api('markAllSeen', { month: S.month });
      toast(r.count + '件を「見たよ」にしました');
      load();
    } catch (err) {
      fail(err);
    }
    return;
  }
  if (act === 'presetAdd' || act === 'presetRemove') {
    S.presetDraft = readPresetForm(el.closest('form'));
    if (act === 'presetAdd') S.presetDraft.push({ label: '', amount: '', category: '食べ物' });
    else S.presetDraft.splice(Number(el.dataset.i), 1);
    return render();
  }
});

app.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const btn = form.querySelector('[type="submit"]');
  btn.disabled = true;
  const f = form.elements;
  try {
    if (form.dataset.form === 'add') {
      await api('add', { type: S.inputType, category: S.inputCat, name: f.name.value, amount: f.amount.value, date: f.date.value });
      toast(yen(f.amount.value) + ' を記録しました');
      form.reset();
      await load(f.date.value.slice(0, 7));
    } else if (form.dataset.form === 'edit') {
      await api('edit', {
        id: form.dataset.id,
        reason: f.reason.value,
        changes: { amount: f.amount.value, category: f.category.value, name: f.name.value, date: f.date.value, voided: f.voided.checked },
      });
      toast('修正を保存しました');
      location.hash = '#/history';
      await load();
    } else if (form.dataset.form === 'presets') {
      await api('savePresets', { presets: readPresetForm(form) });
      S.presetDraft = null;
      toast('ボタンを保存しました');
      location.hash = '#/input';
      await load();
    }
  } catch (err) {
    fail(err);
  } finally {
    btn.disabled = false;
  }
});

window.addEventListener('hashchange', () => {
  if (route().name !== 'presets') S.presetDraft = null;
  S.filter = 'all';
  render();
  window.scrollTo(0, 0);
});

// iPhone はビューポートの指定だけではピンチ操作の拡大を止められないため
document.addEventListener('gesturestart', (e) => e.preventDefault());

// ---------- 起動 ----------

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

(function boot() {
  storage((ls) => ls.removeItem('okozukai.idToken')); // 以前の版の保存値
  const saved = storage((ls) => ls.getItem(SESSION_KEY));
  if (saved) {
    S.session = saved;
    start();
  } else {
    renderMessage('読み込み中…');
  }
  initGoogle();
})();
