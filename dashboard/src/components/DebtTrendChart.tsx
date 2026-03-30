import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, Legend } from 'recharts'
import type { DebtTrend, ClusterTrend } from '../types'

const CHART_COLORS = ['#C9A84C', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#3B82F6']

function ClusterRow({ cluster, color }: { cluster: ClusterTrend; color: string }) {
  const current = cluster.history.length > 0 ? cluster.history[cluster.history.length - 1].blast_radius : 0
  const isAccel  = cluster.is_accelerating
  return (
    <tr>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 10, height: 10, borderRadius: 3, background: color, flexShrink: 0 }} />
          <span style={{ fontWeight: 600, fontSize: 12 }}>{cluster.rule_family}</span>
          {isAccel && <span className="badge badge-red" style={{ fontSize: 10 }}>↑ Accel</span>}
        </div>
      </td>
      <td className="mono">{cluster.origin_file}</td>
      <td style={{ textAlign: 'center' }}>
        <span style={{ fontWeight: 700, color: isAccel ? '#EF4444' : 'var(--text)', fontSize: 14 }}>{current}</span>
      </td>
      <td style={{ textAlign: 'center' }}>
        <span className="badge badge-gold">{cluster.urgency_score}/10</span>
      </td>
      <td style={{ textAlign: 'center' }}>
        {cluster.doubles_in_days
          ? <span style={{ color: '#EF4444', fontWeight: 700, fontSize: 12 }}>{cluster.doubles_in_days}d</span>
          : <span style={{ color: 'var(--text-faint)' }}>—</span>}
      </td>
      <td><span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{cluster.fix_cost_today}</span></td>
    </tr>
  )
}

export default function DebtTrendChart({ data }: { data: DebtTrend }) {
  const hasAccel   = data.accelerating_count > 0
  const allClusters = [...data.accelerating_clusters, ...data.stable_clusters]
  const top5        = allClusters.slice(0, 5)
  const maxSprints  = Math.max(...top5.map(c => c.history.length), 1)
  const areaData    = Array.from({ length: maxSprints }, (_, i) => {
    const point: Record<string, number | string> = { sprint: `S${i + 1}` }
    top5.forEach(c => { point[c.rule_family] = c.history[i]?.blast_radius ?? 0 })
    return point
  })

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* KPI row */}
      <div className="grid-4">
        <div className="kpi-card">
          <div className="kpi-label">Total Clusters</div>
          <div className="kpi-value" style={{ color: 'var(--gold-dim)' }}>{data.total_clusters}</div>
          <div className="kpi-sub">root cause groups</div>
          <div className="kpi-icon">🔶</div>
        </div>
        <div className={`kpi-card ${hasAccel ? 'kpi-red' : 'kpi-emerald'}`}>
          <div className="kpi-label">Accelerating</div>
          <div className="kpi-value" style={{ color: hasAccel ? '#EF4444' : 'var(--emerald-dim)' }}>{data.accelerating_count}</div>
          <div className="kpi-sub">{hasAccel ? 'fix this sprint' : 'all stable'}</div>
          <div className="kpi-icon">{hasAccel ? '⚠' : '✓'}</div>
        </div>
        <div className="kpi-card kpi-emerald">
          <div className="kpi-label">Stable</div>
          <div className="kpi-value" style={{ color: 'var(--emerald-dim)' }}>{data.stable_clusters.length}</div>
          <div className="kpi-sub">not growing</div>
          <div className="kpi-icon">✅</div>
        </div>
        <div className={`kpi-card ${data.summary.top_doubles_in_days ? 'kpi-red' : ''}`}>
          <div className="kpi-label">Fastest Doubling</div>
          <div className="kpi-value" style={{ color: data.summary.top_doubles_in_days ? '#EF4444' : 'var(--text-faint)', fontSize: 26 }}>
            {data.summary.top_doubles_in_days ? `${data.summary.top_doubles_in_days}d` : '—'}
          </div>
          <div className="kpi-sub">cost doubles in</div>
          <div className="kpi-icon">⏱</div>
        </div>
      </div>

      {/* Status banner */}
      <div className="panel" style={{ borderLeft: `4px solid ${hasAccel ? '#EF4444' : 'var(--emerald)'}` }}>
        <div className="panel-body" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: hasAccel ? 'var(--red-bg)' : 'var(--emerald-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
            {hasAccel ? '⚠' : '✓'}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: hasAccel ? '#DC2626' : 'var(--emerald-dim)', marginBottom: 3 }}>
              {hasAccel ? `${data.accelerating_count} accelerating cluster${data.accelerating_count !== 1 ? 's' : ''} — fix this sprint` : 'All clusters stable'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{data.summary.message}</div>
          </div>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid-2">
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Debt Evolution — Top 5 Clusters</span>
            <span className="badge badge-gray">blast radius over time</span>
          </div>
          <div className="panel-body">
            {areaData.length > 1 ? (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={areaData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    {top5.map((c, i) => (
                      <linearGradient key={c.cluster_id} id={`grad${i}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={CHART_COLORS[i]} stopOpacity={0.25} />
                        <stop offset="95%" stopColor={CHART_COLORS[i]} stopOpacity={0.02} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" />
                  <XAxis dataKey="sprint" tick={{ fontSize: 10, fill: 'var(--text-faint)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-faint)' }} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {top5.map((c, i) => (
                    <Area key={c.cluster_id} type="monotone" dataKey={c.rule_family}
                      stroke={CHART_COLORS[i]} fill={`url(#grad${i})`} strokeWidth={2} dot={{ r: 3, fill: CHART_COLORS[i] }} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
                Trend builds after 2+ scans
              </div>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Accelerating Clusters</span>
            <span className="badge badge-gray">growth rate</span>
          </div>
          <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {data.accelerating_clusters.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--text-faint)', fontSize: 13 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
                No accelerating clusters
              </div>
            ) : (
              data.accelerating_clusters.slice(0, 4).map((c, i) => {
                const sparkData = c.history.map((h, j) => ({ s: `S${j+1}`, v: h.blast_radius }))
                return (
                  <div key={c.cluster_id}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{c.rule_family}</span>
                      <span style={{ fontSize: 11, color: '#EF4444', fontWeight: 700 }}>
                        {c.history.length > 0 ? c.history[c.history.length - 1].blast_radius : 0} issues
                      </span>
                    </div>
                    {sparkData.length > 1 ? (
                      <ResponsiveContainer width="100%" height={40}>
                        <LineChart data={sparkData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                          <Line type="monotone" dataKey="v" stroke={CHART_COLORS[i]} strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div style={{ height: 40, display: 'flex', alignItems: 'center' }}>
                        <div className="progress-bar" style={{ flex: 1 }}>
                          <div className="progress-fill" style={{ width: '60%', background: CHART_COLORS[i] }} />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* Clusters table */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">All Root Cause Clusters</span>
          <span className="badge badge-gold">{data.total_clusters} total</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Rule Family</th><th>Origin File</th>
                <th style={{ textAlign: 'center' }}>Issues</th>
                <th style={{ textAlign: 'center' }}>Urgency</th>
                <th style={{ textAlign: 'center' }}>Doubles In</th>
                <th>Fix Cost</th>
              </tr>
            </thead>
            <tbody>
              {allClusters.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-faint)' }}>No cluster data. Run a scan first.</td></tr>
              ) : (
                allClusters.map((c, i) => <ClusterRow key={c.cluster_id} cluster={c} color={CHART_COLORS[i % CHART_COLORS.length]} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
