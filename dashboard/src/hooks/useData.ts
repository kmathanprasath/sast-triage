import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import type { DigestReport, DebtTrend, ServiceSummary, AllFindingsResponse } from '../types'

const INTEL   = '/api/intelligence'
const SCANNER = '/api/scanner'

function useFetch<T>(url: string, deps: unknown[] = []) {
  const [data,    setData]    = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await axios.get<T>(url)
      setData(res.data)
    } catch (e: unknown) {
      if (axios.isAxiosError(e)) {
        setError(e.response?.data?.detail ?? e.message)
      } else {
        setError(e instanceof Error ? e.message : 'Request failed')
      }
    } finally {
      setLoading(false)
    }
  }, [url])

  useEffect(() => { run() }, deps)

  return { data, loading, error, refetch: run }
}

export function useDigest(service: string, branch: string) {
  const result = useFetch<DigestReport>(`${INTEL}/digest/${service}?branch=${branch}`, [service, branch])
  // API returns {error: "..."} with HTTP 200 when no clusters exist — treat as error
  if (result.data && (result.data as unknown as { error?: string }).error) {
    return { ...result, data: null, error: (result.data as unknown as { error: string }).error }
  }
  return result
}

export function useDebtTrend(service: string, branch: string) {
  return useFetch<DebtTrend>(`${INTEL}/debt-trend/${service}?branch=${branch}`, [service, branch])
}

export function useAllServices() {
  return useFetch<ServiceSummary[]>(`${INTEL}/summary`, [])
}

export async function triggerScan(repoUrl: string, branch: string) {
  // Try /scan first, fall back to /microservice register pattern
  try {
    const res = await axios.post(`${SCANNER}/scan`, { repo_url: repoUrl, branch })
    return res.data
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.status === 404) {
      const name = repoUrl.split('/').pop() ?? 'repo'
      const res = await axios.post(`${SCANNER}/microservice`, { name, source_repo_url: repoUrl, branch })
      return res.data
    }
    throw e
  }
}

export async function getScanStatus(scanId: string) {
  const res = await axios.get(`${SCANNER}/scan/${scanId}`)
  return res.data
}

export async function listScans(limit = 20) {
  const res = await axios.get(`${SCANNER}/scans?limit=${limit}`)
  return res.data
}

export async function triggerCluster(service: string, branch = 'main') {
  const res = await axios.post(`${INTEL}/recluster/${service}?branch=${encodeURIComponent(branch)}`)
  return res.data
}

export function useAllFindings(service: string, branch: string, page: number) {
  return useFetch<AllFindingsResponse>(
    service ? `${INTEL}/all-findings/${service}?branch=${branch}&page=${page}&per_page=50` : '',
    [service, branch, page]
  )
}

export async function validateCluster(
  clusterId: string,
  status: 'true_positive' | 'false_positive' | 'false_negative' | 'true_negative' | 'unreviewed',
  note = '',
  reviewer = 'analyst',
) {
  const res = await axios.patch(`${INTEL}/validate/${clusterId}`, { status, note, reviewer })
  return res.data
}
