import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { DigestReport, DebtTrend } from '../types'

const GOLD   = [201, 168, 76]  as [number, number, number]
const RED    = [239, 68,  68]  as [number, number, number]
const GREEN  = [16,  185, 129] as [number, number, number]
const DARK   = [17,  24,  39]  as [number, number, number]
const GRAY   = [100, 116, 139] as [number, number, number]
const WHITE  = [255, 255, 255] as [number, number, number]
const LIGHT  = [248, 250, 252] as [number, number, number]

function addHeader(doc: jsPDF, service: string, branch: string) {
  // Dark header bar
  doc.setFillColor(...DARK)
  doc.rect(0, 0, 210, 22, 'F')

  // Gold accent strip
  doc.setFillColor(...GOLD)
  doc.rect(0, 22, 210, 2, 'F')

  // Logo placeholder
  doc.setFillColor(...GOLD)
  doc.roundedRect(10, 5, 12, 12, 2, 2, 'F')
  doc.setTextColor(...DARK)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('VS', 16, 13, { align: 'center' })

  // Title
  doc.setTextColor(...WHITE)
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text('VaultScan Security Report', 26, 10)

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...GOLD)
  doc.text(`${service}  ·  branch: ${branch}  ·  ${new Date().toUTCString()}`, 26, 17)
}

function addKpiRow(doc: jsPDF, y: number, data: DigestReport): number {
  const cards = [
    { label: 'Total Findings',      value: String(data.total_findings),      color: RED   },
    { label: 'Root Cause Clusters', value: String(data.total_clusters),       color: GOLD  },
    { label: 'Fixable by Top 5',    value: String(data.total_fixable_top5 ?? 0), color: GREEN },
    { label: 'AI Triage',           value: data.ai_triage !== false ? 'Active' : 'Rule-based', color: [139, 92, 246] as [number,number,number] },
  ]

  const w = 44, gap = 2, startX = 10
  cards.forEach((card, i) => {
    const x = startX + i * (w + gap)
    doc.setFillColor(...LIGHT)
    doc.roundedRect(x, y, w, 22, 2, 2, 'F')
    doc.setDrawColor(...card.color)
    doc.setLineWidth(0.5)
    doc.roundedRect(x, y, w, 22, 2, 2, 'S')

    doc.setTextColor(...GRAY)
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.text(card.label.toUpperCase(), x + w / 2, y + 7, { align: 'center' })

    doc.setTextColor(...card.color)
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text(card.value, x + w / 2, y + 17, { align: 'center' })
  })

  return y + 28
}

function addSummaryBox(doc: jsPDF, y: number, headline: string, summary: string): number {
  doc.setFillColor(254, 249, 231)
  doc.setDrawColor(...GOLD)
  doc.setLineWidth(0.4)
  doc.roundedRect(10, y, 190, 4, 1, 1, 'F')  // gold top border
  doc.setFillColor(254, 252, 243)
  doc.roundedRect(10, y + 4, 190, 28, 1, 1, 'F')

  doc.setTextColor(...DARK)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text(headline, 15, y + 11)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...GRAY)
  const lines = doc.splitTextToSize(summary, 178)
  doc.text(lines.slice(0, 3), 15, y + 18)

  return y + 38
}

function addFixTable(doc: jsPDF, y: number, data: DigestReport): number {
  doc.setTextColor(...DARK)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('Fix These First', 10, y)
  y += 4

  const EFFORT_MAP: Record<string, string> = {
    QUICK_WIN: 'Quick Win', MEDIUM: 'Medium', HARD: 'Hard',
  }

  autoTable(doc, {
    startY: y,
    margin: { left: 10, right: 10 },
    head: [['#', 'Rule Family', 'Origin File', 'Effort', 'Kills', 'Blast Radius', 'Validation']],
    body: data.fix_these_first.map((f, i) => [
      String(i + 1),
      f.rule_family,
      f.origin_file.length > 40 ? '...' + f.origin_file.slice(-37) : f.origin_file,
      EFFORT_MAP[f.effort] ?? f.effort,
      String(f.kills_issues),
      String(f.blast_radius),
      f.validation_status === 'true_positive'  ? 'TP' :
      f.validation_status === 'false_positive' ? 'FP' : '—',
    ]),
    headStyles: {
      fillColor: DARK,
      textColor: GOLD,
      fontStyle: 'bold',
      fontSize: 8,
    },
    bodyStyles: { fontSize: 7.5, textColor: DARK },
    alternateRowStyles: { fillColor: LIGHT },
    columnStyles: {
      0: { cellWidth: 8,  halign: 'center' },
      3: { cellWidth: 20, halign: 'center' },
      4: { cellWidth: 12, halign: 'center', textColor: GOLD, fontStyle: 'bold' },
      5: { cellWidth: 18, halign: 'center' },
      6: { cellWidth: 18, halign: 'center' },
    },
    didParseCell(data) {
      if (data.section === 'body' && data.column.index === 4) {
        data.cell.styles.textColor = GOLD
        data.cell.styles.fontStyle = 'bold'
      }
      if (data.section === 'body' && data.column.index === 6) {
        if (data.cell.raw === 'TP') {
          data.cell.styles.textColor = RED
          data.cell.styles.fontStyle = 'bold'
        } else if (data.cell.raw === 'FP') {
          data.cell.styles.textColor = GREEN
          data.cell.styles.fontStyle = 'bold'
        }
      }
    },
  })

  return (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6
}

function addDetailSection(doc: jsPDF, y: number, data: DigestReport): number {
  if (data.fix_these_first.length === 0) return y

  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...DARK)
  doc.text('Detailed Fix Instructions', 10, y)
  y += 6

  data.fix_these_first.forEach((f, i) => {
    if (y > 260) { doc.addPage(); addPageFooter(doc); y = 20 }

    doc.setFillColor(...LIGHT)
    doc.roundedRect(10, y, 190, 6, 1, 1, 'F')
    doc.setFontSize(8.5)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...DARK)
    doc.text(`#${i + 1}  ${f.rule_family}`, 14, y + 4.5)
    doc.setTextColor(...GRAY)
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.text(f.origin_file.length > 80 ? '...' + f.origin_file.slice(-77) : f.origin_file, 130, y + 4.5)
    y += 8

    // Why dangerous
    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(239, 68, 68)
    doc.text('Why dangerous:', 14, y)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...GRAY)
    const dangerLines = doc.splitTextToSize(f.why_dangerous, 170)
    doc.text(dangerLines.slice(0, 3), 14, y + 4)
    y += 4 + dangerLines.slice(0, 3).length * 4

    // Exact fix
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(16, 185, 129)
    doc.text('Exact fix:', 14, y)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...GRAY)
    const fixLines = doc.splitTextToSize(f.exact_fix, 170)
    doc.text(fixLines.slice(0, 4), 14, y + 4)
    y += 4 + fixLines.slice(0, 4).length * 4 + 4
  })

  return y
}

function addTrendSection(doc: jsPDF, y: number, trend: DebtTrend): number {
  if (y > 240) { doc.addPage(); addPageFooter(doc); y = 20 }

  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...DARK)
  doc.text('Debt Trend Summary', 10, y)
  y += 5

  const allClusters = [...trend.accelerating_clusters, ...trend.stable_clusters]

  autoTable(doc, {
    startY: y,
    margin: { left: 10, right: 10 },
    head: [['Rule Family', 'Origin File', 'Issues', 'Urgency', 'Doubles In', 'Accelerating']],
    body: allClusters.map(c => [
      c.rule_family,
      c.origin_file.length > 40 ? '...' + c.origin_file.slice(-37) : c.origin_file,
      String(c.history.length > 0 ? c.history[c.history.length - 1].blast_radius : 0),
      `${c.urgency_score}/10`,
      c.doubles_in_days ? `${c.doubles_in_days}d` : '—',
      c.is_accelerating ? 'YES' : 'No',
    ]),
    headStyles: { fillColor: DARK, textColor: GOLD, fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fontSize: 7.5, textColor: DARK },
    alternateRowStyles: { fillColor: LIGHT },
    columnStyles: {
      2: { halign: 'center' },
      3: { halign: 'center' },
      4: { halign: 'center' },
      5: { halign: 'center' },
    },
    didParseCell(data) {
      if (data.section === 'body' && data.column.index === 5 && data.cell.raw === 'YES') {
        data.cell.styles.textColor = RED
        data.cell.styles.fontStyle = 'bold'
      }
    },
  })

  return (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6
}

function addPageFooter(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFillColor(...DARK)
    doc.rect(0, 287, 210, 10, 'F')
    doc.setTextColor(...GRAY)
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.text('VaultScan — Confidential Security Report', 10, 293)
    doc.text(`Page ${i} of ${pageCount}`, 200, 293, { align: 'right' })
  }
}

export function exportDigestPdf(
  service: string,
  branch: string,
  digest: DigestReport,
  trend?: DebtTrend | null,
) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  addHeader(doc, service, branch)
  let y = 30

  y = addKpiRow(doc, y, digest)
  y = addSummaryBox(doc, y, digest.headline, digest.summary)
  y = addFixTable(doc, y, digest)
  y = addDetailSection(doc, y, digest)

  if (trend) {
    if (y > 240) { doc.addPage(); y = 20 }
    y = addTrendSection(doc, y, trend)
  }

  addPageFooter(doc)

  const filename = `vaultscan-${service}-${branch}-${new Date().toISOString().slice(0, 10)}.pdf`
  doc.save(filename)
}
