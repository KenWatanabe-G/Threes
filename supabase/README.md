# Supabase セットアップガイド（GitHub Pages版）

GitHub Pagesで公開する場合の簡易セットアップ手順です。
Edge Functionsは不要で、ブラウザから直接Supabaseに書き込みます。

## 1. Supabaseプロジェクトの作成

1. [https://supabase.com](https://supabase.com) にアクセス
2. GitHubアカウントでログイン
3. 「New Project」をクリック
4. 設定：
   - **Name**: `threes-ranking`（任意）
   - **Database Password**: 強力なパスワード
   - **Region**: `Northeast Asia (Tokyo)`
5. 「Create new project」をクリック（1-2分待機）

## 2. テーブルの作成

1. 左メニュー「SQL Editor」をクリック
2. 「New query」をクリック
3. `setup.sql`の内容をコピー＆ペースト
4. 「Run」をクリック

## 3. API情報の取得

1. 左メニュー「Project Settings」（歯車）をクリック
2. 「API」をクリック
3. 以下をコピー：
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon public key**: `eyJhbGciOi...`

## 4. GitHub Secretsの設定

リポジトリのコードにSupabase設定を公開しないため、GitHub Secretsを使用します。

1. GitHubリポジトリの「Settings」タブを開く
2. 左メニュー「Secrets and variables」→「Actions」をクリック
3. 「New repository secret」をクリックして以下を追加：

| Name | Value |
|------|-------|
| `SUPABASE_URL` | `https://xxxxx.supabase.co`（手順3で取得したProject URL） |
| `SUPABASE_ANON_KEY` | `eyJhbGciOi...`（手順3で取得したanon public key） |

## 5. GitHub Pagesの有効化

1. リポジトリの「Settings」タブを開く
2. 左メニュー「Pages」をクリック
3. 「Source」を「GitHub Actions」に変更

## 6. デプロイ

`main`ブランチにpushすると、GitHub Actionsが自動的に：
1. Supabase設定をSecretsから注入
2. GitHub Pagesにデプロイ

手動でデプロイする場合：
1. 「Actions」タブを開く
2. 「Deploy to GitHub Pages」ワークフローを選択
3. 「Run workflow」をクリック

## セキュリティについて

この簡易版では、ブラウザから直接データベースに書き込むため：
- 理論上、不正なスコアを登録可能
- カジュアルな用途には十分
- 本格的な対策が必要な場合はEdge Functionsを使用

**注意**: anon keyは公開サイトのJavaScriptに含まれるため、完全に秘密にはなりません。
ただし、リポジトリのコードには含まれないため、git履歴には残りません。

## トラブルシューティング

### 「スコア登録に失敗しました」が表示される

1. GitHub Secretsが正しく設定されているか確認
2. GitHub Actionsのログでエラーを確認
3. RLSポリシーが正しく設定されているか確認
4. ブラウザのコンソールでエラー詳細を確認

### ランキングが表示されない

1. テーブルが存在するか確認（Table Editor）
2. RLSのSELECTポリシーが有効か確認

### GitHub Actionsが失敗する

1. 「Actions」タブでエラーログを確認
2. Secretsの名前が正確か確認（`SUPABASE_URL`と`SUPABASE_ANON_KEY`）

## ローカル開発

ローカルでランキング機能をテストする場合：

1. `config.local.js.example`をコピーして`config.local.js`を作成
2. Supabase設定を記入

```bash
cp config.local.js.example config.local.js
```

```javascript
// config.local.js
window.SUPABASE_CONFIG = {
    url: 'https://xxxxx.supabase.co',
    anonKey: 'eyJhbGciOi...'
};
```

`config.local.js`は`.gitignore`に含まれているため、pushされません。
