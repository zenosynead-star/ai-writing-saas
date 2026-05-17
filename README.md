# AI Writing SaaS (リテラ相当 / BringRitera クラス)

要件定義書「SEO/LLMO向けAIライティングSaaS」 Version 1.0 に基づくMVP実装。
Phase 1（ライティング: タイトル→見出し→本文、フリープラン、決済モック）相当を実装している。

## アーキテクチャ

| レイヤー | 採用技術 |
|---|---|
| フロントエンド | Next.js 15 (App Router) + React + TypeScript + TailwindCSS |
| BFF / API | Next.js Route Handlers |
| DB | SQLite (Prisma ORM) |
| 認証 | カスタムJWT + bcrypt + HttpOnly Cookie |
| LLM ゲートウェイ | 社内ラッパー（src/lib/llm.ts） |
| LLM | Google Gemini 2.5 (Pro / Flash / Flash-Lite) - 無料tier |

要件定義書11章で推奨されている `Node.js または Python (FastAPI)` のうちNode.js + Next.js を採用。
プロダクション移行時はPostgreSQL/BullMQ/Redis/S3への切り替えを想定（接続文字列のみ変更）。

## セットアップ（ローカル開発）

ローカルでも PostgreSQL が必要。最も手軽なのは Neon のフリーDB をローカル開発用にも流用する方法。

```powershell
# 1. 依存関係インストール
npm install

# 2. .env を作成し以下を設定
#   DATABASE_URL   (Neon等のPostgres接続URL)
#   DIRECT_URL     (同上、Prisma migrate用の直結URL)
#   JWT_SECRET     (openssl rand -hex 32 で生成)
#   ANTHROPIC_API_KEY

# 3. スキーマ反映 + シード
npx prisma db push
npm run db:seed

# 4. 開発サーバー起動
npm run dev
```

ブラウザで http://localhost:3000 を開く。

## クラウドデプロイ（Render Blueprint一発デプロイ）

### 必要なアカウント

1. **GitHub** — ソースコード管理（既存）
2. **Render** — Webホスティング+Postgres。 https://render.com （GitHubで即ログイン可、電話認証不要）
3. **Anthropic API Key** — https://console.anthropic.com/ で発行

DBはRender Postgres Freeを `render.yaml` で自動作成。

### 手順

#### 1) Render でBlueprintをデプロイ

1. https://render.com にアクセス → GitHubでサインアップ
2. Dashboard で「**New +**」→ **Blueprint**
3. リポジトリ `zenosynead-star/ai-writing-saas` を選択
4. Render が `render.yaml` を読み取り、サービス + DBを自動作成
   - Web Service: `ai-writing-saas` (Free)
   - Database: `ai-writing-saas-db` (Free PostgreSQL 16)
   - `DATABASE_URL` 自動接続、`JWT_SECRET` 自動生成

#### 2) Google AI Studio で Gemini API Key を取得 → 投入

1. https://aistudio.google.com/ にアクセス → Googleアカウントでログイン（クレジットカード不要）
2. 左メニュー「**Get API key**」→ 「**Create API key**」
3. プロジェクトを選択（または新規作成）→ キー `AIza...` をコピー
4. Render Dashboard → `ai-writing-saas` サービス → **Environment** タブ
5. `GOOGLE_API_KEY` の値に貼り付け → Save → 自動再デプロイ

**Gemini 無料tierの上限（2026年時点）**:
- gemini-2.5-flash: 1日 1,500リクエスト、1分 15リクエスト、合計 1M トークン/日
- gemini-2.5-pro: 1日 50リクエスト、1分 5リクエスト
- これを超える場合は有料プランへ自動切り替え可能

#### 3) デプロイ完了確認

最初のデプロイは3〜5分。
- Build logs で `prisma db push` と seed の実行を確認
- 完了すると `https://ai-writing-saas-XXXX.onrender.com` でアクセス可能

### Render Free プランの注意点

- 15分アクセスがないとスリープ。次のアクセス時に再起動（30〜60秒）
- 月750時間（=1サービスを24時間動かせる）
- ビルド時間: 100分/月
- 本格運用するなら Starter ($7/月) でスリープなし

## 実装済み機能

### A. アカウント・課金（要件定義書 3章）
- [x] サインアップ（メール＋PW、紹介コード、Free自動付与50CR）
- [x] ログイン（メール＋PW、JWT＋HttpOnly Cookie、5セッション上限）
- [x] ログアウト
- [x] プラン（Free/Lite/Standard/Pro/Enterprise）管理・変更（決済モック）
- [x] クレジット管理（消費・付与・履歴）

### B. サイト管理（4章）
- [x] サイト登録（自社/競合、事業領域タグ）
- [x] プランごとの上限チェック
- [ ] サーチコンソール連携（Phase 3）

### C. AIライティング（5章、最重要）
- [x] **Step1: キーワード探索**（直接入力 / テーマからAI提案）
- [x] **Step2: タイトル生成**（4訴求軸でAI提案）
- [x] **Step3: 見出し構成生成**（E-E-A-T・Needs Met準拠、ペルソナ・検索意図・潜在ニーズ自動推定）
  - ドラッグレスのキーボード操作で並び替え・追加・削除
- [x] **Step4: オプション設定**（モデル選択・本文量・文体）
- [x] **Step5: 本文生成**（HTML出力、メタディスクリプション自動付与）
- [x] 記事エディタ（プレビュー / HTML編集 / メタ編集 / Markdown出力 / クリップボードコピー / 削除）

### D. 画像生成AI（6章）
- [ ] 未実装（要件: 14スタイル×12テンプレ、Phase 2）

### E. 検索順位/AIOチェック（7章）
- [ ] 未実装（外部SERP API要、Phase 3）

### F. LLMOコンパス（8章）
- [ ] 未実装（複数AI API要、Phase 4）

### 非機能
- [x] 認証（JWT、bcrypt cost factor 12）
- [x] CSRF対策（SameSite=lax Cookie）
- [x] プロンプトインジェクション対策（sanitizeUserInput）
- [x] レスポンシブUI（PC/タブレット/スマホ）

## ディレクトリ構成

```
src/
├── app/
│   ├── (app)/                  # 認証後のレイアウト・ページ
│   │   ├── dashboard/
│   │   ├── articles/
│   │   │   ├── [id]/
│   │   │   │   ├── wizard/    # 5ステップウィザード
│   │   │   │   └── ArticleEditor.tsx
│   │   │   └── new/
│   │   ├── plan/
│   │   └── sites/
│   ├── api/                    # Route Handlers
│   │   ├── auth/{signup,login,logout}/
│   │   ├── articles/[id]/
│   │   ├── generate/{keywords,titles,headings,body}/
│   │   ├── plan/change/
│   │   └── sites/
│   ├── login/ signup/          # 認証画面
│   └── page.tsx                # LP
├── components/
└── lib/
    ├── db.ts                   # Prisma client
    ├── auth.ts                 # JWT/セッション/パスワード
    ├── credits.ts              # クレジット消費・付与
    ├── llm.ts                  # LLMゲートウェイ抽象化
    ├── prompts.ts              # 要件定義書5章のプロンプトテンプレート
    └── headings.ts             # 見出しツリー操作
prisma/
├── schema.prisma               # 要件定義書11.3 データモデル
└── seed.ts                     # プランデータ
```

## クレジット消費表（要件定義書 3.3.1）

| 機能 | 消費 CR |
|---|---:|
| キーワード探索（テーマ） | 1 |
| キーワード探索（URL） | 2 |
| タイトル生成 | 1 |
| 見出し生成 | 2 |
| 本文生成（標準 = Haiku） | 10 |
| 本文生成（高性能 = Sonnet） | 15 |
| 本文生成（最高性能 = Opus） | 20 |

## プラン構成（要件定義書 3.2.1）

| プラン | 月額 | 月CR | 記事/月 | サイト | 順位計測KW |
|---|---:|---:|---:|---:|---:|
| Free | ¥0 | 50 | 1 | 1 | 1 |
| Lite | ¥500 | 100 | 2 | 5 | 1,000 |
| Standard | ¥3,000 | 620 | 15 | 50 | 6,200 |
| Pro | ¥9,000 | 2,000 | 50 | 200 | 20,000 |
| Enterprise | ¥30,000 | 7,000 | 175 | 1,000 | 70,000 |

## 法的・倫理的配慮（要件定義書 0.2 準拠）

- 機能名・UI・ブランド表記・キャッチコピー・画面レイアウトはすべて独自実装
- 「リテラ」を消費単位名称として使用せず、中立的に「クレジット」と呼称
- プロンプトは要件定義書5章の公開設計案を実装（リテラ社の内部プロンプトではない）
- ユーザー入力データのLLM学習への流用なし（Anthropic APIのデフォルト動作）

## 未実装機能 / 将来拡張

要件定義書17.1 機能比較に対する現在のカバレッジ:

| カバレッジ | 要件 |
|---|---|
| ✅ | ライティング（タイトル→見出し→本文）コアフロー |
| ✅ | クレジット管理 / プラン管理 |
| ⏳ | リライト機能（5.7） |
| ⏳ | 全自動記事作成（5.8、Pro以上） |
| ⏳ | 多言語対応（5.9、6言語） |
| ⏳ | 画像生成 / 画像編集（6章） |
| ⏳ | 順位計測（7章） |
| ⏳ | LLMOコンパス（8章） |
| ⏳ | WordPress連携（2.2） |
| ⏳ | 薬機法チェック（オプション） |
| ⏳ | CSVエクスポート / 外部共有リンク |
| ⏳ | 2要素認証（3.1.2、Standard以上） |
| ⏳ | プロンプトテンプレートのDB管理UI（12章） |

これらはPhase 2-5での順次実装を想定（要件定義書 13.2）。

## ライセンス / 注意事項

本実装は要件定義書に基づく独自実装であり、リテラ（BringRitera）のソースコード・内部実装を含まない。
商用利用時は要件定義書15章「法務・利用規約上の要件」を別途整備すること。
