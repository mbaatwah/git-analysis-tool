import { useState, useCallback } from 'react';

const API_BASE = '/api';

export function useApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const request = useCallback(async (endpoint, options = {}) => {
    setLoading(true);
    setError(null);

    try {
      const url = `${API_BASE}${endpoint}`;
      const config = {
        headers: { 'Content-Type': 'application/json' },
        ...options,
      };

      if (config.body && typeof config.body === 'object') {
        config.body = JSON.stringify(config.body);
      }

      const res = await fetch(url, config);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || `Request failed with status ${res.status}`);
      }

      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const get = useCallback((endpoint) => request(endpoint), [request]);

  const post = useCallback(
    (endpoint, body) => request(endpoint, { method: 'POST', body }),
    [request]
  );

  return { get, post, loading, error, setError };
}
