/**
 * おこづかい帳 API（Google Apps Script）
 *
 * スクリプトプロパティ（プロジェクトの設定 → スクリプト プロパティ）に以下を設定する:
 *   GOOGLE_CLIENT_ID  … Google ログイン用 OAuth クライアント ID
 *   PARENT_EMAILS     … 保護者の Google アカウント（カンマ区切り）
 *   CHILD_EMAILS      … 子どもの Google アカウント（カンマ区切り）
 *
 * 初回は setup() を一度実行してシートを作成する。
 */

const SHEETS = {
  // 記録は削除しない。取り消しは voided=TRUE にして残す
  tx: ['id', 'createdAt', 'date', 'type', 'category', 'name', 'amount', 'memo', 'receiptUrl', 'source', 'needsCheck', 'edited', 'voided', 'mark', 'markedAt', 'markedBy'],
  edits: ['id', 'txId', 'editedAt', 'editor', 'before', 'after', 'reason'],
  presets: ['id', 'label', 'category', 'amount', 'order'],
  meta: ['key', 'value'],
};

const EXPENSE_CATEGORIES = ['食べ物', '遊び', '課金', '買い物', '交通', '貯金', '使途不明', 'その他'];
const INCOME_CATEGORIES = ['おこづかい', 'お年玉・お祝い', 'その他収入'];

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach((name) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(SHEETS[name]);
      sh.setFrozenRows(1);
    }
  });
  if (readAll_('presets').length === 0) {
    [
      ['飲み物', '食べ物', 150],
      ['コンビニおやつ', '食べ物', 200],
      ['カラオケ', '遊び', 600],
      ['電車（片道）', '交通', 200],
    ].forEach((p, i) => append_('presets', { id: uid_(), label: p[0], category: p[1], amount: p[2], order: i }));
  }
}

// ---- エントリポイント ----
// フロントは CORS のプリフライトを避けるため Content-Type: text/plain で JSON を POST する

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad_request' });
  }
  try {
    if (body.action === 'login') return json_({ ok: true, data: login_((body.params || {}).idToken) });
    const user = authenticate_(body.session);
    const handler = ACTIONS[body.action];
    if (!handler) return json_({ ok: false, error: 'unknown_action' });
    if (handler.role && handler.role !== user.role) return json_({ ok: false, error: 'forbidden' });
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      return json_({ ok: true, data: handler.run(body.params || {}, user) });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function doGet() {
  return json_({ ok: true, service: 'okozukai' });
}

// ---- 認証 ----

// Google の ID トークンは1時間で切れるため、ログイン時に一度だけ確認して長期のセッションを発行する。
// セッションはスプレッドシートのドキュメントプロパティに、ハッシュ値をキーにして保存する。
const SESSION_DAYS = 180;

function login_(idToken) {
  if (!idToken) throw new Error('unauthenticated');
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('unauthenticated');
  const info = JSON.parse(res.getContentText());
  if (info.aud !== PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID')) throw new Error('unauthenticated');
  if (String(info.email_verified) !== 'true') throw new Error('unauthenticated');

  const email = String(info.email).toLowerCase();
  const user = { email: email, role: roleOf_(email) };
  const store = PropertiesService.getDocumentProperties();
  const now = Date.now();
  // 期限切れのセッションを片付ける
  const all = store.getProperties();
  Object.keys(all).forEach((k) => {
    if (k.indexOf('sess_') === 0 && JSON.parse(all[k]).exp < now) store.deleteProperty(k);
  });
  const session = Utilities.getUuid() + Utilities.getUuid();
  store.setProperty(sessionKey_(session), JSON.stringify({ email: email, exp: now + SESSION_DAYS * 864e5 }));
  return { session: session, user: user };
}

function authenticate_(session) {
  if (!session) throw new Error('unauthenticated');
  const raw = PropertiesService.getDocumentProperties().getProperty(sessionKey_(session));
  if (!raw) throw new Error('unauthenticated');
  const s = JSON.parse(raw);
  if (s.exp < Date.now()) throw new Error('unauthenticated');
  // 役割は毎回スクリプトプロパティから決める（家族の登録を外せば、すぐ使えなくなる）
  return { email: s.email, role: roleOf_(s.email) };
}

function roleOf_(email) {
  const props = PropertiesService.getScriptProperties();
  const list = (k) => (props.getProperty(k) || '').split(',').map((s) => s.trim().toLowerCase()).filter(String);
  if (list('PARENT_EMAILS').indexOf(email) >= 0) return 'parent';
  if (list('CHILD_EMAILS').indexOf(email) >= 0) return 'child';
  throw new Error('forbidden');
}

function sessionKey_(session) {
  return 'sess_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, session));
}

// ---- アクション ----

const ACTIONS = {
  me: {
    run: (p, user) => user,
  },

  month: {
    run: (p, user) => {
      const month = p.month || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM');
      const all = readAll_('tx');
      let opening = 0;
      const rows = [];
      all.forEach((t) => {
        const m = String(t.date).slice(0, 7);
        if (m < month) opening += signed_(t);
        else if (m === month) rows.push(t);
      });
      rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));
      const editLog = readAll_('edits').filter((e) => rows.some((t) => t.id === e.txId));
      return {
        month: month,
        opening: opening,
        rows: rows,
        edits: editLog,
        presets: readAll_('presets').sort((a, b) => a.order - b.order),
        lastParentCheck: getMeta_('lastParentCheck'),
        categories: { expense: EXPENSE_CATEGORIES, income: INCOME_CATEGORIES },
        role: user.role,
      };
    },
  },

  add: {
    run: (p, user) => {
      const t = validateTx_(p);
      t.id = uid_();
      t.createdAt = Date.now();
      t.source = p.source === 'preset' ? 'preset' : 'manual';
      t.receiptUrl = '';
      t.needsCheck = false;
      t.edited = false;
      t.voided = false;
      t.mark = 0;
      t.markedAt = '';
      t.markedBy = '';
      append_('tx', t);
      return t;
    },
  },

  edit: {
    run: (p, user) => {
      const reason = String(p.reason || '').trim();
      if (!reason) throw new Error('reason_required');
      const found = findRow_('tx', p.id);
      if (!found) throw new Error('not_found');
      const before = found.obj;
      const next = validateTx_(Object.assign({}, before, p.changes || {}));
      const fields = ['date', 'type', 'category', 'name', 'amount', 'memo', 'voided'];
      const b = {};
      const a = {};
      fields.forEach((f) => {
        if (String(before[f]) !== String(next[f])) {
          b[f] = before[f];
          a[f] = next[f];
        }
      });
      if (Object.keys(a).length === 0) throw new Error('no_change');
      // 「見たよ」済みの記録が修正されたら、保護者にもう一度見てもらうため未チェックに戻す
      const mark = Number(before.mark) === 1 ? 0 : before.mark;
      const updated = Object.assign({}, before, a, { edited: true, needsCheck: false, mark: mark });
      writeRow_('tx', found.row, updated);
      append_('edits', { id: uid_(), txId: before.id, editedAt: Date.now(), editor: user.role, before: JSON.stringify(b), after: JSON.stringify(a), reason: reason });
      return updated;
    },
  },

  mark: {
    role: 'parent',
    run: (p, user) => {
      const state = Number(p.mark);
      if ([0, 1, 2, 3].indexOf(state) < 0) throw new Error('bad_mark');
      const found = findRow_('tx', p.id);
      if (!found) throw new Error('not_found');
      const now = Date.now();
      writeRow_('tx', found.row, Object.assign({}, found.obj, { mark: state, markedAt: state ? now : '', markedBy: state ? user.email : '' }));
      setMeta_('lastParentCheck', now);
      return { id: p.id, mark: state };
    },
  },

  markAllSeen: {
    role: 'parent',
    run: (p, user) => {
      const now = Date.now();
      let count = 0;
      readAll_('tx').forEach((t, i) => {
        if (String(t.date).slice(0, 7) === p.month && !Number(t.mark)) {
          writeRow_('tx', i + 2, Object.assign({}, t, { mark: 1, markedAt: now, markedBy: user.email }));
          count++;
        }
      });
      setMeta_('lastParentCheck', now);
      return { count: count };
    },
  },

  savePresets: {
    run: (p) => {
      const list = (p.presets || []).slice(0, 20).map((x, i) => ({
        id: x.id || uid_(),
        label: String(x.label || '').slice(0, 30),
        category: EXPENSE_CATEGORIES.indexOf(x.category) >= 0 ? x.category : 'その他',
        amount: Math.max(1, Math.floor(Number(x.amount) || 0)),
        order: i,
      })).filter((x) => x.label);
      const sh = sheet_('presets');
      if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
      list.forEach((x) => append_('presets', x));
      return list;
    },
  },
};

// ---- 検証 ----

function validateTx_(p) {
  const type = p.type === 'income' ? 'income' : 'expense';
  const cats = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const amount = Math.floor(Number(p.amount));
  if (!(amount > 0 && amount <= 1000000)) throw new Error('bad_amount');
  const date = String(p.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('bad_date');
  return {
    id: p.id,
    createdAt: p.createdAt,
    date: date,
    type: type,
    category: cats.indexOf(p.category) >= 0 ? p.category : cats[cats.length - 1],
    name: String(p.name || '').slice(0, 50),
    amount: amount,
    memo: String(p.memo || '').slice(0, 200),
    receiptUrl: p.receiptUrl || '',
    source: p.source || 'manual',
    needsCheck: p.needsCheck === true || p.needsCheck === 'TRUE',
    edited: p.edited === true || p.edited === 'TRUE',
    voided: p.voided === true || p.voided === 'TRUE',
    mark: Number(p.mark) || 0,
    markedAt: p.markedAt || '',
    markedBy: p.markedBy || '',
  };
}

function signed_(t) {
  if (t.voided) return 0;
  return t.type === 'income' ? Number(t.amount) : -Number(t.amount);
}

// ---- シート操作 ----

function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('setup_required');
  return sh;
}

function readAll_(name) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const cols = SHEETS[name];
  // 日付が Date 型に自動変換されないよう表示値で読む
  return sh.getRange(2, 1, last - 1, cols.length).getDisplayValues().map((r) => {
    const o = {};
    cols.forEach((c, i) => (o[c] = r[i]));
    ['amount', 'createdAt', 'mark', 'order', 'editedAt', 'markedAt'].forEach((k) => {
      if (k in o && o[k] !== '') o[k] = Number(o[k]);
    });
    ['needsCheck', 'edited', 'voided'].forEach((k) => {
      if (k in o) o[k] = o[k] === 'TRUE';
    });
    return o;
  });
}

function findRow_(name, id) {
  const all = readAll_(name);
  for (let i = 0; i < all.length; i++) {
    if (all[i].id === id) return { row: i + 2, obj: all[i] };
  }
  return null;
}

function toRow_(name, obj) {
  return SHEETS[name].map((c) => (obj[c] === undefined ? '' : obj[c]));
}

function append_(name, obj) {
  const sh = sheet_(name);
  const row = sh.getLastRow() + 1;
  const range = sh.getRange(row, 1, 1, SHEETS[name].length);
  range.setNumberFormat('@'); // 文字列として保存（日付の自動変換を防ぐ）
  range.setValues([toRow_(name, obj)]);
}

function writeRow_(name, row, obj) {
  const range = sheet_(name).getRange(row, 1, 1, SHEETS[name].length);
  range.setNumberFormat('@');
  range.setValues([toRow_(name, obj)]);
}

function getMeta_(key) {
  const hit = readAll_('meta').filter((m) => m.key === key)[0];
  return hit ? Number(hit.value) || hit.value : null;
}

function setMeta_(key, value) {
  const found = findMeta_(key);
  if (found) writeRow_('meta', found, { key: key, value: value });
  else append_('meta', { key: key, value: value });
}

function findMeta_(key) {
  const all = readAll_('meta');
  for (let i = 0; i < all.length; i++) if (all[i].key === key) return i + 2;
  return 0;
}

function uid_() {
  return Utilities.getUuid().slice(0, 8);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
