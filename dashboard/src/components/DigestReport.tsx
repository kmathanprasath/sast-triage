import { useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'
import type { DigestReport, DebtTrend, FixItem } from '../types'
import { exportDigestPdf } from '../utils/exportPdf'
import { validateCluster } from '../hooks/useData'

type ValidationStatus = 'true_positive' | 'false_positive' | 'false_negative' | 'true_negative' | 'unreviewed'

const VALIDATION_META: Record<ValidationStatus, { label: string; short: string; color: string; bg: string; title: string }> = {
  true_positive:  { label: 'True Positive',  short: 'TP', color: '#EF4444', bg: 'rgba(239,68,68,0.15)',   title: 'Real vulnerability, correctly detected' },
  false_positive: { label: 'False Positive', short: 'FP', color: '#10B981', bg: 'rgba(16,185,129,0.15)',  title: 'Not a real vulnerability — scanner noise' },
  false_negative: { label: 'False Negative', short: 'FN', color: '#F59E0B', bg: 'rgba(245,158,11,0.15)',  title: 'Real vulnerability that was missed' },
  true_negative:  { label: 'True Negative',  short: 'TN', color: '#6366F1', bg: 'rgba(99,102,241,0.15)',  title: 'Correctly identified as not vulnerable' },
  unreviewed:     { label: 'Unreviewed',      short: '—',  color: '#64748B', bg: 'transparent',            title: 'Not yet reviewed' },
}

const EFFORT_META: Record<string, { label: string; badge: string }> = {
  QUICK_WIN: { label: 'Quick Win', badge: 'badge-green'  },
  MEDIUM:    { label: 'Medium',    badge: 'badge-orange' },
  HARD:      { label: 'Hard',      badge: 'badge-red'    },
}
// Gold → Emerald → Amber → Purple → Red
const RANK_COLORS = ['#C9A84C', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444']
const CHART_COLORS = ['#C9A84C', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#3B82F6']

function FindingRow({ item, rank, expanded, onToggle }: {
  item: FixItem; rank: number; expanded: boolean; onToggle: () => void
}) {
  const effort    = EFFORT_META[item.effort] ?? { label: item.effort, badge: 'badge-gray' }
  const rankColor = RANK_COLORS[rank - 1] ?? '#94A3B8'
  const [validation, setValidation] = useState<ValidationStatus>(
    (item.validation_status as ValidationStatus) ?? 'unreviewed'
  )
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  async function handleValidate(status: ValidationStatus) {
    if (!item.cluster_id || saving) return
    const next = validation === status ? 'unreviewed' : status  // toggle off if same
    setSaving(true)
    setError('')
    try {
      await validateCluster(item.cluster_id, next)
      setValidation(next)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const current = VALIDATION_META[validation]
  const rowBg =
    validation === 'false_positive' ? 'rgba(16,185,129,0.04)' :
    validation === 'true_positive'  ? 'rgba(239,68,68,0.04)'  :
    validation === 'false_negative' ? 'rgba(245,158,11,0.04)' :
    validation === 'true_negative'  ? 'rgba(99,102,241,0.04)' : undefined

  return (
    <>
      <tr style={{ cursor: 'pointer', background: rowBg }} onClick={onToggle}>
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 24, height: 24, borderRadius: '50%',
              background: rankColor + '18', border: `1.5px solid ${rankColor}50`,
              color: rankColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 800, flexShrink: 0,
            }}>{rank}</div>
            <span style={{
              fontWeight: 600, fontSize: 12, letterSpacing: '-0.01em',
              textDecoration: validation === 'false_positive' || validation === 'true_negative' ? 'line-through' : 'none',
              opacity: validation === 'false_positive' || validation === 'true_negative' ? 0.5 : 1,
            }}>{item.rule_family}</span>
            {validation !== 'unreviewed' && (
              <span style={{
                fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 4,
                background: current.bg, border: `1px solid ${current.color}`, color: current.color,
                letterSpacing: '0.05em', flexShrink: 0,
              }}>{current.short}</span>
            )}
          </div>
        </td>
        <td className="mono" style={{ opacity: validation === 'false_positive' || validation === 'true_negative' ? 0.4 : 1 }}>
          {item.origin_file}
        </td>
        <td><span className={`badge ${effort.badge}`}>{effort.label}</span></td>
        <td style={{ textAlign: 'center' }}>
          <span style={{ fontWeight: 700, color: rankColor, fontSize: 14 }}>{item.kills_issues}</span>
        </td>
        <td style={{ textAlign: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text-dim)" }}>{item.kills_files ?? item.blast_radius} files</span>
        </td>
        <td onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', gap: 3, justifyContent: 'center', flexWrap: 'wrap' }}>
            {(['true_positive', 'false_positive', 'false_negative', 'true_negative'] as ValidationStatus[]).map(s => {
              const m = VALIDATION_META[s]
              const active = validation === s
              return (
                <button key={s} title={m.title} disabled={saving}
                  onClick={() => handleValidate(s)}
                  style={{
                    fontSize: 8, fontWeight: 800, padding: '3px 6px', borderRadius: 4,
                    cursor: saving ? 'wait' : 'pointer',
                    border: `1px solid ${active ? m.color : 'var(--border)'}`,
                    background: active ? m.bg : 'transparent',
                    color: active ? m.color : 'var(--text-faint)',
                    transition: 'all 0.15s',
                    opacity: saving ? 0.6 : 1,
                  }}>{m.short}</button>
              )
            })}
          </div>
          {error && <div style={{ fontSize: 9, color: '#EF4444', textAlign: 'center', marginTop: 2 }}>{error}</div>}
        </td>
        <td style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: 14 }}>
          {expanded ? '▲' : '▼'}
        </td>
      </tr>
      {expanded && (
        <tr className="expand-row">
          <td colSpan={7}>
            {/* Cascade impact banner */}
            <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 8,
              background: 'linear-gradient(135deg,rgba(239,68,68,0.06),rgba(201,168,76,0.04))',
              border: '1px solid rgba(201,168,76,0.25)' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#C9A84C', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>
                Cascade Impact � fixing this pattern kills {item.kills_issues} issues across {item.kills_files ?? item.blast_radius} files
              </div>
              <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.7 }}>{item.why_dangerous}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Root Fix � apply once, resolves everywhere</div>
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: '3px solid var(--emerald)', borderRadius: 8, padding: '12px 16px', fontSize: 12, lineHeight: 1.7 }}>
                  {item.exact_fix}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Validation:</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: current.color }}>{current.label}</span>
              {validation !== 'unreviewed' && (
                <button onClick={e => { e.stopPropagation(); handleValidate('unreviewed') }}
                  style={{ fontSize: 9, color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                  reset
                </button>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export default function DigestReportPanel({ data, service, branch, trend }: {
  data: DigestReport
  service: string
  branch: string
  trend?: DebtTrend | null
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [exporting, setExporting] = useState(false)

  function toggle(i: number) {
    setExpanded((prev: Set<number>) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n })
  }

  async function handleExport() {
    setExporting(true)
    try {
      exportDigestPdf(service, branch, data, trend)
    } finally {
      setExporting(false)
    }
  }

  const pct = data.total_findings > 0
    ? Math.round((data.total_fixable_top5 ?? 0) / data.total_findings * 100) : 0

  const ruleMap: Record<string, number> = {}
  data.fix_these_first.forEach(f => { ruleMap[f.rule_family] = (ruleMap[f.rule_family] || 0) + f.blast_radius })
  const pieData = Object.entries(ruleMap).map(([name, value]) => ({ name, value }))

  const barData = data.fix_these_first.map((f, i) => ({
    name: `#${i + 1}`, kills: f.kills_issues, radius: f.blast_radius,
  }))

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* KPI row */}
      <div className="grid-4">
        <div className="kpi-card kpi-red">
          <div className="kpi-label">Total Findings</div>
          <div className="kpi-value" style={{ color: '#EF4444' }}>{data.total_findings}</div>
          <div className="kpi-sub">across all files</div>
          <div className="kpi-icon">🔴</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Distinct Patterns</div>
          <div className="kpi-value" style={{ color: 'var(--gold-dim)' }}>{data.total_clusters}</div>
          <div className="kpi-sub">root cause patterns</div>
          <div className="kpi-icon">🔶</div>
        </div>
        <div className="kpi-card kpi-emerald">
          <div className="kpi-label">Min Fixes Needed</div>
          <div className="kpi-value" style={{ color: 'var(--emerald-dim)' }}>{data.minimum_fixes ?? data.fix_these_first.length}</div>
          <div className="kpi-sub">resolves {pct}% of all findings</div>
          <div className="kpi-icon">✅</div>
        </div>
        <div className="kpi-card kpi-purple">
          <div className="kpi-label">AI Triage</div>
          <div className="kpi-value" style={{ color: data.ai_triage !== false ? '#8B5CF6' : 'var(--text-faint)', fontSize: 20, paddingTop: 8 }}>
            {data.ai_triage !== false ? '✦ Active' : '— Rule-based'}
          </div>
          <div className="kpi-sub">{data.cached ? 'cached result' : 'fresh analysis'}</div>
          <div className="kpi-icon">🧠</div>
        </div>
      </div>

      {/* Summary banner */}
      <div className="panel" style={{ borderLeft: '4px solid var(--gold)' }}>
        <div className="panel-body" style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg,var(--gold-bg),#FEF9E7)', border: '1px solid var(--gold-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>🛡</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6, letterSpacing: '-0.01em' }}>{data.headline}</div>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.75 }}>{data.summary}</div>
          </div>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid-2">
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Vulnerability Distribution</span>
            <span className="badge badge-gray">by rule family</span>
          </div>
          <div className="panel-body" style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <ResponsiveContainer width={160} height={160}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={46} outerRadius={72} paddingAngle={3} dataKey="value">
                  {pieData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
              {pieData.map((d, i) => (
                <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 3, background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: 'var(--text-dim)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Issues Killed per Fix</span>
            <span className="badge badge-gray">top 5 clusters</span>
          </div>
          <div className="panel-body">
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={barData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-faint)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-faint)' }} />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}
                  formatter={(val: number, name: string) => [val, name === 'kills' ? 'Issues killed' : 'Blast radius']}
                />
                <Bar dataKey="kills"  fill="#C9A84C" radius={[4,4,0,0]} name="kills" />
                <Bar dataKey="radius" fill="#10B981" radius={[4,4,0,0]} name="radius" opacity={0.6} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Fix coverage */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">Fix Coverage</span>
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>fixing top 5 clusters resolves <strong style={{ color: 'var(--text-dim)' }}>{pct}%</strong> of all findings</span>
        </div>
        <div className="panel-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div className="progress-bar" style={{ flex: 1, height: 10, borderRadius: 5 }}>
              <div className="progress-fill" style={{
                width: pct + '%',
                background: pct >= 80 ? 'linear-gradient(90deg,#059669,#10B981)' : pct >= 50 ? 'linear-gradient(90deg,#C9A84C,#F0C040)' : 'linear-gradient(90deg,#DC2626,#EF4444)',
              }} />
            </div>
            <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', minWidth: 42, letterSpacing: '-0.02em' }}>{pct}%</span>
          </div>
        </div>
      </div>

      {/* Findings table */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">Fix These First</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {data.ai_triage !== false && <span className="badge badge-purple">✦ AI Triage · Gemini</span>}
            <button className="btn btn-ghost btn-sm"
              onClick={() => setExpanded(expanded.size > 0 ? new Set() : new Set(data.fix_these_first.map((_, i) => i)))}>
              {expanded.size > 0 ? 'Collapse all' : 'Expand all'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleExport} disabled={exporting}
              style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}>
              {exporting ? 'Exporting...' : '↓ Export PDF'}
            </button>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Pattern / Rule Family</th>
                <th>Origin File</th>
                <th>Effort</th>
                <th style={{ textAlign: "center" }}>Kills Issues</th>
                <th style={{ textAlign: "center" }}>Kills Files</th>
                <th style={{ textAlign: 'center' }}>Validate</th>
                <th style={{ textAlign: 'center' }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {data.fix_these_first.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-faint)' }}>No fix recommendations. Try re-clustering.</td></tr>
              ) : (
                data.fix_these_first.map((item, i) => (
                  <FindingRow key={item.cluster_id ?? i} item={item} rank={i + 1} expanded={expanded.has(i)} onToggle={() => toggle(i)} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
