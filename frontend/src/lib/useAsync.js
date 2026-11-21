import { useCallback, useEffect, useState } from 'react'

/**
 * Runs an async loader and tracks { data, loading, error }.
 * Re-runs when `deps` change or when reload() is called.
 * setData lets a page patch the loaded data after a mutation (e.g. freeze an account).
 */
export function useAsync(loader, deps = []) {
  const [state, setState] = useState({ data: undefined, loading: true, error: null })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let active = true
    setState((s) => ({ ...s, loading: true, error: null }))
    Promise.resolve()
      .then(loader)
      .then(
        (data) => active && setState({ data, loading: false, error: null }),
        (error) => active && setState({ data: undefined, loading: false, error }),
      )
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  const setData = useCallback(
    (updater) => setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater })),
    [],
  )

  return { ...state, reload, setData }
}
