'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function DeleteArticleButton({
  articleId,
  title,
}: {
  articleId: string;
  title: string;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  const onDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const label = title || '（無題）';
    if (!confirm(`「${label}」を削除しますか?\nこの操作は取り消せません。`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/articles/${articleId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || '削除に失敗しました');
        return;
      }
      router.refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <button
      onClick={onDelete}
      disabled={deleting}
      className="text-red-600 hover:text-red-800 disabled:opacity-50 text-xs px-2 py-1 rounded hover:bg-red-50 transition-colors"
      aria-label={`「${title || '無題'}」を削除`}
    >
      {deleting ? '削除中…' : '削除'}
    </button>
  );
}
