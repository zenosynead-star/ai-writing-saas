import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AI Writing SaaS',
  description: 'SEO/LLMO向けAIライティングプラットフォーム',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
