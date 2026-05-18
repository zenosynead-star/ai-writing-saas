// クレジット機能は無効化（個人ツールとしての利用）
// 旧来の API 呼び出しを互換のため残すが no-op として動作する

export const CREDIT_COST = {
  keyword_theme: 0,
  keyword_url: 0,
  title_generation: 0,
  heading_generation: 0,
  body_standard: 0,
  body_high: 0,
  body_max: 0,
  image_standard: 0,
  image_high: 0,
  rewrite: 0,
  rank_measurement: 0,
  llmo_measurement: 0,
  yakkihou_check: 0,
} as const;

export async function consumeCredits(_opts: {
  userId: string;
  amount: number;
  description: string;
  relatedResourceId?: string;
}): Promise<void> {
  // クレジット消費なし（無制限利用）
  return;
}

export async function grantCredits(_opts: {
  userId: string;
  amount: number;
  reason: string;
  description: string;
}): Promise<void> {
  return;
}
