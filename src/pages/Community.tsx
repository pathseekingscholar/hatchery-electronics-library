import { useState, type FormEvent, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useUser } from '../hooks/data'
import { CheckCircle2, HelpCircle, Lightbulb, MessagesSquare, PenLine, Wrench } from 'lucide-react'
import clsx from 'clsx'
import { backend } from '../backend'
import { errorMessage, relativeDate } from '../lib/format'
import type { CommunityPost, PostKind } from '../lib/types'
import { EmptyState, ErrorState, Modal, Notice, SkeletonRows } from '../components/ui'

export const KINDS: Record<PostKind, { label: string; plural: string; icon: typeof Wrench; cls: string }> = {
  project: { label: 'Project', plural: 'Projects', icon: Wrench, cls: 'bg-maroon-tint text-maroon-dark' },
  question: { label: 'Question', plural: 'Questions', icon: HelpCircle, cls: 'bg-gold-tint text-gold-dark' },
  tip: { label: 'Tip', plural: 'Tips', icon: Lightbulb, cls: 'bg-ok-bg text-ok' },
}

export function usePosts() {
  return useQuery({ queryKey: ['posts'], queryFn: () => backend.listPosts(), staleTime: 30_000 })
}

export function PostCard({ post, children }: { post: CommunityPost; children?: ReactNode }) {
  const k = KINDS[post.kind]
  const Icon = k.icon
  return (
    <li className="card p-5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={clsx('inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold', k.cls)}>
          <Icon className="h-3.5 w-3.5" aria-hidden /> {k.label}
        </span>
        <span className="text-ink-3">
          {post.authorName || 'Anonymous'} · {relativeDate(post.createdAt)}
        </span>
      </div>
      <h2 className="mt-3 text-lg font-bold leading-snug">{post.title}</h2>
      <p className="mt-1.5 whitespace-pre-line text-ink-2">{post.body}</p>
      {children}
    </li>
  )
}

export function Community() {
  const { data: posts, error, isLoading, refetch } = usePosts()
  const [filter, setFilter] = useState<PostKind | ''>('')
  const [composing, setComposing] = useState(false)
  const { data: user } = useUser()
  const visible = (posts ?? []).filter((p) => p.status === 'approved' && (!filter || p.kind === filter))

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-maroon-tint text-maroon">
            <MessagesSquare className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Community</h1>
            <p className="mt-1 text-ink-2">Show what you built, ask a question, or share a tip with other makers.</p>
          </div>
        </div>
        {user ? (
          <button className="btn btn-primary" onClick={() => setComposing(true)}>
            <PenLine className="h-5 w-5" aria-hidden /> Share something
          </button>
        ) : (
          <Link to="/signin?next=/community" className="btn btn-primary">
            <PenLine className="h-5 w-5" aria-hidden /> Sign in to post
          </Link>
        )}
      </div>

      <div role="group" aria-label="Filter posts" className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {([['', 'All'], ...Object.entries(KINDS).map(([k, v]) => [k, v.plural])] as Array<[PostKind | '', string]>).map(([k, label]) => (
          <button
            key={k || 'all'}
            aria-pressed={filter === k}
            onClick={() => setFilter(k)}
            className={clsx(
              'min-h-10 whitespace-nowrap rounded-xl border px-4 text-sm font-medium transition-colors',
              filter === k ? 'border-maroon bg-maroon text-white' : 'border-line bg-surface text-ink-2 hover:border-gold-light hover:bg-gold-tint',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <SkeletonRows count={3} />
      ) : visible.length === 0 ? (
        <EmptyState title="Nothing here yet" icon={<MessagesSquare className="h-8 w-8" />}>
          Be the first to share a project, question, or tip.
        </EmptyState>
      ) : (
        <ul className="space-y-4">{visible.map((p) => <PostCard key={p.id} post={p} />)}</ul>
      )}

      {user && (posts ?? []).some((p) => p.status === 'pending') && user.role === 'member' && (
        <p className="mt-6 text-center text-sm text-ink-3">You have posts waiting for staff review. They’ll appear here once approved.</p>
      )}

      {user && <ComposeDialog open={composing} onClose={() => setComposing(false)} defaultName={user.displayName} />}
    </div>
  )
}

function ComposeDialog({ open, onClose, defaultName }: { open: boolean; onClose: () => void; defaultName: string }) {
  const [kind, setKind] = useState<PostKind>('project')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [author, setAuthor] = useState(defaultName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const qc = useQueryClient()

  const close = () => {
    onClose()
    setTimeout(() => {
      setDone(false)
      setError(null)
    }, 200)
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await backend.submitPost({ kind, title, body, authorName: author })
      setDone(true)
      setTitle('')
      setBody('')
      qc.invalidateQueries({ queryKey: ['posts'] })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={close} title={done ? 'Thanks for sharing!' : 'Share with the community'} wide>
      {done ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-ok" aria-hidden />
            <p className="text-ink-2">Your post was sent. It will appear on the Community page once a staff member has reviewed it.</p>
          </div>
          <button className="btn btn-primary w-full" onClick={close}>Done</button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div role="radiogroup" aria-label="Post type" className="grid grid-cols-3 gap-2">
            {(Object.keys(KINDS) as PostKind[]).map((k) => {
              const Icon = KINDS[k].icon
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  key={k}
                  onClick={() => setKind(k)}
                  className={clsx(
                    'flex min-h-12 items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition-colors',
                    kind === k ? 'border-maroon bg-maroon-tint text-maroon-dark' : 'border-line text-ink-2 hover:bg-gold-tint',
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden /> {KINDS[k].label}
                </button>
              )
            })}
          </div>
          <div>
            <label className="label" htmlFor="post-title">Title</label>
            <input id="post-title" className="field" required minLength={3} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'question' ? 'What do you want to know?' : kind === 'tip' ? 'Your tip in a few words' : 'What did you build?'} />
          </div>
          <div>
            <label className="label" htmlFor="post-body">Details</label>
            <textarea id="post-body" className="field min-h-32" required maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Parts you used, what worked, what didn’t…" />
            <p className="mt-1 text-right text-xs text-ink-3">{body.length}/4000</p>
          </div>
          <div>
            <label className="label" htmlFor="post-author">Name to show <span className="font-normal text-ink-3">(optional)</span></label>
            <input id="post-author" className="field" maxLength={80} value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Leave blank to post anonymously" />
          </div>
          <p className="text-xs text-ink-3">Posts are public after staff review. Please don’t include phone numbers, emails, or other personal details.</p>
          {error && <Notice tone="error">{error}</Notice>}
          <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Sending…' : 'Submit for review'}</button>
        </form>
      )}
    </Modal>
  )
}
