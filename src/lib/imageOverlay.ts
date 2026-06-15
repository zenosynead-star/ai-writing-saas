/**
 * 生成された画像に日本語タイトルバーを合成する。
 *
 * Imagen 4 などの生成モデルは日本語テキスト描画が崩壊するため、
 * 画像生成は「タイトル領域は空」で行い、サーバー側で確実な日本語フォントを使って overlay する。
 *
 * 使うフォント: fonts/NotoSansJP-Black.ttf (Google Fonts noto-sans-jp 900 weight)
 */

import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';
import path from 'path';

let fontReady = false;
const FONT_FAMILY = 'NotoSansJPBlack';

function ensureFont() {
  if (fontReady) return;
  const fontPath = path.join(process.cwd(), 'fonts', 'NotoSansJP-Black.ttf');
  GlobalFonts.registerFromPath(fontPath, FONT_FAMILY);
  fontReady = true;
}

/** 角丸矩形を描画する。 */
function roundedRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** タイトルが1行に収まらない場合、文字単位で改行候補を探して2行に分割する。 */
function splitTitle(title: string, ctx: SKRSContext2D, maxWidth: number, fontSize: number): string[] {
  ctx.font = `900 ${fontSize}px "${FONT_FAMILY}"`;
  if (ctx.measureText(title).width <= maxWidth) return [title];

  // 句読点・スペース近辺で半分くらいの位置で分割を試みる
  const half = Math.floor(title.length / 2);
  const breakChars = new Set(['、', '。', ' ', '！', '？', '・', ':', '：']);
  let splitPos = half;
  for (let delta = 0; delta < half; delta++) {
    for (const sign of [1, -1]) {
      const i = half + sign * delta;
      if (i > 0 && i < title.length && breakChars.has(title[i - 1])) {
        splitPos = i;
        return [title.slice(0, splitPos).trim(), title.slice(splitPos).trim()];
      }
    }
  }
  // 句読点なしならちょうど半分で分割
  return [title.slice(0, splitPos).trim(), title.slice(splitPos).trim()];
}

/**
 * Imagen 等で生成された画像の上に「中央配置の白いカードボックス + 大きな黒文字」のタイトルを描画する。
 *
 * 参考記事スタイル: ブログヘッダー風、中央に白カード、左右にキャラクター/観葉植物が見える。
 */
export async function overlayTitleBar(imageBase64: string, title: string): Promise<string> {
  ensureFont();
  const buf = Buffer.from(imageBase64, 'base64');
  const img = await loadImage(buf);
  const W = img.width;
  const H = img.height;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const cleanTitle = title.replace(/\s+/g, ' ').trim();

  // 中央白カードのレイアウト
  // - 横幅: 画像幅の 60%
  // - 高さ: 画像高さの 36%
  // - 位置: 完全中央
  const boxW = Math.round(W * 0.60);
  const boxH = Math.round(H * 0.36);
  const boxX = Math.round((W - boxW) / 2);
  const boxY = Math.round((H - boxH) / 2);
  const cornerR = Math.round(boxH * 0.10);

  // 影 (やや大きめ)
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  roundedRect(ctx, boxX + 6, boxY + 10, boxW, boxH, cornerR);
  ctx.fill();
  ctx.restore();

  // 白カード + 黒縁
  ctx.save();
  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = Math.max(4, Math.round(W * 0.005));
  roundedRect(ctx, boxX, boxY, boxW, boxH, cornerR);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // テキスト
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const padX = Math.round(boxW * 0.08);
  const textMaxWidth = boxW - 2 * padX;
  const targetTextH = boxH * 0.80;

  // 文字数に応じてフォントサイズを決定 (1〜3行を許容)
  // まずは大きめサイズで開始
  let fontSize = Math.round(boxH * 0.34);
  ctx.font = `900 ${fontSize}px "${FONT_FAMILY}"`;
  let lines: string[] = [cleanTitle];

  if (ctx.measureText(cleanTitle).width > textMaxWidth) {
    // 2行に分割
    lines = splitTitle(cleanTitle, ctx, textMaxWidth, fontSize);
    // 2行用に少し縮小
    fontSize = Math.round(boxH * 0.26);
    ctx.font = `900 ${fontSize}px "${FONT_FAMILY}"`;
    // 各行が幅に収まるまで縮小
    let attempts = 0;
    while (
      attempts < 40 &&
      Math.max(...lines.map((l) => ctx.measureText(l).width)) > textMaxWidth &&
      fontSize > 18
    ) {
      fontSize -= 2;
      ctx.font = `900 ${fontSize}px "${FONT_FAMILY}"`;
      attempts++;
    }
  } else {
    // 1行: ボックス内で最大限大きく
    while (
      ctx.measureText(cleanTitle).width < textMaxWidth * 0.92 &&
      fontSize < boxH * 0.55
    ) {
      fontSize += 2;
      ctx.font = `900 ${fontSize}px "${FONT_FAMILY}"`;
    }
    // 微調整: ちょっとだけ縮小
    while (ctx.measureText(cleanTitle).width > textMaxWidth && fontSize > 18) {
      fontSize -= 2;
      ctx.font = `900 ${fontSize}px "${FONT_FAMILY}"`;
    }
  }

  // 行間とトータルの高さチェック
  const lineHeight = fontSize * 1.15;
  let totalH = lineHeight * lines.length;
  while (totalH > targetTextH && fontSize > 18) {
    fontSize -= 2;
    ctx.font = `900 ${fontSize}px "${FONT_FAMILY}"`;
    totalH = fontSize * 1.15 * lines.length;
  }
  const finalLineHeight = fontSize * 1.15;
  const finalTotalH = finalLineHeight * lines.length;

  const centerY = boxY + boxH / 2;
  const startY = centerY - finalTotalH / 2 + finalLineHeight / 2;

  // 黒文字 (シンプル、ボックスが白なので縁取り不要)
  ctx.fillStyle = '#1a1a1a';

  for (let i = 0; i < lines.length; i++) {
    const y = startY + i * finalLineHeight;
    ctx.fillText(lines[i], W / 2, y);
  }
  ctx.restore();

  const out = await canvas.encode('png');
  return out.toString('base64');
}

/**
 * ローカル生成のプレースホルダー画像（タイトル文字入りのブランド背景）の base64(PNG) を返す。
 * ネットワーク・APIキー・クォータ不要なので「必ず1枚画像を入れる」最終フォールバックに使う。
 * 後段のバックフィルが本物のAI画像へ差し替える前提の“つなぎ”。
 */
export function renderPlaceholderImage(title: string, w = 1280, h = 720): string {
  ensureFont();
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  // ブランド配色のグラデーション背景（濃紺→ティール）
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#0f2a43');
  grad.addColorStop(1, '#1f6f78');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // 内側の薄い枠
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = Math.max(2, Math.round(w * 0.004));
  roundedRect(ctx, w * 0.04, h * 0.06, w * 0.92, h * 0.88, Math.round(h * 0.04));
  ctx.stroke();

  // タイトル文字（中央・最大2行）
  const clean = (title || '').replace(/\s+/g, ' ').trim() || '画像を準備中';
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  const maxW = w * 0.82;
  let fontSize = Math.round(h * 0.13);
  ctx.font = `900 ${fontSize}px "${FONT_FAMILY}"`;
  let lines: string[] = [clean];
  if (ctx.measureText(clean).width > maxW) {
    lines = splitTitle(clean, ctx, maxW, fontSize);
    fontSize = Math.round(h * 0.1);
    ctx.font = `900 ${fontSize}px "${FONT_FAMILY}"`;
    let attempts = 0;
    while (attempts < 40 && Math.max(...lines.map((l) => ctx.measureText(l).width)) > maxW && fontSize > 20) {
      fontSize -= 2;
      ctx.font = `900 ${fontSize}px "${FONT_FAMILY}"`;
      attempts++;
    }
  }
  const lh = fontSize * 1.2;
  const startY = h / 2 - (lh * lines.length) / 2 + lh / 2;
  lines.forEach((l, i) => ctx.fillText(l, w / 2, startY + i * lh));
  ctx.restore();

  return canvas.toBuffer('image/png').toString('base64');
}
