import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, FileUp } from 'lucide-react'
import clsx from 'clsx'
import { backend } from '../backend'
import { useCatalog } from '../hooks/data'
import { CSV_TEMPLATE, exportCsv, planImport, type ImportPlan } from '../lib/csv'
import { errorMessage } from '../lib/format'
import { legacyToCsv, readLegacyComponents } from '../backend/legacy'
import { Notice, Spinner } from '../components/ui'

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const STATUS_STYLE: Record<string, string> = {
  create: 'bg-ok-bg text-ok',
  update: 'bg-label text-ink',
  error: 'bg-out-bg text-out',
  duplicate: 'bg-low-bg text-low',
}

export function StaffImport() {
  const { data: catalog, isLoading } = useCatalog()
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const qc = useQueryClient()
  const legacy = readLegacyComponents()

  if (isLoading || !catalog) return <Spinner className="py-10" />

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setErr(null)
    setDone(null)
    if (file.size > 5 * 1024 * 1024) return setErr('That file is over 5 MB.')
    setFileName(file.name)
    setPlan(planImport(await file.text(), catalog))
  }

  const commit = async () => {
    if (!plan) return
    setBusy(true)
    setErr(null)
    try {
      const r = await backend.importItems(plan.items)
      await qc.invalidateQueries({ queryKey: ['catalog'] })
      setDone(`Imported: ${r.created} new parts, ${r.updated} updated, ${r.stock} stock rows.`)
      setPlan(null)
    } catch (e) {
      setErr(`Nothing was imported. ${errorMessage(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const stamp = new Date().toISOString().slice(0, 10)

  return (
    <div className="max-w-4xl">
      <h1 className="mb-1 text-2xl font-bold">CSV import & export</h1>
      <p className="mb-5 text-ink-2">Inventory a drawer in a spreadsheet, then bring it in here. One row per part per location. Location codes must already exist.</p>

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <button className="btn btn-secondary" onClick={() => download(`hatchery-inventory-${stamp}.csv`, exportCsv(catalog))}>
          <Download className="h-4 w-4" aria-hidden /> Export current inventory
        </button>
        <button className="btn btn-secondary" onClick={() => download('hatchery-import-template.csv', CSV_TEMPLATE)}>
          <Download className="h-4 w-4" aria-hidden /> Download template
        </button>
      </div>

      <section className="card mb-6 p-4">
        <h2 className="mb-2 font-semibold">Import a CSV</h2>
        <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-line-strong bg-canvas p-4 text-center hover:border-ink">
          <FileUp className="h-6 w-6 text-ink-3" aria-hidden />
          <span className="font-semibold">{fileName || 'Choose a .csv file'}</span>
          <span className="text-sm text-ink-3">You’ll see a preview before anything is saved.</span>
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }} />
        </label>
        <details className="mt-3 text-sm text-ink-2">
          <summary className="cursor-pointer font-semibold text-ink">Column guide</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li><code>name</code> (required), <code>value</code> like 220 Ω or 100 µF, <code>part_number</code>, <code>category</code>, <code>package</code>, <code>manufacturer</code></li>
            <li><code>aliases</code>: separate with semicolons. <code>published</code>: yes / no (blank = draft)</li>
            <li><code>location_code</code>: the drawer label, e.g. A-03. <code>quantity</code>: leave blank for bulk parts nobody counts.</li>
            <li><code>stock_status</code>: in_stock, low, out, or unverified. <code>last_checked</code>: 2026-11-16</li>
            <li><code>part_id</code>: only from an export; use it to update a specific existing part.</li>
          </ul>
        </details>
      </section>

      {err && <div className="mb-4"><Notice tone="error">{err}</Notice></div>}
      {done && <div className="mb-4"><Notice tone="ok">{done}</Notice></div>}

      {plan && (
        <section className="card mb-6 p-4" aria-labelledby="preview-h">
          <h2 id="preview-h" className="mb-2 font-semibold">Preview</h2>
          {plan.fatal ? (
            <Notice tone="error">{plan.fatal}</Notice>
          ) : (
            <>
              <p className="mb-3 text-sm">
                <strong>{plan.summary.create}</strong> new parts · <strong>{plan.summary.update}</strong> updates · <strong>{plan.summary.stockRows}</strong> stock rows
                {plan.summary.errors > 0 && <> · <strong className="text-out">{plan.summary.errors} invalid</strong></>}
                {plan.summary.duplicates > 0 && <> · <strong className="text-low">{plan.summary.duplicates} duplicate</strong></>}
              </p>
              <div className="max-h-[28rem] overflow-auto rounded border border-line">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-label">
                    <tr><th className="p-2">Line</th><th className="p-2">Result</th><th className="p-2">Part</th><th className="p-2">Location</th><th className="p-2">Notes</th></tr>
                  </thead>
                  <tbody>
                    {plan.rows.map((r) => (
                      <tr key={r.line} className="border-t border-line align-top">
                        <td className="p-2 font-mono text-ink-3">{r.line}</td>
                        <td className="p-2"><span className={clsx('rounded px-1.5 py-0.5 text-xs font-bold uppercase', STATUS_STYLE[r.status])}>{r.status}</span></td>
                        <td className="p-2">{r.partLabel || '—'}</td>
                        <td className="p-2 font-mono">{r.locationCode || '—'}</td>
                        <td className="p-2 text-ink-2">{r.messages.join(' ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button className="btn btn-primary" disabled={busy || plan.items.length === 0} onClick={commit}>
                  {busy ? 'Importing…' : `Import ${plan.items.length} part${plan.items.length === 1 ? '' : 's'}`}
                </button>
                {plan.summary.errors + plan.summary.duplicates > 0 && (
                  <span className="text-sm text-ink-2">Invalid and duplicate rows are skipped. Fix them in the spreadsheet and import again.</span>
                )}
                <button className="btn btn-ghost" onClick={() => setPlan(null)}>Cancel</button>
              </div>
            </>
          )}
        </section>
      )}

      {legacy.length > 0 && (
        <section className="card p-4">
          <h2 className="font-semibold">Parts from the old Eagle Circuit Library</h2>
          <p className="mt-1 text-sm text-ink-2">
            This browser has {legacy.length} part{legacy.length === 1 ? '' : 's'} someone added in the old app (its built-in sample parts are left out). Download them as a CSV, add location codes and stock, then import.
          </p>
          <button className="btn btn-secondary btn-sm mt-3" onClick={() => download('eagle-circuit-library-legacy.csv', legacyToCsv(legacy))}>
            <Download className="h-4 w-4" aria-hidden /> Download legacy parts CSV
          </button>
        </section>
      )}
    </div>
  )
}
