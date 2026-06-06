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
 * Imagen 等で生成された画像の上に、参考記事風の「黄色バー + 白文字+黒縁取り」のタイトルを描画する。
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

  // タイトルバー領域: 上端から余白 → 高さ 17%
  const barHeight = Math.round(H * 0.17);
  const barY = Math.round(H * 0.04);
  const barMargin = Math.round(W * 0.04);
  const barX = barMargin;
  const barW = W - 2 * barMargin;

  // 影
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  roundedRect(ctx, barX + 4, barY + 6, barW, barHeight, barHeight / 2);
  ctx.fill();
  ctx.restore();

  // 黄色いバー + 黒縁
  ctx.save();
  ctx.fillStyle = '#FFD55F';
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = Math.max(3, Math.round(W * 0.004));
  roundedRect(ctx, barX, barY, barW, barHeight, barHeight / 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // テキスト
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const textMaxWidth = barW - barHeight * 0.6; // バー両端の角丸を避ける
  const cleanTitle = title.replace(/\s+/g, ' ').trim();

  // 1行で収まる font-size を見つける
  let fontSize = Math.round(barHeight * 0.55);
  let lines: string[] = [cleanTitle];
  ctx.font = `900 ${fontSize}px "${FONT_FAMILY}"`;
  let lineWidth = ctx.measureText(cleanTitle).width;

  if (lineWidth > textMaxWidth) {
    // 2行に分割
    fontSize = Math.round(barHeight * 0.36);
    lines = splitTitle(cleanTitle, ctx, textMaxWidth, fontSize);
    ctx.font = `900 ${fontSize}px "${FONT_FAMILY}"`;
    // 各行が幅に収まるまで縮小
    let attempts = 0;
    while (
      attempts < 40 &&
      Math.max(...lines.map((l) => ctx.measureText(l).width)) > textMaxWidth &&
      fontSize > 14
    ) {
      fontSize -= 2;
      ctx.font = `900 ${fontSize}px "${FONT_FAMILY}"`;
      attempts++;
    }
  }

  // 白文字 + 太い黒縁取り
  const lineHeight = fontSize * 1.12;
  const totalH = lineHeight * lines.length;
  const centerY = barY + barHeight / 2;
  const startY = centerY - totalH / 2 + lineHeight / 2;

  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = Math.max(3, Math.round(fontSize * 0.1));
  ctx.lineJoin = 'round';
  ctx.fillStyle = '#FFFFFF';

  for (let i = 0; i < lines.length; i++) {
    const y = startY + i * lineHeight;
    ctx.strokeText(lines[i], W / 2, y);
    ctx.fillText(lines[i], W / 2, y);
  }
  ctx.restore();

  const out = await canvas.encode('png');
  return out.toString('base64');
}
