import { useEffect, useMemo, useRef, useState } from 'react'

/** setInterval that always calls the latest callback; cleared on unmount or when disabled. */
export function useInterval(callback, ms, enabled = true) {
  const saved = useRef(callback)
  useEffect(() => { saved.current = callback }, [callback])
  useEffect(() => {
    if (!enabled || !ms) return undefined
    const id = setInterval(() => saved.current(), ms)
    return () => clearInterval(id)
  }, [ms, enabled])
}

export function useMediaQuery(query) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false)
  const [matches, setMatches] = useState(get)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatches(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return matches
}

/** Client-side sort. getters: { field: (row) => value } */
export function useSorted(rows, getters, initial = { field: null, dir: 'desc' }) {
  const [sort, setSort] = useState(initial)
  const sorted = useMemo(() => {
    if (!sort.field || !getters[sort.field]) return rows
    const get = getters[sort.field]
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const x = get(a)
      const y = get(b)
      if (x == null && y == null) return 0
      if (x == null) return 1
      if (y == null) return -1
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort])
  const toggle = (field) => setSort((s) => (s.field === field ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'desc' }))
  return { sorted, sort, toggle }
}

/** Client-side paging that resets to page 0 when `resetKey` changes. */
export function usePaged(rows, pageSize, resetKey) {
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [resetKey])
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const safe = Math.min(page, pageCount - 1)
  return {
    page: safe,
    setPage,
    pageCount,
    pageRows: rows.slice(safe * pageSize, (safe + 1) * pageSize),
  }
}

/** True when the keyboard event comes from a text field (shortcuts should be ignored). */
export function isTypingTarget(e) {
  const el = e.target
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}
