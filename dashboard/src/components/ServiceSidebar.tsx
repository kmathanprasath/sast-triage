import type { ServiceSummary } from '../types'

type Tab = 'overview' | 'trend' | 'findings'
interface Props {
  services: ServiceSummary[]; selected: string
  onSelect: (n: string) => void; onTriggerScan: () => void
  activeTab: Tab; onTabChange: (t: Tab) => void
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const NAV_ITEMS: { tab: Tab; icon: string; label: string }[] = [
  { tab: 'overview',  icon: '◈', label: 'Overview'     },
  { tab: 'trend',     icon: '◉', label: 'Debt Trend'   },
  { tab: 'findings',  icon: '◎', label: 'All Findings' },
]

export default function ServiceSidebar({ services, selected, onSelect, onTriggerScan, activeTab, onTabChange }: Props) {
  const totalIssues  = services.reduce((s, x) => s + (x.total_blast_radius || 0), 0)
  const criticalSvcs = services.filter(s => s.max_urgency >= 8).length

  return (
    <aside className="sidebar">
      {/* Stats strip */}
      <div className="sidebar-stats">
        <div className="sidebar-stat">
          <div className="sidebar-stat-val" style={{ color: '#C9A84C' }}>{totalIssues}</div>
          <div className="sidebar-stat-label">Total Issues</div>
        </div>
        <div className="sidebar-stat" style={{ background: criticalSvcs > 0 ? 'rgba(239,68,68,0.08)' : undefined, borderColor: criticalSvcs > 0 ? 'rgba(239,68,68,0.2)' : undefined }}>
          <div className="sidebar-stat-val" style={{ color: criticalSvcs > 0 ? '#EF4444' : '#4A5568' }}>{criticalSvcs}</div>
          <div className="sidebar-stat-label">Critical</div>
        </div>
      </div>

      <div className="sidebar-scroll">
        {/* Navigation */}
        <div className="sidenav-section">
          <div className="sidenav-label">Views</div>
          {NAV_ITEMS.map(({ tab, icon, label }) => (
            <button key={tab}
              className={`sidenav-item ${activeTab === tab && selected ? 'active' : ''}`}
              onClick={() => { if (selected) onTabChange(tab) }}
              style={{ opacity: selected ? 1 : 0.35 }}
            >
              <span className="sidenav-item-icon" style={{ fontSize: 16 }}>{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div style={{ height: 1, background: 'rgba(255,255,255,0.04)', margin: '4px 16px' }} />

        {/* Services */}
        <div className="sidenav-section">
          <div className="sidenav-label">Services ({services.length})</div>
          {services.length === 0 ? (
            <div style={{ padding: '10px 16px', fontSize: 12, color: '#4A5568', lineHeight: 1.7 }}>
              No services yet.{' '}
              <span style={{ color: '#C9A84C', cursor: 'pointer', fontWeight: 600 }} onClick={onTriggerScan}>Trigger a scan →</span>
            </div>
          ) : (
            services.map(s => {
              const isActive = selected === s.microservice_name
              const isHigh   = s.max_urgency >= 8
              return (
                <button key={s.microservice_name}
                  className={`sidenav-item ${isActive ? 'active' : ''}`}
                  onClick={() => onSelect(s.microservice_name)}
                >
                  <span className="sidenav-item-icon" style={{ color: isHigh ? '#EF4444' : isActive ? '#C9A84C' : '#4A5568', fontSize: 10 }}>
                    {isHigh ? '⬤' : '⬤'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: isActive ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.microservice_name}
                      </span>
                      {s.accelerating_count > 0 && (
                        <span style={{ background: '#EF4444', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 9, fontWeight: 700, flexShrink: 0, letterSpacing: '0.02em' }}>
                          {s.accelerating_count}↑
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: '#2D3748', marginTop: 2 }}>
                      {s.cluster_count} clusters · {timeAgo(s.last_scanned)}
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="sidebar-footer">
        <button className="btn btn-primary" onClick={onTriggerScan} style={{ width: '100%', justifyContent: 'center', marginBottom: 10 }}>
          ▶ New Scan
        </button>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 16, fontSize: 10, color: '#2D3748' }}>
          <a href="http://localhost:5000/health" target="_blank" rel="noreferrer" style={{ color: '#4A5568' }}>Scanner</a>
          <span style={{ color: '#1C2333' }}>·</span>
          <a href="http://localhost:8000/health" target="_blank" rel="noreferrer" style={{ color: '#4A5568' }}>Intelligence</a>
          <span style={{ color: '#1C2333' }}>·</span>
          <a href="http://localhost:9000" target="_blank" rel="noreferrer" style={{ color: '#4A5568' }}>SonarQube</a>
        </div>
      </div>
    </aside>
  )
}
