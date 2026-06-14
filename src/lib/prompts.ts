// 要件定義書 5章のプロンプト設計をTypeScript側に実装
// 本来はDB管理(PromptTemplate)するが、初期はコード側のシードを使用

export const KEYWORD_EXPLORE_PROMPT = (vars: {
  theme: string;
  language: string;
  competitorTitles?: string[];
  cooccurrenceWords?: string[];
}) => `あなたはSEOコンサルティングの専門家です。
以下のテーマについて、SEO対策として狙う価値のある検索キーワードを20個提案してください。

テーマ: ${vars.theme}
対象言語: ${vars.language}
${
  vars.competitorTitles && vars.competitorTitles.length > 0
    ? `\n# 実際の検索上位記事タイトル（このテーマで現在上位表示されている記事。狙うべきKWの実態を反映）\n${vars.competitorTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
    : ''
}
${
  vars.cooccurrenceWords && vars.cooccurrenceWords.length > 0
    ? `\n# 上位記事の頻出語（共起語。関連KWの種として活用）\n${vars.cooccurrenceWords.join('、')}`
    : ''
}

提案するキーワードの条件:
1. 月間検索ボリュームが100以上見込まれるもの
2. 商業的価値があるもの（購買・問い合わせ意図を含むもの）を優先
3. ロングテール（3-4語の複合キーワード）を50%以上含めること
4. 顕在ニーズと潜在ニーズの両方をカバーすること
5. 同じ意図を持つキーワードの重複を避けること
6. 上記の競合タイトル・共起語から読み取れる「実際に検索されている語」を反映すること

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
  cooccurrenceWords?: string[];
  avgWordCount?: number;
  maxHeadingCount?: number;
  commonTopics?: string[];
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

# 競合分析の活用方針（最重要）
${
  vars.competitorHeadings
    ? `以下は検索上位の競合ページから実際に抽出した見出し構成です。必ず分析し:
- 競合の **過半数が共通して扱っているトピック** は自記事にも必ず含める（網羅性の担保）
- 競合が **誰も扱っていない切り口・抜け** を1〜2個見つけて独自の見出しとして追加する（差別化）
- 競合の見出しを **そのまま流用せず**、より分かりやすい表現に再構成する（Googleは多様性を評価）

【競合上位ページの実見出し】
${vars.competitorHeadings}`
    : '競合上位ページの見出し: （取得できなかったため、検索意図から網羅的に構成すること）'
}
${
  vars.cooccurrenceWords && vars.cooccurrenceWords.length > 0
    ? `\n# 共起語（競合上位で頻出した重要語）\n以下の語は検索上位記事で繰り返し使われている重要トピックです。関連する見出しに自然に反映し、網羅性を高めてください（不自然な詰め込みは禁止）:\n${vars.cooccurrenceWords.join('、')}`
    : ''
}
${
  vars.commonTopics && vars.commonTopics.length > 0
    ? `\n# 必須網羅トピック（複数の競合が共通で扱う＝検索意図の中核。漏らさず見出しに反映）\n${vars.commonTopics.join('、')}`
    : ''
}
${
  vars.avgWordCount && vars.avgWordCount > 0
    ? `\n# ボリューム/見出し数の目標（競合超え）\n競合上位の平均本文量は約${vars.avgWordCount}文字${vars.maxHeadingCount && vars.maxHeadingCount > 0 ? `、最大見出し数は${vars.maxHeadingCount}個` : ''}です。網羅性で競合を上回るため、${vars.maxHeadingCount && vars.maxHeadingCount > 0 ? `見出し総数は${vars.maxHeadingCount + 2}個以上を目安に、` : ''}競合が扱う全トピックを含めた上で独自トピックを1〜2個追加してください。`
    : ''
}

# 出力ルール
1. h2見出しは5〜9個（競合の網羅性を上回る数）。各h2の下にh3を1〜4個。必要に応じてh4も。
2. 結論を先に求めるユーザー向けに、最初のh2は「結論」「概要」系を配置可。
3. 最後のh2は必ず「まとめ」または相当する括り。
4. 各見出しにキーワードを詰め込みすぎない（自然な日本語）。
5. FAQセクションをh2として含めることを推奨（強調スニペット狙い）。
${vars.userCustomInstruction ? `\n# ユーザー追加指示\n${vars.userCustomInstruction}` : ''}

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
  cooccurrenceWords?: string[];
  webContext?: string;
  relatedArticles?: Array<{ id: string; title: string }>;
  targetChars?: number;
  competitorHeadings?: string;
  commonTopics?: string[];
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
${vars.targetChars ? `\n# 文字数の必達目標（競合超え）\nこの記事は競合上位を内容量で上回るため、本文合計 **${vars.targetChars} 文字以上** を必達とします（下回ると不合格）。水増しや繰り返しではなく、具体例・手順・数値・比較・FAQ で実質的に充実させること。` : ''}
${
  vars.cooccurrenceWords && vars.cooccurrenceWords.length > 0
    ? `\n# 共起語（必ず自然に含める重要語）\n検索上位記事で頻出する以下の語を、文脈に合う箇所で自然に使ってください（SEOの網羅性に直結。ただし不自然な羅列は禁止）:\n${vars.cooccurrenceWords.join('、')}`
    : ''
}
${
  vars.webContext
    ? `\n# 最新の参考情報（Web検索で取得した信頼できる情報。事実確認に活用し、古い情報や誤りを避けること）\n${vars.webContext}`
    : ''
}
${
  vars.relatedArticles && vars.relatedArticles.length > 0
    ? `\n# 内部リンク（関連記事への発リンク。SEOの回遊性向上に必須）\n以下は同サイトの既存記事です。本文の文脈に自然に合うものを2〜4本選び、該当箇所に内部リンクを挿入してください。\n形式: <a href="/articles/{id}">記事タイトルに沿った自然なアンカーテキスト</a>\n- 無理に全部使わず、文脈が合うものだけ。同じ記事へのリンクは1回まで。\n- アンカーテキストは「こちら」等ではなく内容が分かる語にする。\n${vars.relatedArticles.map((a) => `  - id=${a.id} : ${a.title}`).join('\n')}`
    : ''
}
${
  vars.commonTopics && vars.commonTopics.length > 0
    ? `\n# 必須網羅トピック（競合が共通で扱う中核。各トピックを本文で必ず具体的に扱う）\n${vars.commonTopics.join('、')}`
    : ''
}
${
  vars.competitorHeadings
    ? `\n# 競合上位の見出し構成（内容量・具体性で上回ること。全トピックを網羅し、競合に無い切り口も足す）\n${vars.competitorHeadings}`
    : ''
}

# 構成（厳守）
${vars.headingTree}

# 執筆ルール

## 必須事項
1. 上記の見出し構造を一切変更しない（追加・削除・順序入替不可）
2. **各h2セクションは最低400字（必須）**、h3セクションは最低200字。薄いセクションを作らない
3. 最初の100字以内にターゲットキーワードを含む（リード文）
4. キーワード密度は2〜4%を目安（過度な詰め込みは禁止）
5. PREP法（結論→理由→具体例→結論）を基本構造とする
6. **本文は合計 ${vars.targetChars ? vars.targetChars : 3500} 文字以上（必須・"目安"ではない）**。競合を内容量・網羅性で上回ることが最優先。水増しせず、具体例・手順・数値・比較・FAQ で実質的に充実させる

## 文体ルール
- 「です・ます」調で統一（指定があればそれに従う）
- 一文を80字以内に収める（読みやすさ優先）
- 接続詞を多用しない（特に「そして」「また」の連発禁止）
- 体言止め・倒置法を効果的に使う

## 文字装飾（自動・読みやすさとCV重視。必ず適用）
- **重要キーワード・結論**は <strong> で強調（各h2セクションに2〜4回、多用しすぎない）
- セクション内で**最も伝えたい一文**は <mark> でハイライト（各h2に最大1回）
- 補足・コツ・注意喚起は <blockquote> で囲んで目立たせる（「💡ポイント」「⚠注意」等の小見出しを文頭に）
- 比較・スペック・料金・手順は必ず <table>（thead付き）または <ul>/<ol> で構造化（ベタ書きの羅列を避ける）
- 数値・固有名詞・型番は <strong> で視認性を上げる
- 箇条書きの各項目は「**項目名**: 説明」の形で項目名を太字にする
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

/** 文字数・網羅が不足した本文を、既存構造を保ったまま増補するプロンプト（自動増補パス用）。 */
export const EXPAND_BODY_PROMPT = (vars: {
  title: string;
  currentChars: number;
  targetChars: number;
  bodyHtml: string;
  missingTopics?: string[];
}) => `# 役割
あなたはSEO記事の編集者です。以下の記事本文は文字数・網羅性が不足しています。競合上位を上回るために増補してください。

# 現状
タイトル: ${vars.title}
現在の本文量: 約${vars.currentChars}文字 / 目標: ${vars.targetChars}文字以上
${vars.missingTopics && vars.missingTopics.length > 0 ? `未カバーの重要トピック（必ず本文に追加して具体的に扱う）: ${vars.missingTopics.join('、')}` : ''}

# 増補ルール（厳守）
1. **既存の見出し構造・本文・内部リンク(<a>)・装飾(<strong>/<mark>/<blockquote>/<table>/<ul>/<ol>)はそのまま残す**（削除・改変しない）
2. 各セクションに具体例・手順・数値・比較表・FAQ・注意点を加えて自然に厚くする（水増し・同義反復は禁止）
3. 未カバーの重要トピックは、適切なセクション内 or 新規 h2/h3 として追加して扱う
4. 文体・トーンは既存に合わせる（です・ます調）。事実は正確に、不確かな数値は書かない
5. 文字装飾ルールは本文生成時と同じ（重要語 <strong>、最重要文 <mark>、補足 <blockquote>、比較/手順は <table>/<ul>）
6. **本文合計 ${vars.targetChars} 文字以上**になるまで充実させる

# 入力（この本文を増補して返す）
${vars.bodyHtml}

# 出力形式
増補後の**本文HTMLのみ**を出力（前後に説明文やマークダウンを付けない）。末尾の <!-- META: ... --> コメントがあれば保持する。`;

export const REWRITE_GENERATION_PROMPT = (vars: {
  sourceUrl: string;
  originalTitle: string;
  originalMeta: string;
  originalHeadingsMarkdown: string;
  originalBodySummary: string; // 主要段落の連結（長すぎる場合は切り詰め）
  mode: 'structure_preserve' | 'restructure' | 'partial';
  additionalInstruction?: string;
}) => {
  const modeInstructions = {
    structure_preserve: '見出し構造は元記事を維持しつつ、本文の質を向上させる（情報追加・冗長な箇所の削除・E-E-A-T要素の強化）。',
    restructure: '元記事の論点は活かしつつ、見出し構成をSEO観点で最適化する（重複の統合・抜けの補完・FAQ追加）。',
    partial: '元記事の冒頭リード文とまとめだけを刷新する（中間の見出しは触らない）。',
  } as const;

  return `# 役割
あなたはSEOの専門家で、既存記事のリライトを担当しています。
以下の方針に従い、元記事を改善した新しい記事をHTML形式で出力してください。

# 元記事
URL: ${vars.sourceUrl}
タイトル: ${vars.originalTitle}
メタディスクリプション: ${vars.originalMeta}

## 元記事の見出し構成
${vars.originalHeadingsMarkdown || '（見出し抽出失敗、本文から推測してください）'}

## 元記事の本文要約
${vars.originalBodySummary.slice(0, 6000)}

# リライトモード
${modeInstructions[vars.mode]}

# 追加指示
${vars.additionalInstruction || '（なし）'}

# 執筆ルール
1. 元記事の本文をそのままコピーしない。表現を変え、独自性を出す。
2. 検索意図とNeeds Met基準を満たす網羅性を確保。
3. E-E-A-T要素（経験・専門性・権威性・信頼性）を1箇所以上追加する余地を [実例:〇〇] タグで明示。
4. キーワード密度2〜4%、PREP法を基本構造に。
5. 「です・ます」調で統一、1文80字以内。
6. <strong> で重要キーワードを強調（h2あたり1-2回）。
7. 不確かな数値・固有名詞は出力しない（ハルシネーション防止）。
8. 競合記事や元記事との明らかな類似（パラフレーズで多様性確保）。

# 禁止事項
- AI由来であることを示唆する表現
- 同じ表現を3回以上繰り返す
- 「いかがでしたか？」「ぜひ参考にしてください」等の定型句
- <script>, <iframe>, <style>, onclick等のイベントハンドラ

# 出力形式
純粋なHTML形式のみ。前後に説明文・マークダウン・コードフェンスを付けない。
- リード文: <p>（h2の前）
- 各セクション: <h2>/<h3>/<p>/<ul>/<ol>/<table>/<strong>
- まとめ: 最後の<h2>と<p>
- 末尾にメタディスクリプションを <!-- META: ... --> 形式で（120字以内）`;
};

export const CATEGORY_PICK_PROMPT = (vars: {
  title: string;
  keywords: string[];
  categories: Array<{ id: number; name: string }>;
}) => `あなたはWordPressメディアの編集者です。以下の記事を、既存カテゴリの中から最も適切なもの1つ（必要なら2つまで）に分類してください。
新規カテゴリは作らず、必ず下記リストの id から選ぶこと。

# 記事
タイトル: ${vars.title}
キーワード: ${vars.keywords.join('、')}

# 既存カテゴリ（id: 名前）
${vars.categories.map((c) => `${c.id}: ${c.name}`).join('\n')}

# 出力（純粋なJSONのみ。最も適切なカテゴリidを1〜2個）
{ "category_ids": [12], "reason": "選定理由（30字以内）" }`;

export const PHARMA_CHECK_PROMPT = (vars: { articleHtml: string }) => `あなたは日本の薬機法（医薬品医療機器等法）・景品表示法に精通したコンプライアンス専門家です。
以下の記事本文を精査し、薬機法・景表法に抵触する恐れのある表現を抽出してください。

# チェック観点
1. 医薬品的な効能効果の標榜（化粧品・健康食品・雑貨で「治る」「効く」「改善」等）
2. 身体の組織機能への影響を示す表現（「痩せる」「デトックス」「免疫力が上がる」等）
3. 安全性・即効性の保証（「副作用なし」「100%安全」「必ず」「最短〇日」等）
4. 最大級・No.1表現で根拠不明のもの（景表法の優良誤認）
5. 体験談・口コミによる効果の暗示

# 記事本文
${vars.articleHtml.slice(0, 14000)}

# 出力（純粋なJSONのみ。問題がなければ findings を空配列に）
{
  "summary": "全体所見（40字以内）",
  "risk_level": "low | medium | high",
  "findings": [
    {
      "phrase": "問題のある表現（原文ママ・30字以内）",
      "reason": "なぜ問題か（40字以内）",
      "suggestion": "言い換え案（40字以内）",
      "severity": "low | medium | high"
    }
  ]
}`;

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
