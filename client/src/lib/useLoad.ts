import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from './api';

/** Loads data from the API. Reloads when the path changes; `reload()` fetches again. */
export function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(path !== null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    if (path === null) return;
    const ticket = ++latest.current;
    setLoading(true);
    try {
      const result = await api.get<T>(path);
      // Ignore answers that arrive after a newer request was made.
      if (ticket === latest.current) {
        setData(result);
        setError('');
      }
    } catch (err) {
      if (ticket === latest.current) setError(errorMessage(err));
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load };
}

/** Returns the value after it has stopped changing for a moment (for search boxes). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
