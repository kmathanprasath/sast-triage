import { useState } from 'react'
import type { ClusterDetail, FindingItem } from '../types'
import { useAllFindings, validateCluster } from '../hooks/useData'

type ValidationStatus = 'true_positive' | 'false_positive' | 'false_negative' | 'true_negative' | 'unreviewed'

const VALIDATION_META: Record<ValidationStatus, { short: string; color: string; bg: string; title: string }> = {
  true_positive:  { short: 'TP', color: '#EF4444', bg: 'rgba(239,68,68,0.15)',  title: 'Real vulnerability, correctly detected' },
  false_positive: { short: 'FP', color: '#10B981', bg: 'rgba(16,185,129,0.15)', title: 'Not a real vulnerability — scanner noise' },
  false_negative: { short: 'FN', color: '#F59E0B', bg: 'rgba(245,158,11,0.15)', title: 'Real vulnerability that was missed' },
  true_negative:  { short: 'TN', color: '#6366F1', bg: 'rgba(99,102,241,0.15)', title: 'Correctly identified as not vulnerable' },
  unreviewed:     { short: '—',  color: '#64748B', bg: 'transparent',           title: 'Not yet reviewed' },
}

const SEV_COLOR: Record<string, string> = {
  CRITICAL: '#EF4444', HIGH: '#F59E0B', MEDIUM: '#C9A84C', LOW: '#10B981',
}

function ValidationButtons({ clusterId, initial }: { clusterId: string; initial: string }) {
  const [status, setStatus] = useState<ValidationStatus>((initial as ValidationStatus) || 'unreviewed')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function handle(s: ValidationStatus) {
    const next = status === s ? 'unreviewed' : s
    setSaving(true); setErr('')
    try {
      await validateCluster(clusterId, next)
      setStatus(next)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
      {(['true_positive', 'false_positive', 'false_negative', 'true_negative'] as ValidationStatus[]).map(s => {
        const m = VALIDATION_META[s]
        const active = status === s
        return (
          <button key={s} title={m.title} disabled={saving}
            onClick={e => { e.stopPropagation(); handle(s) }}
            style={{
              fontSize: 8, fontWeight: 800, padding: '3px 6px', borderRadius: 4,
              cursor: saving ? 'wait' : 'pointer',
              border: `1px solid ${active ? m.color : 'var(--border)'}`,
              background: active ? m.bg : 'transparent',
              color: active ? m.color : 'var(--text-faint)',
              transition: 'all 0.15s',
            }}>{m.short}</button>
        )
      })}
      {err && <span style={{ fontSize: 9, color: '#EF4444' }}>{err}</span>}
    </div>
  )
}

function FindingLine({ f }: { f: FindingItem }) {
  const color = SEV_COLOR[f.severity] || '#94A3B8'
  const fileName = f.file.split('/').pop() || f.file
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '60px 1fr 80px',
      gap: 8, padding: '5px 0', borderBottom: '1px solid var(--border-soft)',
      fontSize: 11, alignItems: 'start',
    }}>
      <span style={{ color, fontWeight: 700, fontFamily: 'monospace', fontSize: 10 }}>
        L{f.line}
        <span style={{ marginLeft: 4, fontSize: 9, opacity: 0.7 }}>{f.severity}</span>
      </span>
      <div>
        <div style={{ color: 'var(--text-dim)', marginBottom: 2 }}>{f.description}</div>
        {f.cwe.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3 }}>
            {f.cwe.slice(0, 2).map(c => (
              <span key={c} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3,
                background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)',
                color: '#C9A84C' }}>{c.split(':')[0]}</span>
            ))}
          </div>
        )}
      </div>
      <span style={{ fontSize: 9, color: 'var(--text-faint)', textAlign: 'right' }}>
        {f.detected_by.join(', ')}
      </span>
    </div>
  )
}

function ClusterRow({ cluster, index }: { cluster: ClusterDetail; index: number }) {
  const [open, setOpen] = useState(false)
  const sevColor = SEV_COLOR[cluster.severity] || '#94A3B8'
  const fileName = cluster.origin_file.split('/').slice(-2).join('/') || cluster.origin_file
  const isNoise = cluster.validation_status === 'false_positive' || cluster.validation_status === 'true_negative'

  return (
    <>
      <tr style={{
        cursor: 'pointer',
        opacity: isNoise ? 0.45 : 1,
        background: open ? 'var(--surface-2)' : undefined,
      }} onClick={() => setOpen(o => !o)}>
        <td style={{ width: 36, textAlign: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)' }}>{index + 1}</span>
        </td>
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: 9, fontWeight: 800, padding: '2px 5px', borderRadius: 3,
              background: sevColor + '18', border: `1px solid ${sevColor}40`, color: sevColor,
            }}>{cluster.severity}</span>
            <span style={{
              fontSize: 12, fontWeight: 600,
              textDecoration: isNoise ? 'line-through' : 'none',
            }}>{cluster.rule_family}</span>
            {cluster.is_accelerating && (
              <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3,
                background: 'rgba(239,68,68,0.12)', border: '1px solid #EF4444', color: '#EF4444' }}>↑ Accel</span>
            )}
          </div>
        </td>
        <td className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {fileName}
        </td>
        <td style={{ textAlign: 'center' }}>
          <span style={{ fontWeight: 800, fontSize: 14, color: sevColor }}>{cluster.blast_radius}</span>
        </td>
        <td style={{ textAlign: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{cluster.urgency_score}/10</span>
        </td>
        <td style={{ textAlign: 'center' }}>
          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3,
            background: cluster.effort_estimate === 'QUICK_WIN' ? 'rgba(16,185,129,0.1)' :
                        cluster.effort_estimate === 'HARD' ? 'rgba(239,68,68,0.1)' : 'rgba(201,168,76,0.1)',
            color: cluster.effort_estimate === 'QUICK_WIN' ? '#10B981' :
                   cluster.effort_estimate === 'HARD' ? '#EF4444' : '#C9A84C',
          }}>{cluster.effort_estimate}</span>
        </td>
        <td onClick={e => e.stopPropagation()}>
          <ValidationButtons clusterId={cluster.cluster_id} initial={cluster.validation_status} />
        </td>
        <td style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>
          {open ? '▲' : '▼'}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} style={{ padding: 0 }}>
            <div style={{ padding: '16px 20px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>

              {/* Justification */}
              <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 8,
                background: 'linear-gradient(135deg,rgba(201,168,76,0.06),rgba(201,168,76,0.02))',
                border: '1px solid rgba(201,168,76,0.2)' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#C9A84C', textTransform: 'uppercase',
                  letterSpacing: '0.08em', marginBottom: 5 }}>Why fixing this kills {cluster.blast_radius} issues</div>
                <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.7 }}>{cluster.justification}</div>
              </div>

              {/* Full file path */}
              <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-faint)',
                marginBottom: 12, padding: '4px 8px', background: 'var(--surface-3)', borderRadius: 4 }}>
                {cluster.origin_file}
              </div>

              {/* Individual findings */}
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)',
                textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                {cluster.findings.length} individual findings
              </div>
              <div style={{ maxHeight: 280, overflowY: 'auto', paddingRight: 4 }}>
                {cluster.findings.map((f, i) => <FindingLine key={f.id || i} f={f} />)}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export default function AllFindings({ service, branch }: { service: string; branch: string }) {
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<'all' | 'unreviewed' | 'tp' | 'fp'>('all')
  const { data, loading, error } = useAllFindings(service, branch, page)

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {[1,2,3,4,5].map(i => (
        <div key={i} style={{ height: 48, borderRadius: 8, background: 'var(--surface-2)',
          animation: 'shimmer 1.5s infinite', backgroundSize: '200% 100%' }} />
      ))}
    </div>
  )

  if (error) return (
    <div style={{ padding: 24, color: '#EF4444', fontSize: 13 }}>Failed to load: {error}</div>
  )

  if (!data) return null

  const filtered = data.clusters.filter(c => {
    if (filter === 'unreviewed') return c.validation_status === 'unreviewed'
    if (filter === 'tp') return c.validation_status === 'true_positive'
    if (filter === 'fp') return c.validation_status === 'false_positive'
    return true
  })

  const tpCount  = data.clusters.filter(c => c.validation_status === 'true_positive').length
  const fpCount  = data.clusters.filter(c => c.validation_status === 'false_positive').length
  const fnCount  = data.clusters.filter(c => c.validation_status === 'false_negative').length
  const tnCount  = data.clusters.filter(c => c.validation_status === 'true_negative').length
  const unCount  = data.clusters.filter(c => c.validation_status === 'unreviewed').length

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Summary strip */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Clusters', val: data.total,  color: 'var(--gold)' },
          { label: 'Unreviewed',     val: unCount,      color: '#64748B' },
          { label: 'True Positive',  val: tpCount,      color: '#EF4444' },
          { label: 'False Positive', val: fpCount,      color: '#10B981' },
          { label: 'False Negative', val: fnCount,      color: '#F59E0B' },
          { label: 'True Negative',  val: tnCount,      color: '#6366F1' },
        ].map(s => (
          <div key={s.label} style={{ padding: '8px 14px', borderRadius: 8,
            background: 'var(--surface-2)', border: '1px solid var(--border)', minWidth: 90 }}>
            <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase',
              letterSpacing: '0.06em', marginBottom: 3 }}>{s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Filter + search bar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>Filter:</span>
        {(['all', 'unreviewed', 'tp', 'fp'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{
              fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
              border: `1px solid ${filter === f ? 'var(--gold)' : 'var(--border)'}`,
              background: filter === f ? 'rgba(201,168,76,0.1)' : 'transparent',
              color: filter === f ? 'var(--gold)' : 'var(--text-faint)',
              cursor: 'pointer',
            }}>
            {f === 'all' ? `All (${data.total})` : f === 'unreviewed' ? `Unreviewed (${unCount})` :
             f === 'tp' ? `TP (${tpCount})` : `FP (${fpCount})`}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-faint)' }}>
          Page {data.page} of {data.pages}
        </span>
      </div>

      {/* Table */}
      <div className="panel" style={{ padding: 0 }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <th>Rule Family</th>
                <th>Origin File</th>
                <th style={{ textAlign: 'center' }}>Kills</th>
                <th style={{ textAlign: 'center' }}>Urgency</th>
                <th style={{ textAlign: 'center' }}>Effort</th>
                <th>Validate</th>
                <th style={{ width: 32 }} />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-faint)' }}>
                  No findings match this filter.
                </td></tr>
              ) : (
                filtered.map((c, i) => (
                  <ClusterRow key={c.cluster_id} cluster={c} index={(page - 1) * 50 + i} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {data.pages > 1 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button className="btn btn-ghost btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
          {Array.from({ length: Math.min(data.pages, 7) }, (_, i) => i + 1).map(p => (
            <button key={p} onClick={() => setPage(p)}
              className={`btn btn-sm ${page === p ? 'btn-primary' : 'btn-ghost'}`}>{p}</button>
          ))}
          <button className="btn btn-ghost btn-sm" disabled={page === data.pages} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}
    </div>
  )
}
