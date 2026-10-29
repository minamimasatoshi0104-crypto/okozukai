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
  failedMonth: null,
  archive: null,
  closeCash: null,
  reportBlob: null,
  receiptDraft: null,
  reading: false,
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
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  flag: '<path d="M5 21V4h11l-1.5 4L16 12H5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
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
    // 原因を調べられるよう、失敗の理由を添える
    if (!S.user) renderLogin(e.message === 'forbidden' ? 'このアカウントは登録されていません。' : 'ログインできませんでした。もう一度試してください。（' + e.message + '）');
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
  month_locked: 'この月は締めて提出済みのため、記録を変えられません',
  not_yet: 'まだ締めの期間ではありません',
  has_stop: 'ストップのマークがあるので、まだ締められません',
  not_matched: '手元の現金と記録が合っていません',
  already_closed: 'この月はもう提出済みです',
  comment_required: '今月のひとことを書いてください',
  not_submitted: 'この月の報告は、承認や差し戻しができる状態ではありません',
  bad_allowance: 'おこづかいの金額を正しく入れてください',
  bad_image: '写真を読み込めませんでした。もう一度撮ってください',
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
    S.failedMonth = null;
  } catch (e) {
    S.failedMonth = S.month;
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

// ---------- 月末の締め ----------

function lastDay(m) {
  const [y, mo] = m.split('-').map(Number);
  return m + '-' + String(new Date(y, mo, 0).getDate()).padStart(2, '0');
}
function deadline(m) {
  return shiftMonth(m, 1) + '-03';
}
function closeOf(m) {
  return (S.data.closes || []).filter((c) => c.month === m)[0] || null;
}
// 提出済み・承認済みの月は、差し戻されるまで記録を変えられない
function isLocked(m) {
  const c = closeOf(m);
  return !!c && c.status !== 'returned';
}
// open（集計中）/ due（締めの期間）/ returned / overdue（要相談）/ submitted / approved
function closeState(m, c) {
  if (c && c.status === 'approved') return 'approved';
  if (c && c.status === 'submitted') return 'submitted';
  const t = today();
  if (t < lastDay(m)) return 'open';
  if (t <= deadline(m)) return c ? 'returned' : 'due';
  return 'overdue';
}
const CLOSE_LABEL = {
  open: ['集計中', 'plain'],
  due: ['締めの期間', 'need'],
  returned: ['差し戻し', 'need'],
  overdue: ['要相談', 'stop'],
  submitted: ['承認待ち', 'check'],
  approved: ['承認済み', 'ok'],
};
function closePill(state) {
  return '<span class="pill ' + CLOSE_LABEL[state][1] + '">' + CLOSE_LABEL[state][0] + '</span>';
}
// 締めた後に使ったお金は、翌月1日の日付で記録する
function inputDate() {
  return isLocked(thisMonth()) ? shiftMonth(thisMonth(), 1) + '-01' : today();
}

// 表示に必要な月のデータがなければ読み込む（読み込み中は false）
function ensureMonth(m) {
  if (S.data && S.data.month === m) return true;
  if (!S.loading && S.failedMonth !== m) load(m);
  return false;
}

// ---------- 画面 ----------

function route() {
  const parts = (location.hash || '#/home').slice(2).split('/');
  return { name: parts[0] || 'home', id: parts[1] };
}

function nav(current) {
  const parent = S.user && S.user.role === 'parent';
  const items = parent
    ? [['home', 'ホーム', 'home'], ['history', '履歴', 'list'], ['check', 'チェック', 'eye'], ['archive', '振り返り', 'chart']]
    : [['home', 'ホーム', 'home'], ['input', '入力', 'plus'], ['history', '履歴', 'list'], ['archive', '振り返り', 'chart']];
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
    (t.source === 'receipt' ? '<span class="pill plain">レシート</span>' : '') +
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
    closeBanners() +
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

function closeBanners() {
  const d = S.data;
  const cur = thisMonth();
  const prev = shiftMonth(cur, -1);
  const banner = (cls, href, text) => '<a class="banner ' + cls + '" href="' + href + '">' + icon('flag', 20) + '<span style="flex:1">' + text + '</span><span aria-hidden="true">›</span></a>';
  const out = [];
  if (S.user.role === 'parent') {
    (d.closes || []).filter((c) => c.status === 'submitted').forEach((c) => out.push(banner('parent', '#/report/' + c.month, '<strong>' + monthLabel(c.month) + 'の報告が届いています</strong>')));
    if (d.firstMonth && prev >= d.firstMonth && closeState(prev, closeOf(prev)) === 'overdue') out.push(banner('stop', '#/archive', monthLabel(prev) + 'の締めがまだです（要相談）'));
    return out.join('');
  }
  [prev, cur].forEach((m) => {
    if (!d.firstMonth || m < d.firstMonth) return;
    const state = closeState(m, closeOf(m));
    const by = Number(deadline(m).slice(5, 7)) + '/3まで';
    if (state === 'due') out.push(banner('warn', '#/close/' + m, '<strong>' + monthLabel(m) + 'の締めをしよう</strong>（' + by + '）'));
    if (state === 'returned') out.push(banner('warn', '#/close/' + m, '<strong>' + monthLabel(m) + 'の報告が差し戻されました</strong>（' + by + '）'));
    if (state === 'overdue') out.push(banner('stop', '#/close/' + m, '<strong>' + monthLabel(m) + 'の締めが期限切れです</strong>（要相談）'));
    if (state === 'submitted') out.push(banner('parent', '#/report/' + m, monthLabel(m) + 'の報告は承認待ちです'));
  });
  return out.join('');
}

function viewInput() {
  const d = S.data;
  const r = S.receiptDraft;
  if (r) S.inputType = 'expense';
  const cats = S.inputType === 'income' ? d.categories.income : d.categories.expense;
  if (cats.indexOf(S.inputCat) < 0) S.inputCat = cats[0];
  // レシートの日付が読めない・未来・締めた月のときは、ふだんの日付にする
  const rDate = r && r.date && r.date <= today() && !isLocked(r.date.slice(0, 7)) ? r.date : inputDate();
  return (
    '<main class="main"><h1>記録する</h1>' +
    '<div class="seg"><button data-act="type" data-v="expense" aria-pressed="' + (S.inputType === 'expense') + '">使った（支出）</button><button data-act="type" data-v="income" aria-pressed="' + (S.inputType === 'income') + '">もらった（収入）</button></div>' +
    (S.inputType === 'expense'
      ? '<label class="btn ghost block" style="min-height:56px"' + (S.reading ? ' aria-disabled="true"' : '') + '>' + icon('camera') + (S.reading ? 'AI が読み取り中…' : 'レシートを撮って記録') +
        '<input type="file" accept="image/*" capture="environment" data-receipt class="visually-hidden"' + (S.reading ? ' disabled' : '') + '></label>'
      : '') +
    (S.inputType === 'expense' && !r
      ? '<section style="display:flex;flex-direction:column;gap:10px"><div class="spread"><h2 style="margin:0;font-size:15px">ワンタップで記録</h2><a href="#/presets" style="font-size:13px;font-weight:700;text-decoration:none">ボタンを編集</a></div>' +
        '<div class="presets">' + d.presets.map((p) => '<button class="preset" data-act="preset" data-id="' + h(p.id) + '"><strong>' + h(p.label) + '</strong><span>' + h(p.category) + ' ・ ' + yen(p.amount) + '</span></button>').join('') + '</div></section>'
      : '') +
    '<form class="card" data-form="add"><h2>' + (r ? 'レシートの内容を確かめて記録' : '手で入力') + '</h2>' +
    (r ? '<div class="notice">' + (r.aiFailed ? 'AI が読み取れませんでした。写真は保存したので、内容を手で入れてください。' : 'AI が読み取った内容です。レシートと見比べて、違うところは直してから記録してください。') + '</div>' : '') +
    '<label class="field">金額<input name="amount" type="number" inputmode="numeric" min="1" placeholder="0" required' + (r && r.amount ? ' value="' + r.amount + '"' : '') + '></label>' +
    '<div class="chips">' + cats.map((c) => '<button type="button" class="cat" data-act="cat" data-v="' + h(c) + '" aria-pressed="' + (c === S.inputCat) + '">' + h(c) + '</button>').join('') + '</div>' +
    '<label class="field">内容（お店・買ったもの）<input name="name" type="text" maxlength="50" placeholder="例：ローソンでおにぎり"' + (r ? ' value="' + h(r.store) + '"' : '') + '></label>' +
    '<label class="field">日付<input name="date" type="date" value="' + (r ? rDate : inputDate()) + '" max="' + (r ? (rDate > inputDate() ? rDate : inputDate()) : inputDate()) + '" required></label>' +
    (isLocked(thisMonth()) ? '<div class="notice">今月は締めて提出済みです。今日使ったお金は、来月1日の日付で記録します。</div>' : '') +
    '<button class="btn block" type="submit">記録する</button>' +
    (r ? '<button class="btn ghost block" type="button" data-act="receiptCancel">やめる</button>' : '') + '</form>' +
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
    (t.mark ? '<div>' + markPill(t.mark) + '</div>' : '') +
    (t.receiptUrl && S.user.role === 'parent' ? '<a href="' + h(t.receiptUrl) + '" target="_blank" rel="noopener">レシートの写真を見る</a>' : '') + '</section>' +
    (isLocked(t.date.slice(0, 7))
      ? '<div class="notice">この月は締めて提出済みのため、修正できません。直したいときは、保護者に差し戻してもらってください。</div>'
      : editForm(t, cats)) +
    (log.length
      ? '<section class="card"><h2>この記録の変更履歴</h2>' + log.map(editLogItem).join('') + '</section>'
      : '') +
    '</main>'
  );
}

function editForm(t, cats) {
  return (
    '<form class="card" data-form="edit" data-id="' + h(t.id) + '">' +
    '<label class="field">正しい金額<input name="amount" type="number" inputmode="numeric" min="1" value="' + t.amount + '" required></label>' +
    '<label class="field">分類<select name="category">' + cats.map((c) => '<option' + (c === t.category ? ' selected' : '') + '>' + h(c) + '</option>').join('') + '</select></label>' +
    '<label class="field">内容<input name="name" type="text" maxlength="50" value="' + h(t.name) + '"></label>' +
    '<label class="field">日付<input name="date" type="date" value="' + h(t.date) + '" max="' + today() + '" required></label>' +
    '<label class="row small" style="gap:8px;min-height:44px"><input name="voided" type="checkbox"' + (t.voided ? ' checked' : '') + ' style="width:22px;height:22px">この記録を取り消す（二重に記録したときなど）</label>' +
    '<label class="field required">修正する理由（必須）<textarea name="reason" rows="3" required></textarea></label>' +
    '<div class="notice">修正前の記録と理由は「変更履歴」に残り、保護者も見られます。記録を消すことはできません。</div>' +
    '<button class="btn block" type="submit">修正を保存</button></form>'
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

function viewClose(m) {
  const d = S.data;
  const c = closeOf(m);
  const state = closeState(m, c);
  const t = totals(d);
  const head = '<div class="row"><a class="back" href="#/home" aria-label="ホームに戻る">' + icon('back') + '</a><h1 style="font-size:20px">' + monthLabel(m) + 'の締め</h1></div>';
  if (state === 'submitted' || state === 'approved') {
    return '<main class="main">' + head + '<div class="notice">この月はもう提出しました。</div><a class="btn block" href="#/report/' + m + '">報告カードを見る</a></main>';
  }
  if (state === 'open') {
    return '<main class="main">' + head + '<div class="notice">締めは、' + md(lastDay(m)) + '（月末）から ' + md(deadline(m)) + ' までにします。</div></main>';
  }
  let body = '';
  if (c && c.returnReason) body += '<div class="banner warn" style="flex-direction:column;align-items:flex-start"><strong>保護者から差し戻されました</strong><span>' + h(c.returnReason) + '</span></div>';
  if (state === 'overdue') body += '<div class="banner stop">期限（' + md(deadline(m)) + '）を過ぎています。提出したあと、おこづかいは保護者と相談して決めます。</div>';
  if (t.marks[3]) {
    return '<main class="main">' + head + body +
      '<section class="card"><h2>' + markPill(3) + ' ストップが ' + t.marks[3] + ' 件あります</h2>' +
      '<p class="muted" style="margin:0">保護者と話して、ストップを外してもらうまで締められません。</p>' +
      '<a class="btn ghost block" href="#/history">履歴で確かめる</a></section></main>';
  }
  if (S.closeCash === null) {
    body +=
      '<form class="card" data-form="cash"><h2>① 手元の現金を数えよう</h2>' +
      '<p class="muted" style="margin:0">財布や貯金箱など、いま持っている現金を全部数えて入れてください。</p>' +
      '<label class="field">手元の現金<input name="cash" type="number" inputmode="numeric" min="0" required></label>' +
      '<button class="btn block" type="submit">記録と比べる</button></form>';
    return '<main class="main">' + head + body + '</main>';
  }
  const diff = S.closeCash - t.balance;
  body +=
    '<section class="card"><h2>① 手元の現金と記録</h2>' +
    '<div class="spread"><span>手元の現金</span><strong>' + yen(S.closeCash) + '</strong></div>' +
    '<div class="spread"><span>記録上の残高</span><strong>' + yen(t.balance) + '</strong></div>' +
    '<div class="spread" style="color:' + (diff ? 'var(--warn)' : 'var(--accent)') + '"><strong>' + (diff ? '差額' : 'ぴったり！') + '</strong><strong>' + (diff ? (diff > 0 ? '+' : '−') + yen(Math.abs(diff)) : '✓') + '</strong></div>' +
    '<button class="btn ghost" data-act="recount">数え直す</button></section>';
  if (diff) {
    const short = diff < 0;
    body +=
      '<form class="card" data-form="diff" data-month="' + m + '" data-type="' + (short ? 'expense' : 'income') + '" data-amount="' + Math.abs(diff) + '">' +
      '<h2>② 差額を記録して合わせよう</h2>' +
      '<p class="muted" style="margin:0">' + (short
        ? '記録より ' + yen(-diff) + ' 少ないです。思い出せたら、先に「入力」から正しく記録してください。思い出せない分は「使途不明」として記録します。'
        : '記録より ' + yen(diff) + ' 多いです。記録していない収入があるはずです。分類を選んで記録します。') + '</p>' +
      (short ? '' : '<label class="field">分類<select name="category">' + d.categories.income.filter((x) => x !== 'おこづかい').map((x) => '<option' + (x === 'その他収入' ? ' selected' : '') + '>' + h(x) + '</option>').join('') + '</select></label>') +
      '<label class="field required">理由（必須）<textarea name="reason" rows="2" required placeholder="' + (short ? '例：コンビニで買ったけどレシートがない' : '例：おじいちゃんからもらった') + '"></textarea></label>' +
      '<button class="btn block" type="submit">' + yen(Math.abs(diff)) + ' を' + (short ? '使途不明' : '収入') + 'として記録する</button></form>';
  } else {
    body +=
      '<form class="card" data-form="close" data-month="' + m + '"><h2>② 今月のひとこと</h2>' +
      '<label class="field required">ひとこと（必須）<input name="comment" type="text" maxlength="100" required placeholder="例：遊びに使いすぎたので来月は気をつける"></label>' +
      '<button class="btn block" type="submit">保護者に提出する</button></form>';
  }
  return '<main class="main">' + head + body + '</main>';
}

function aiReview(c) {
  try {
    const r = c && c.aiReview ? JSON.parse(c.aiReview) : null;
    return r && r.good ? r : null;
  } catch (e) {
    return null;
  }
}

function aiReviewCard(c) {
  const r = aiReview(c);
  if (!r) return '';
  return (
    '<section class="card" style="gap:8px"><h2>AI コーチから</h2>' +
    '<div class="small"><strong>よかった点</strong>　' + h(r.good) + '</div>' +
    '<div class="small"><strong>気をつけたい点</strong>　' + h(r.care) + '</div>' +
    '<div class="small"><strong>来月の目標</strong>　' + h(r.goal) + '</div></section>'
  );
}

function viewReport(m) {
  const c = closeOf(m);
  const back = '<div class="row"><a class="back" href="#/archive" aria-label="振り返りに戻る">' + icon('back') + '</a><h1 style="font-size:20px">' + monthLabel(m) + 'の報告</h1></div>';
  if (!c || c.status === 'returned') return '<main class="main">' + back + '<p class="empty">まだ提出されていません</p></main>';
  const state = closeState(m, c);
  const parent = S.user.role === 'parent';
  return (
    '<main class="main">' + back +
    '<div class="row">' + closePill(state) + (c.late ? '<span class="pill stop">期限後に提出</span>' : '') + '</div>' +
    '<img id="report-img" class="report-img" alt="' + monthLabel(m) + 'の報告カード">' +
    '<div class="presets"><button class="btn" data-act="share">' + (parent ? '共有・保存' : 'LINEで送る・保存') + '</button><button class="btn ghost" data-act="download">画像をダウンロード</button></div>' +
    aiReviewCard(c) +
    (parent && c.status === 'submitted'
      ? '<form class="card" data-form="approve" data-month="' + m + '"><h2>承認する</h2>' +
        '<label class="field">渡すおこづかい（円）<input name="allowance" type="number" inputmode="numeric" min="0" value="3000" required></label>' +
        '<label class="field">ひとこと（任意）<textarea name="comment" rows="2" maxlength="200"></textarea></label>' +
        '<p class="muted small" style="margin:0">承認すると、この金額が「おこづかい」の収入として記録されます（日付は今日。月末日に承認したときは翌月1日）。</p>' +
        '<button class="btn parent block" type="submit">承認する</button></form>' +
        '<form class="card" data-form="return" data-month="' + m + '"><h2>差し戻す</h2>' +
        '<label class="field required">理由（必須）<textarea name="reason" rows="2" required></textarea></label>' +
        '<button class="btn ghost block" type="submit">差し戻す</button></form>'
      : '') +
    '<a class="btn ghost block" href="#/history">この月の履歴を見る</a>' +
    '</main>'
  );
}

function viewArchive() {
  const a = S.archive;
  const months = a.months;
  if (!months.length) return '<main class="main"><h1>振り返り</h1><p class="empty">まだ記録がありません</p></main>';
  const chart = months.slice(0, 12).reverse();
  const max = Math.max(100, ...chart.map((x) => x.unknown));
  const bw = 300 / chart.length;
  const bars = chart.map((x, i) => {
    const hgt = Math.round((x.unknown / max) * 90);
    return '<rect x="' + (i * bw + bw * 0.2).toFixed(1) + '" y="' + (100 - hgt) + '" width="' + (bw * 0.6).toFixed(1) + '" height="' + Math.max(hgt, x.unknown ? 2 : 0) + '" rx="3" fill="#C2410C"><title>' + monthLabel(x.month) + ' ' + yen(x.unknown) + '</title></rect>' +
      '<text x="' + (i * bw + bw / 2).toFixed(1) + '" y="116" text-anchor="middle" font-size="10" fill="#55625D">' + Number(x.month.slice(5)) + '月</text>' +
      (x.unknown ? '<text x="' + (i * bw + bw / 2).toFixed(1) + '" y="' + (94 - hgt) + '" text-anchor="middle" font-size="10" fill="#9A3412">' + x.unknown.toLocaleString('ja-JP') + '</text>' : '');
  }).join('');
  const card = (x) => {
    const state = closeState(x.month, x.close);
    const c = x.close;
    const href = c && c.status !== 'returned' ? '#/report/' + x.month : S.user.role === 'child' && ['due', 'returned', 'overdue'].indexOf(state) >= 0 ? '#/close/' + x.month : '#/month/' + x.month;
    return (
      '<a class="card" href="' + href + '" style="text-decoration:none;color:inherit;gap:8px">' +
      '<div class="spread"><h2>' + monthLabel(x.month) + '</h2>' + closePill(state) + '</div>' +
      '<div class="spread small"><span>支出 <strong>' + yen(x.expense) + '</strong></span><span>月末残高 <strong>' + yen(x.balance) + '</strong></span><span style="color:' + (x.unknown ? 'var(--warn)' : 'var(--sub)') + '">使途不明 <strong>' + yen(x.unknown) + '</strong></span></div>' +
      (c && c.comment ? '<div class="small">本人：' + h(c.comment) + '</div>' : '') +
      (c && c.parentComment ? '<div class="small" style="color:var(--parent)">保護者：' + h(c.parentComment) + '</div>' : '') +
      (aiReview(c) ? '<div class="small muted">AI コーチ：' + h(aiReview(c).goal) + '</div>' : '') +
      (c && c.status === 'approved' ? '<div class="small muted">おこづかい ' + yen(c.allowance) + '</div>' : '') +
      '</a>'
    );
  };
  return (
    '<main class="main"><h1>振り返り</h1>' +
    '<section class="card"><h2>使途不明の推移</h2>' +
    '<svg viewBox="0 0 300 120" width="100%" role="img" aria-label="月ごとの使途不明の金額"><line x1="0" y1="100" x2="300" y2="100" stroke="#DDE3DF"/>' + bars + '</svg></section>' +
    months.map(card).join('') +
    '</main>'
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
  // 月を指定する画面は、その月のデータがそろってから描く
  if (['close', 'report', 'month'].indexOf(r.name) >= 0 && r.id) {
    if (!ensureMonth(r.id)) {
      app.innerHTML = '<main class="main"><p class="empty">' + (S.failedMonth === r.id ? '読み込めませんでした。<button class="btn ghost" data-act="retry">もう一度</button>' : '読み込み中…') + '</p></main>' + nav('home');
      return;
    }
    if (r.name === 'month') {
      location.replace('#/history');
      return;
    }
  }
  if (r.name === 'archive' && !S.archive) {
    loadArchive();
    app.innerHTML = '<main class="main"><h1>振り返り</h1><p class="empty">読み込み中…</p></main>' + nav('archive');
    return;
  }
  const views = {
    home: viewHome,
    input: parent ? viewHome : viewInput,
    history: viewHistory,
    edit: () => viewEdit(r.id),
    check: parent ? viewCheck : viewHome,
    presets: parent ? viewHome : viewPresets,
    close: parent ? viewHome : () => viewClose(r.id),
    report: () => viewReport(r.id),
    archive: viewArchive,
  };
  const navName = { edit: 'history', presets: 'input', close: 'home', report: 'archive' }[r.name] || r.name;
  app.innerHTML = (views[r.name] || viewHome)() + nav(navName);
  if (r.name === 'report') fillReport(r.id);
}

let archiveLoading = false;
async function loadArchive() {
  if (archiveLoading) return;
  archiveLoading = true;
  try {
    S.archive = await api('archive');
  } catch (e) {
    fail(e);
    S.archive = { months: [] };
  } finally {
    archiveLoading = false;
    render();
  }
}

// ---------- 報告カード（画像） ----------

const FONT_ROUND = "'M PLUS Rounded 1c', 'Hiragino Maru Gothic ProN', sans-serif";
const FONT_TEXT = "'Noto Sans JP', 'Hiragino Sans', sans-serif";

async function fillReport(m) {
  const c = closeOf(m);
  if (!c || c.status === 'returned') return;
  const d = S.data;
  S.reportBlob = null;
  // 画像に描く文字のフォントを先に読み込む（日本語フォントは文字ごとに分かれて配信されるため）
  const ai = aiReview(c);
  const sample = (ai ? 'AIコーチからよかった点気をつけたい点来月の目標' + ai.good + ai.care + ai.goal : '') + monthLabel(m) + 'おこづかい報告月末の残高繰越収入支出手元の現金使途不明何に使った保護者のチェック見たよ注目中ストップ未チェック今月のひとこと保護者からありなしぴったり承認待ち済み期限後に提出¥0123456789,+−' + c.comment + (c.parentComment || '') + Object.keys(totals(d).byCat).join('');
  if (document.fonts) {
    await Promise.all(['800 30px', '700 16px', '400 14px'].map((w, i) => document.fonts.load(w + ' ' + (i < 2 ? FONT_ROUND : FONT_TEXT), sample).catch(() => {})));
  }
  const canvas = drawReport(m, d, c);
  canvas.toBlob((blob) => {
    const img = document.getElementById('report-img');
    if (!img || route().id !== m) return;
    S.reportBlob = blob;
    img.src = URL.createObjectURL(blob);
  }, 'image/png');
}

function drawReport(m, d, c) {
  const W = 540;
  const SC = 2;
  const t = totals(d);
  const work = document.createElement('canvas');
  work.width = W * SC;
  work.height = 2400 * SC;
  const g = work.getContext('2d');
  g.scale(SC, SC);
  const rr = (x, y, w, hh, r, fill) => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + hh, r);
    g.arcTo(x + w, y + hh, x, y + hh, r);
    g.arcTo(x, y + hh, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  };
  const text = (s, x, y, font, color, align) => {
    g.font = font;
    g.fillStyle = color;
    g.textAlign = align || 'left';
    g.fillText(s, x, y);
  };
  const wrap = (s, width, font) => {
    g.font = font;
    const lines = [];
    let line = '';
    Array.from(String(s)).forEach((ch) => {
      if (g.measureText(line + ch).width > width) {
        lines.push(line);
        line = ch;
      } else line += ch;
    });
    if (line) lines.push(line);
    return lines;
  };
  const state = closeState(m, c);
  const X = 24;
  const CW = W - X * 2;
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#F4F6F3';
  g.fillRect(0, 0, W, 2400);

  // 見出し
  rr(0, 0, W, 112, 0, '#0E5E4E');
  text('おこづかい報告', X, 40, '700 15px ' + FONT_ROUND, 'rgba(255,255,255,0.85)');
  text(monthLabel(m), X, 82, '800 32px ' + FONT_ROUND, '#FFFFFF');
  rr(W - X - 96, 52, 96, 32, 16, '#FFFFFF');
  text(CLOSE_LABEL[state][0], W - X - 48, 74, '700 15px ' + FONT_ROUND, '#0E5E4E', 'center');
  let y = 132;

  // 残高
  rr(X, y, CW, 132, 20, '#FFFFFF');
  text('月末の残高', X + 20, y + 30, '400 14px ' + FONT_TEXT, '#55625D');
  text(yen(t.balance), X + 20, y + 80, '800 42px ' + FONT_ROUND, '#17211E');
  text('繰越 ' + yen(d.opening) + '　収入 ' + yen(t.income) + '　支出 ' + yen(t.expense), X + 20, y + 112, '400 14px ' + FONT_TEXT, '#55625D');
  y += 148;

  // 現金と使途不明
  const unknown = t.byCat['使途不明'] || 0;
  rr(X, y, CW, 92, 20, '#FFFFFF');
  text('手元の現金', X + 20, y + 34, '400 14px ' + FONT_TEXT, '#55625D');
  text(yen(c.cash) + '（ぴったり）', X + CW - 20, y + 34, '700 16px ' + FONT_ROUND, '#0E5E4E', 'right');
  text('使途不明', X + 20, y + 70, '400 14px ' + FONT_TEXT, '#55625D');
  text(unknown ? yen(unknown) : 'なし', X + CW - 20, y + 70, '700 16px ' + FONT_ROUND, unknown ? '#9A3412' : '#17211E', 'right');
  y += 108;

  // 何に使った？
  const cats = Object.keys(t.byCat).sort((a, b) => t.byCat[b] - t.byCat[a]);
  const catH = 52 + Math.max(1, cats.length) * 30;
  rr(X, y, CW, catH, 20, '#FFFFFF');
  text('何に使った？', X + 20, y + 32, '700 16px ' + FONT_ROUND, '#17211E');
  if (!cats.length) text('支出はありません', X + 20, y + 64, '400 14px ' + FONT_TEXT, '#55625D');
  cats.forEach((k, i) => {
    const ry = y + 52 + i * 30;
    text(k, X + 20, ry + 15, '400 14px ' + FONT_TEXT, '#17211E');
    rr(X + 110, ry + 4, CW - 230, 12, 6, '#EEF1EF');
    rr(X + 110, ry + 4, Math.max(6, ((CW - 230) * t.byCat[k]) / t.expense), 12, 6, CAT_COLORS[k] || '#9AA5A0');
    text(yen(t.byCat[k]), X + CW - 20, ry + 15, '700 14px ' + FONT_ROUND, '#17211E', 'right');
  });
  y += catH + 16;

  // 保護者のチェック
  rr(X, y, CW, 72, 20, '#E3EBF7');
  text('保護者のチェック', X + 20, y + 30, '700 15px ' + FONT_ROUND, '#1E3A6B');
  text('見たよ ' + t.marks[1] + '　注目中 ' + t.marks[2] + '　ストップ ' + t.marks[3] + '　未チェック ' + t.marks[0], X + 20, y + 56, '400 14px ' + FONT_TEXT, '#1E3A6B');
  y += 88;

  // ひとこと
  const lines = wrap(c.comment, CW - 40, '400 16px ' + FONT_TEXT);
  const cmH = 56 + lines.length * 26;
  rr(X, y, CW, cmH, 20, '#FFFFFF');
  text('今月のひとこと', X + 20, y + 30, '700 15px ' + FONT_ROUND, '#17211E');
  lines.forEach((l, i) => text(l, X + 20, y + 58 + i * 26, '400 16px ' + FONT_TEXT, '#17211E'));
  y += cmH + 16;

  // AI コーチ
  const ai = aiReview(c);
  if (ai) {
    const parts = [['よかった点', ai.good], ['気をつけたい点', ai.care], ['来月の目標', ai.goal]].map((x) => [x[0], wrap(x[1], CW - 40, '400 15px ' + FONT_TEXT)]);
    const aiH = 50 + parts.reduce((n, x) => n + 24 + x[1].length * 22, 0);
    rr(X, y, CW, aiH, 20, '#FFFFFF');
    text('AI コーチから', X + 20, y + 30, '700 15px ' + FONT_ROUND, '#17211E');
    let ay = y + 56;
    parts.forEach((x) => {
      text(x[0], X + 20, ay, '700 13px ' + FONT_ROUND, '#0E5E4E');
      ay += 22;
      x[1].forEach((l) => {
        text(l, X + 20, ay, '400 15px ' + FONT_TEXT, '#17211E');
        ay += 22;
      });
      ay += 2;
    });
    y += aiH + 16;
  }

  // 承認
  if (c.status === 'approved') {
    const pl = c.parentComment ? wrap(c.parentComment, CW - 40, '400 15px ' + FONT_TEXT) : [];
    const pH = 64 + pl.length * 24;
    rr(X, y, CW, pH, 20, '#E3F1EC');
    text('保護者から', X + 20, y + 30, '700 15px ' + FONT_ROUND, '#0E5E4E');
    text('おこづかい ' + yen(c.allowance), X + CW - 20, y + 30, '700 15px ' + FONT_ROUND, '#0E5E4E', 'right');
    pl.forEach((l, i) => text(l, X + 20, y + 58 + i * 24, '400 15px ' + FONT_TEXT, '#17211E'));
    y += pH + 16;
  }

  const sub = new Date(Number(c.submittedAt));
  text((sub.getMonth() + 1) + '/' + sub.getDate() + ' に提出' + (c.late ? '（期限後）' : ''), W / 2, y + 12, '400 13px ' + FONT_TEXT, '#55625D', 'center');
  y += 32;

  const out = document.createElement('canvas');
  out.width = W * SC;
  out.height = y * SC;
  out.getContext('2d').drawImage(work, 0, 0);
  return out;
}

function reportFile() {
  return new File([S.reportBlob], 'okozukai-' + route().id + '.png', { type: 'image/png' });
}

function downloadReport() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(S.reportBlob);
  a.download = reportFile().name;
  a.click();
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
  if (act === 'retry') {
    S.failedMonth = null;
    return S.user ? render() : start();
  }
  if (act === 'receiptCancel') {
    S.receiptDraft = null;
    return render();
  }
  if (act === 'recount') {
    S.closeCash = null;
    return render();
  }
  if (act === 'share' || act === 'download') {
    if (!S.reportBlob) return toast('画像を作っています。少し待ってください');
    const file = reportFile();
    if (act === 'share' && navigator.canShare && navigator.canShare({ files: [file] })) {
      // 共有メニューから LINE に送ったり、「画像を保存」で写真に残したりできる
      navigator.share({ files: [file] }).catch(() => {});
    } else downloadReport();
    return;
  }
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
      await api('add', { type: 'expense', category: p.category, name: p.label, amount: p.amount, date: inputDate(), source: 'preset' });
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

// 写真は縮小して JPEG にしてから送る（通信量と AI の費用を抑える）
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.8).split(',')[1]);
    };
    img.onerror = () => reject(new Error('bad_image'));
    img.src = URL.createObjectURL(file);
  });
}

app.addEventListener('change', async (e) => {
  if (!e.target.matches || !e.target.matches('[data-receipt]') || !e.target.files.length) return;
  S.reading = true;
  render();
  try {
    const image = await shrinkImage(e.target.files[0]);
    S.receiptDraft = await api('readReceipt', { image: image });
    S.inputCat = S.receiptDraft.category;
  } catch (err) {
    fail(err);
  } finally {
    S.reading = false;
    render();
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
      const r = S.receiptDraft;
      await api('add', Object.assign(
        { type: S.inputType, category: S.inputCat, name: f.name.value, amount: f.amount.value, date: f.date.value },
        // 読み取れなかった項目があれば、本人が直していても保護者に確かめてもらう
        r ? { source: 'receipt', receiptId: r.receiptId, needsCheck: !!(r.unclear || r.aiFailed) } : {}
      ));
      S.receiptDraft = null;
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
    } else if (form.dataset.form === 'cash') {
      S.closeCash = Math.floor(Number(f.cash.value));
      render();
    } else if (form.dataset.form === 'diff') {
      const m = form.dataset.month;
      const income = form.dataset.type === 'income';
      await api('add', {
        type: form.dataset.type,
        category: income ? f.category.value : '使途不明',
        name: income ? '締めの差額（記録漏れの収入）' : '締めの差額',
        amount: form.dataset.amount,
        date: lastDay(m),
        memo: f.reason.value,
        source: 'diff',
      });
      toast('差額を記録しました');
      await load(m);
    } else if (form.dataset.form === 'close') {
      const m = form.dataset.month;
      await api('close', { month: m, cash: S.closeCash, comment: f.comment.value });
      S.closeCash = null;
      toast('提出しました。報告カードを保護者に送りましょう');
      await load(m);
      location.hash = '#/report/' + m;
    } else if (form.dataset.form === 'approve') {
      const m = form.dataset.month;
      await api('approve', { month: m, allowance: f.allowance.value, comment: f.comment.value });
      toast('承認しました');
      await load(m);
    } else if (form.dataset.form === 'return') {
      const m = form.dataset.month;
      await api('returnClose', { month: m, reason: f.reason.value });
      toast('差し戻しました');
      await load(m);
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
  const r = route();
  if (r.name !== 'presets') S.presetDraft = null;
  if (r.name === 'archive') S.archive = null; // 開くたびに最新にする
  if (r.name !== 'close') S.closeCash = null;
  if (r.name !== 'input') S.receiptDraft = null;
  S.filter = 'all';
  render();
  window.scrollTo(0, 0);
});

// ホーム画面のアプリは開いたまま裏に残るため、戻ってきたら最新の記録を読み直す
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !S.user || S.loading) return;
  if (route().name === 'archive') S.archive = null;
  load();
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
