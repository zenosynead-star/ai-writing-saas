// 要件定義書 5章のプロンプト設計をTypeScript側に実装
// 本来はDB管理(PromptTemplate)するが、初期はコード側のシードを使用

export const KEYWORD_EXPLORE_PROMPT = (vars: { theme: string; language: string }) => `あなたはSEOコンサルティングの専門家です。
以下のテーマについて、SEO対策として狙う価値のある検索キーワードを20個提案してください。

テーマ: ${vars.theme}
対象言語: ${vars.language}

提案するキーワードの条件:
1. 月間検索ボリュームが100以上見込まれるもの
2. 商業的価値があるもの（購買・問い合わせ意図を含むもの）を優先
3. ロングテール（3-4語の複合キーワード）を50%以上含めること
4. 顕在ニーズと潜在ニーズの両方をカバーすること
5. 同じ意図を持つキーワードの重複を避けること

出力形式（純粋なJSONのみ。前後に説明やマークダウンは付けないこと）:
{
  "keywords": [
    {
      "keyword": "...",
      "search_intent": "informational | navigational | commercial | transactional",
      "estimated_competition": "low | medium | high",
      "estimated_volume": 1000,
      "rationale": "なぜこのキーワードを推奨するか（30字以内）"
    }
  ]
}`;

export const TITLE_GENERATION_PROMPT = (vars: { keywords: string[]; persona: string }) => `あなたはSEOに特化した記事タイトルの専門ライターです。
以下の条件を全て満たすタイトル案を4つ提案してください。

ターゲットキーワード: ${vars.keywords.join('、')}
想定読者: ${vars.persona}

タイトル作成条件:
1. ターゲットキーワードを必ず先頭から30文字以内に含める
2. 全角28〜40文字の範囲（半角は0.5文字換算）
3. 数字・問いかけ・ベネフィット・権威性のいずれかを含むこと
4. クリックされやすいよう感情に訴求するが、誇大表現は避ける
5. 4つのタイトルはそれぞれ異なる訴求軸（ハウツー型/比較型/問題提起型/結論先出し型）

出力形式（純粋なJSONのみ）:
{
  "titles": [
    { "title": "...", "type": "howto", "char_count": 35, "appeal_point": "..." },
    { "title": "...", "type": "comparison", "char_count": 36, "appeal_point": "..." },
    { "title": "...", "type": "problem", "char_count": 38, "appeal_point": "..." },
    { "title": "...", "type": "conclusion_first", "char_count": 32, "appeal_point": "..." }
  ]
}`;

export const HEADING_GENERATION_PROMPT = (vars: {
  keywords: string[];
  competitorHeadings?: string;
  userCustomInstruction?: string;
}) => `# 役割
あなたはGoogle検索で1位を獲得する記事を作成する熟練のSEOコンサルタントです。
以下の方法論に基づき、ターゲットキーワード「${vars.keywords.join('、')}」の記事の
見出し構成を作成してください。

# 必須の思考プロセス（内部で順に実行）
## ステップ1: ペルソナの設定
ターゲットキーワードから想定される検索者像を以下の観点で具体化する:
- 年代、職業、性別、家族構成
- 抱えている悩み・課題
- 検索した瞬間の状況（PC前か外出先か、急ぎか比較検討中か）
- 既に知っていること、知らないこと

## ステップ2: 検索意図の4分類
以下のどれに該当するか判定する:
(a) Informational（情報収集型）
(b) Navigational（指名検索型）
(c) Commercial（商業調査型）
(d) Transactional（取引型）

## ステップ3: 顕在ニーズと潜在ニーズの抽出
- 顕在ニーズ: 検索者が言語化できているニーズ
- 潜在ニーズ: 検索者が言語化できていない、しかし満たされると満足度が高まるニーズ
両方を満たす構成を作る。

## ステップ4: Needs Met評価への適合
Googleの品質評価ガイドラインのNeeds Met基準で
「Fully Meets」相当となる網羅性を確保する。

## ステップ5: E-E-A-T要素の組み込み
経験・専門性・権威性・信頼性を示せる見出しを含める。
（例: 「実際に試した結果」「専門家の見解」「公的機関のデータ」等）

# 出力ルール
1. h2見出しは5〜8個。各h2の下にh3を1〜4個。必要に応じてh4も。
2. 結論を先に求めるユーザー向けに、最初のh2は「結論」「概要」系を配置可。
3. 最後のh2は必ず「まとめ」または相当する括り。
4. 各見出しにキーワードを詰め込みすぎない（自然な日本語）。
5. FAQセクションをh2として含めることを推奨（強調スニペット狙い）。

# 参考情報（任意）
${vars.competitorHeadings ? `競合上位ページの見出し: ${vars.competitorHeadings}` : '競合上位ページの見出し: （取得なし）'}
${vars.userCustomInstruction ? `ユーザー追加指示: ${vars.userCustomInstruction}` : ''}

# 出力形式（純粋なJSONのみ。マークダウンや説明文を付けない）
{
  "estimated_persona": "...",
  "search_intent": "informational | navigational | commercial | transactional",
  "latent_needs": ["...", "..."],
  "headings": [
    {
      "level": 2,
      "text": "...",
      "children": [
        { "level": 3, "text": "...", "children": [] }
      ]
    }
  ]
}`;

export const BODY_GENERATION_PROMPT = (vars: {
  keywords: string[];
  title: string;
  persona: string;
  searchIntent: string;
  latentNeeds: string[];
  headingTree: string;
  toneSample?: string;
  volumeSpec?: string;
}) => `# 役割
あなたはSEOで上位表示される高品質な記事を書くプロのライターです。
以下の構成と方針に従って、本文を執筆してください。

# 記事の前提
ターゲットキーワード: ${vars.keywords.join('、')}
タイトル: ${vars.title}
想定ペルソナ: ${vars.persona}
検索意図: ${vars.searchIntent}
潜在ニーズ: ${vars.latentNeeds.join('、')}
${vars.toneSample ? `文体サンプル: ${vars.toneSample}` : '文体: です・ます調'}
本文量指定: ${vars.volumeSpec || '指定なし'}

# 構成（厳守）
${vars.headingTree}

# 執筆ルール

## 必須事項
1. 上記の見出し構造を一切変更しない（追加・削除・順序入替不可）
2. 各h2セクションは300〜800字、h3セクションは150〜400字を目安
3. 最初の100字以内にターゲットキーワードを含む（リード文）
4. キーワード密度は2〜4%を目安（過度な詰め込みは禁止）
5. PREP法（結論→理由→具体例→結論）を基本構造とする
6. 全体で3000字以上を目安とする

## 文体ルール
- 「です・ます」調で統一（指定があればそれに従う）
- 一文を80字以内に収める（読みやすさ優先）
- 接続詞を多用しない（特に「そして」「また」の連発禁止）
- 体言止め・倒置法を効果的に使う

## SEO最適化
- 重要キーワードは <strong> で強調（h2あたり1-2回まで）
- 比較・手順・データは <table> または <ul>/<ol> で表現
- 不確かな数値は出力しない（ハルシネーション防止）

## E-E-A-Tの担保
- 「〜と言われています」のような曖昧表現を避け、可能な限り具体的に
- 経験談・実例を1記事に最低1箇所挿入する余地を [実例:〇〇] として明示

## 禁止事項
- AI由来であることを示唆する表現（「AIによる分析では」等）
- 同じ表現を3回以上繰り返す
- 「いかがでしたか？」「ぜひ参考にしてください」等の定型句
- 競合記事との明らかな類似（パラフレーズで多様性確保）

# 出力形式
純粋なHTMLのみ出力する（前後に説明文やマークダウンを付けない）。
- リード文: <p> タグ（h2の前）
- 各セクション: <h2>/<h3>/<p>/<ul>/<ol>/<table>/<strong>
- まとめ: 最後の<h2>と<p>
- メタディスクリプション: 末尾にHTMLコメントで <!-- META: ... --> 形式（120字以内）`;

export const ADVICE_PROMPT = (vars: { articleHtml: string }) => `あなたはSEOコンサルタントです。以下のAI生成記事を読み、
より検索上位を獲得するために人間が加えるべき独自性のあるコンテンツを5つ提案してください。

# 観点
1. 経験談（実体験ベースの記述）として加えられるもの
2. 一次データ・実測値として加えられるもの
3. 専門家インタビューや引用として加えられるもの
4. ビジュアル（図解・写真・動画）として加えられるもの
5. 競合がカバーしていないニッチ情報

# 記事
${vars.articleHtml.slice(0, 12000)}

# 出力（各提案は60字以内、純粋なJSONのみ）
{
  "advices": [
    { "category": "experience", "suggestion": "..." },
    { "category": "data", "suggestion": "..." },
    { "category": "expert", "suggestion": "..." },
    { "category": "visual", "suggestion": "..." },
    { "category": "niche", "suggestion": "..." }
  ]
}`;
