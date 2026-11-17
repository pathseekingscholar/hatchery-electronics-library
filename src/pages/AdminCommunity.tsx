import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, EyeOff, MessagesSquare, Trash2, Undo2 } from 'lucide-react'
import clsx from 'clsx'
import { backend } from '../backend'
import { errorMessage } from '../lib/format'
import type { CommunityPost, PostStatus } from '../lib/types'
import { EmptyState, ErrorState, Notice, SkeletonRows } from '../components/ui'
import { PostCard, usePosts } from './Community'

const TABS: Array<{ key: PostStatus; label: string }> = [
  { key: 'pending', label: 'Waiting for review' },
  { key: 'approved', label: 'Published' },
  { key: 'hidden', label: 'Hidden' },
]

export function AdminCommunity() {
  const { data: posts, error, isLoading, refetch } = usePosts()
  const [tab, setTab] = useState<PostStatus>('pending')
  const list = (posts ?? []).filter((p) => p.status === tab)
  const count = (s: PostStatus) => (posts ?? []).filter((p) => p.status === s).length

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-extrabold tracking-tight">Community moderation</h1>
      <p className="mb-5 text-ink-2">New posts stay private until you publish them.</p>
      <div role="tablist" aria-label="Post status" className="mb-5 flex gap-1 rounded-2xl bg-label/70 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              'min-h-10 flex-1 rounded-xl px-3 text-sm font-semibold transition-colors',
              tab === t.key ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink',
            )}
          >
            {t.label} <span className="text-ink-3">{count(t.key)}</span>
          </button>
        ))}
      </div>
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <SkeletonRows count={3} />
      ) : list.length === 0 ? (
        <EmptyState title={tab === 'pending' ? 'All caught up' : 'Nothing here'} icon={<MessagesSquare className="h-8 w-8" />} />
      ) : (
        <ul className="space-y-4" role="tabpanel">
          {list.map((p) => <ModerationCard key={p.id} post={p} />)}
        </ul>
      )}
    </div>
  )
}

function ModerationCard({ post }: { post: CommunityPost }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setErr(null)
    try {
      await fn()
      await qc.invalidateQueries({ queryKey: ['posts'] })
    } catch (e) {
      setErr(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <PostCard post={post}>
      {err && <div className="mt-3"><Notice tone="error">{err}</Notice></div>}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
        {post.status !== 'approved' && (
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(() => backend.moderatePost(post.id, 'approved'))}>
            <Check className="h-4 w-4" aria-hidden /> Publish
          </button>
        )}
        {post.status !== 'hidden' && (
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => run(() => backend.moderatePost(post.id, 'hidden'))}>
            <EyeOff className="h-4 w-4" aria-hidden /> Hide
          </button>
        )}
        {post.status === 'hidden' && (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => backend.moderatePost(post.id, 'pending'))}>
            <Undo2 className="h-4 w-4" aria-hidden /> Back to review
          </button>
        )}
        <button
          className="btn btn-ghost btn-sm ml-auto text-out"
          disabled={busy}
          onClick={() => confirm('Delete this post permanently?') && run(() => backend.deletePost(post.id))}
        >
          <Trash2 className="h-4 w-4" aria-hidden /> Delete
        </button>
      </div>
    </PostCard>
  )
}
