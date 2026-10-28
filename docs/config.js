// 公開して問題ない値だけを書く（API キーなどの秘密情報は Apps Script のスクリプトプロパティへ）
window.OKOZUKAI_CONFIG = {
  // Apps Script を「ウェブアプリ」としてデプロイしたときの URL
  apiUrl: 'https://script.google.com/macros/s/XXXXXXXX/exec',
  // Google Cloud で作成した OAuth クライアント ID
  clientId: 'XXXXXXXX.apps.googleusercontent.com',
};
