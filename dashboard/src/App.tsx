import { useState, useEffect, useRef } from "react"
import DigestReport   from "./components/DigestReport"
import DebtTrendChart from "./components/DebtTrendChart"
import ServiceSidebar from "./components/ServiceSidebar"
import AllFindings    from "./components/AllFindings"
import { useDigest, useDebtTrend, useAllServices, triggerCluster, triggerScan, getScanStatus } from "./hooks/useData"
import "./index.css"

type ToastType = "success" | "error" | "info"
interface Toast { id: number; msg: string; type: ToastType }
let _tid = 0
const _tl: Array<(t: Toast) => void> = []
export function showToast(msg: string, type: ToastType = "info") {
  _tl.forEach(fn => fn({ id: ++_tid, msg, type }))
}

function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([])
  useEffect(() => {
    const fn = (t: Toast) => {
      setToasts(p => [...p, t])
      setTimeout(() => setToasts(p => p.filter(x => x.id !== t.id)), 4000)
    }
    _tl.push(fn)
    return () => { const i = _tl.indexOf(fn); if (i >= 0) _tl.splice(i, 1) }
  }, [])
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, display: "flex", flexDirection: "column", gap: 10 }}>
      {toasts.map(t => (
        <div key={t.id} className="fade-in" style={{
          background: t.type === "success" ? "#064E3B" : t.type === "error" ? "#7F1D1D" : "#1C2333",
          border: `1px solid ${t.type === "success" ? "#10B981" : t.type === "error" ? "#EF4444" : "#C9A84C"}`,
          color: "#F9FAFB", borderRadius: 10, padding: "12px 18px", fontSize: 13,
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)", maxWidth: 360,
        }}>
          {t.type === "success" ? "OK " : t.type === "error" ? "ERR " : "INFO "}{t.msg}
        </div>
      ))}
    </div>
  )
}

function ScanModal({ onClose, onStarted }: { onClose: () => void; onStarted: (id: string) => void }) {
  const [repo,      setRepo]      = useState("")
  const [branch,    setBranch]    = useState("main")
  const [isPrivate, setIsPrivate] = useState(false)
  const [token,     setToken]     = useState("")
  const [busy,      setBusy]      = useState(false)

  async function submit() {
    if (!repo.trim()) return
    setBusy(true)
    try {
      const data = await triggerScan(repo.trim(), branch.trim() || "main", isPrivate ? token.trim() : "")
      const id = data.scan_id ?? data.id ?? data.job_id ?? String(Date.now())
      showToast("Scan queued successfully", "success")
      onStarted(id)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Scan failed"
      showToast(msg, "error")
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">New Scan</span>
          <button className="modal-close" onClick={onClose}>x</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Repository URL</label>
            <input className="form-input" placeholder="https://github.com/org/repo" value={repo}
              onChange={e => setRepo(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} autoFocus />
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>Supports GitHub, GitLab, and Bitbucket</div>
          </div>
          <div className="form-group">
            <label className="form-label">Branch</label>
            <input className="form-input" placeholder="main" value={branch}
              onChange={e => setBranch(e.target.value)} />
          </div>
          <div className="form-group">
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <div onClick={() => setIsPrivate(p => !p)} style={{
                width: 36, height: 20, borderRadius: 10, position: "relative", flexShrink: 0,
                background: isPrivate ? "var(--gold)" : "var(--surface-3)",
                border: "1px solid var(--border)", transition: "background 0.2s", cursor: "pointer",
              }}>
                <div style={{
                  position: "absolute", top: 2, left: isPrivate ? 17 : 2,
                  width: 14, height: 14, borderRadius: "50%",
                  background: isPrivate ? "#1C2333" : "var(--text-faint)",
                  transition: "left 0.2s",
                }} />
              </div>
              <span style={{ fontSize: 12, color: "var(--text-dim)" }}>Private repository</span>
            </label>
          </div>
          {isPrivate && (
            <div className="form-group">
              <label className="form-label">
                Access Token
                <span style={{ fontSize: 10, color: "var(--text-faint)", marginLeft: 8, fontWeight: 400 }}>
                  GitHub PAT · GitLab token · Bitbucket app password
                </span>
              </label>
              <input className="form-input" type="password"
                placeholder="ghp_xxxx / glpat-xxxx / app-password"
                value={token} onChange={e => setToken(e.target.value)} />
              <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 4 }}>
                Used only for cloning. Never stored.
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit}
            disabled={busy || !repo.trim() || (isPrivate && !token.trim())}>
            {busy ? "Queuing..." : "Start Scan"}
          </button>
        </div>
      </div>
    </div>
  )
}

const STAGES = ["queued", "cloning", "scanning", "sonar", "unifying", "clustering", "completed"]
const STAGE_LABELS: Record<string, string> = {
  queued: "Queued", cloning: "Cloning repo", scanning: "Semgrep scan",
  sonar: "SonarQube analysis", unifying: "Unifying findings",
  clustering: "Clustering", completed: "Completed",
}

function ScanProgressModal({ scanId, onClose, onDone }: { scanId: string; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState<Record<string, unknown>>({})
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(Date.now())
  const doneRef  = useRef(false)

  useEffect(() => {
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000)
    return () => clearInterval(tick)
  }, [])

  useEffect(() => {
    if (doneRef.current) return
    const poll = setInterval(async () => {
      try {
        const data = await getScanStatus(scanId)
        setStatus(data)
        const st = (data.status as string) ?? ""
        if (st === "completed" || st === "failed") {
          doneRef.current = true
          clearInterval(poll)
          if (st === "completed") {
            showToast("Scan completed", "success")
            setTimeout(() => { onDone(); onClose() }, 1800)
          } else {
            showToast("Scan failed: " + (data.error ?? "unknown error"), "error")
          }
        }
      } catch { /* keep polling */ }
    }, 3000)
    return () => clearInterval(poll)
  }, [scanId, onClose, onDone])

  const currentStage = (status.status as string) ?? "queued"
  const currentIdx   = STAGES.indexOf(currentStage)
  const progress     = currentIdx < 0 ? 0 : Math.round(((currentIdx + 1) / STAGES.length) * 100)
  const failed       = currentStage === "failed"
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <span className="modal-title">Scan Progress</span>
          <span style={{ fontSize: 12, color: "var(--text-faint)", fontFamily: "monospace" }}>{fmt(elapsed)}</span>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 12, fontFamily: "monospace" }}>
            ID: {scanId}
          </div>
          <div className="progress-bar" style={{ height: 8, borderRadius: 4, marginBottom: 20 }}>
            <div className="progress-fill" style={{
              width: progress + "%",
              background: failed ? "linear-gradient(90deg,#DC2626,#EF4444)" : "linear-gradient(90deg,#C9A84C,#F0C040)",
              transition: "width 0.6s ease",
            }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {STAGES.map((stage, i) => {
              const done    = i < currentIdx || currentStage === "completed"
              const active  = i === currentIdx && !failed && currentStage !== "completed"
              const isFail  = failed && i === currentIdx
              const color   = isFail ? "#EF4444" : done ? "#10B981" : active ? "#C9A84C" : "var(--text-faint)"
              const icon    = isFail ? "X" : done ? "v" : active ? "o" : "-"
              return (
                <div key={stage} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${color}`,
                    background: (done || active) ? color + "18" : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, color, fontWeight: 700, flexShrink: 0 }}>
                    {icon}
                  </div>
                  <span style={{ fontSize: 13, color: active ? "var(--text)" : done ? "var(--text-dim)" : "var(--text-faint)",
                    fontWeight: active ? 600 : 400 }}>
                    {STAGE_LABELS[stage]}
                    {active && <span style={{ marginLeft: 8, fontSize: 11, color: "#C9A84C" }}>...</span>}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

function SkeletonPanel() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {[200, 120, 280].map(h => (
        <div key={h} className="panel" style={{ height: h }}>
          <div style={{ height: "100%", background: "linear-gradient(90deg,var(--surface-2) 25%,var(--surface-3) 50%,var(--surface-2) 75%)",
            backgroundSize: "200% 100%", animation: "shimmer 1.5s infinite", borderRadius: 8 }} />
        </div>
      ))}
    </div>
  )
}

function ErrorPanel({ msg }: { msg: string }) {
  return (
    <div className="panel" style={{ borderLeft: "4px solid #EF4444" }}>
      <div className="panel-body" style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <div style={{ fontSize: 24 }}>!</div>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 4, color: "#EF4444" }}>Failed to load</div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", fontFamily: "monospace" }}>{msg}</div>
        </div>
      </div>
    </div>
  )
}

function EmptyState({ onScan }: { onScan: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 20, padding: 60 }}>
      <div style={{ width: 80, height: 80, borderRadius: 20, background: "linear-gradient(135deg,var(--gold-bg),#FEF9E7)",
        border: "2px solid var(--gold-border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36 }}>
        S
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, letterSpacing: "-0.02em" }}>No service selected</div>
        <div style={{ fontSize: 14, color: "var(--text-dim)", lineHeight: 1.7, maxWidth: 380 }}>
          Select a service from the sidebar to view its security analysis, or trigger a new scan to get started.
        </div>
      </div>
      <button className="btn btn-primary" onClick={onScan}>Start Scan</button>
    </div>
  )
}

type Tab = "overview" | "trend" | "findings"

function ServiceView({ service, branch, tab, setTab }: { service: string; branch: string; tab: Tab; setTab: (t: Tab) => void }) {
  const digest = useDigest(service, branch)
  const trend  = useDebtTrend(service, branch)
  const [clustering, setClustering] = useState(false)

  async function recluster() {
    setClustering(true)
    try {
      await triggerCluster(service, branch)
      showToast("Re-clustering triggered", "success")
      setTimeout(() => { digest.refetch(); trend.refetch() }, 3000)
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Cluster failed", "error")
    } finally {
      setClustering(false)
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>{service}</h1>
          <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 3 }}>Security analysis dashboard</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ display: "flex", background: "var(--surface-2)", borderRadius: 8, padding: 3, gap: 2 }}>
            {(["overview", "trend", "findings"] as Tab[]).map(t => (
              <button key={t} onClick={() => setTab(t)}
                style={{
                  padding: "6px 16px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
                  background: tab === t ? "var(--surface)" : "transparent",
                  color: tab === t ? "var(--gold)" : "var(--text-faint)",
                  boxShadow: tab === t ? "var(--shadow)" : "none",
                  transition: "all 0.15s",
                }}>
                {t === "overview" ? "Overview" : t === "trend" ? "Debt Trend" : "All Findings"}
              </button>
            ))}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={recluster} disabled={clustering}>
            {clustering ? "..." : "Re-cluster"}
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", paddingRight: 4 }}>
        {tab === "overview" ? (
          digest.loading ? <SkeletonPanel /> :
          digest.error   ? <ErrorPanel msg={digest.error} /> :
          digest.data    ? <DigestReport data={digest.data} service={service} branch={branch} trend={trend.data} /> :
          <ErrorPanel msg="No data returned" />
        ) : (
          trend.loading ? <SkeletonPanel /> :
          trend.error   ? <ErrorPanel msg={trend.error} /> :
          trend.data    ? <DebtTrendChart data={trend.data} /> :
          <ErrorPanel msg="No trend data" />
        )}
        {tab === "findings" && <AllFindings service={service} branch={branch} />}
      </div>
    </div>
  )
}

export default function App() {
  const [selected,  setSelected]  = useState("")
  const [selBranch, setSelBranch] = useState("main")
  const [tab,       setTab]       = useState<Tab>("overview")
  const [scanModal, setScanModal] = useState(false)
  const [scanId,    setScanId]    = useState<string | null>(null)

  const { data: services, loading: svcsLoading, refetch: refetchServices } = useAllServices()

  function handleSelectService(name: string) {
    const svc = services?.find(s => s.microservice_name === name)
    setSelected(name)
    setSelBranch(svc?.branch ?? "main")
    setTab("overview")
  }

  function handleStarted(id: string) {
    setScanModal(false)
    setScanId(id)
  }

  return (
    <div className="app-shell">
      <header className="topnav">
        <div className="topnav-logo">
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#C9A84C,#F0C040)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>
            S
          </div>
          <span className="topnav-brand">VaultScan</span>
          <span className="topnav-chip">Enterprise</span>
        </div>
        <div className="topnav-divider" />
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
          {selected && (
            <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
              <span style={{ color: "var(--text-dim)" }}>{selected}</span>
              {" / "}
              <span style={{ color: "var(--gold)" }}>{tab === "overview" ? "Overview" : "Debt Trend"}</span>
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-faint)" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#10B981", display: "inline-block" }} />
            {svcsLoading ? "Loading..." : `${services?.length ?? 0} services`}
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setScanModal(true)}>New Scan</button>
        </div>
      </header>

      <div className="app-body">
        <ServiceSidebar
          services={services ?? []}
          selected={selected}
          onSelect={handleSelectService}
          onTriggerScan={() => setScanModal(true)}
          activeTab={tab}
          onTabChange={setTab}
        />
        <main className="main-content">
          {selected
            ? <ServiceView service={selected} branch={selBranch} tab={tab} setTab={setTab} />
            : <EmptyState onScan={() => setScanModal(true)} />
          }
        </main>
      </div>

      {scanModal && <ScanModal onClose={() => setScanModal(false)} onStarted={handleStarted} />}
      {scanId    && <ScanProgressModal scanId={scanId} onClose={() => setScanId(null)} onDone={refetchServices} />}

      <ToastContainer />
    </div>
  )
}
