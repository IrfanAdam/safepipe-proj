// supabase-schedule.js — single owner of all client Supabase reads (logic, zero DOM).
// Fetch style + fallback conventions mirror src/changelog/plan-source.js:
// every export never throws; any failure resolves null / no-op so callers
// fall back to bundled markdown + fetchLatestPlanSha.
// Client may use only VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
// (read-only anon key). Never put service_role here.

const FETCH_BUDGET_MS = 10000;
const MAX_RETRIES = 1;

function envVar(name) {
  try {
    const env = import.meta && import.meta.env ? import.meta.env : undefined;
    const v = env ? env[name] : undefined;
    return typeof v === 'string' ? v.trim() : '';
  } catch {
    return '';
  }
}

export function supabaseUrl() {
  return envVar('VITE_SUPABASE_URL').replace(/\/+$/, '');
}

export function supabaseAnonKey() {
  return envVar('VITE_SUPABASE_ANON_KEY');
}

// True only when both VITE_ vars are non-empty.
export const SUPABASE_CONFIGURED = supabaseUrl().length > 0 && supabaseAnonKey().length > 0;

// Map key: plan_file + NUL + section_key (NUL cannot appear in either).
export function scheduleKey(planFile, sectionKey) {
  return String(planFile) + '\0' + String(sectionKey);
}

async function fetchAttempt(base, key, fetchImpl, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    try {
      ctrl.abort();
    } catch {
      /* ignore */
    }
  }, timeoutMs);
  try {
    const url = base + '/rest/v1/schedules?select=plan_file,section_key,due,updated_at';
    const res = await fetchImpl(url, {
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        Accept: 'application/json',
      },
      signal: ctrl.signal,
    });
    if (!res || res.ok !== true) return undefined;
    const rows = await res.json();
    if (!Array.isArray(rows)) return undefined;
    const out = new Map();
    for (const r of rows) {
      if (!r || typeof r !== 'object') continue;
      if (typeof r.plan_file !== 'string' || typeof r.section_key !== 'string') continue;
      out.set(scheduleKey(r.plan_file, r.section_key), {
        plan_file: r.plan_file,
        section_key: r.section_key,
        due: typeof r.due === 'string' ? r.due : null,
        updated_at: typeof r.updated_at === 'string' ? r.updated_at : null,
      });
    }
    return out;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

// Live dues overlay: Map<key, { plan_file, section_key, due, updated_at }>,
// or null on any failure (unconfigured, offline, bad URL, RLS deny, timeout).
// Never throws. opts: { url, key, fetchImpl, timeoutMs } (all optional,
// defaulting to env / global fetch) — overrides exist for tests/smoke probes.
export async function fetchSchedules(opts = {}) {
  try {
    const o = opts && typeof opts === 'object' ? opts : {};
    const base = (typeof o.url === 'string' && o.url ? o.url : supabaseUrl()).replace(/\/+$/, '');
    const key = typeof o.key === 'string' && o.key ? o.key : supabaseAnonKey();
    if (!base || !key) return null;
    const fetchImpl = o.fetchImpl || fetch;
    if (typeof fetchImpl !== 'function') return null;
    let timeoutMs = FETCH_BUDGET_MS;
    if (typeof o.timeoutMs === 'number' && Number.isFinite(o.timeoutMs) && o.timeoutMs > 0) {
      timeoutMs = Math.min(o.timeoutMs, 60000);
    }
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const got = await fetchAttempt(base, key, fetchImpl, timeoutMs);
      if (got !== undefined) return got;
    }
    return null;
  } catch {
    return null;
  }
}

// Push updates: supabase-js realtime channel on every schedules change.
// Skips subscribing while document.hidden (background tabs stay quiet).
// Returns an unsubscribe function; on any error returns a no-op.
// Never throws. cb(payload) exceptions are swallowed.
export function subscribeSchedules(cb) {
  const noop = () => {};
  try {
    if (typeof cb !== 'function') return noop;
    if (!supabaseUrl() || !supabaseAnonKey()) return noop;
    try {
      if (typeof document !== 'undefined' && document.hidden) return noop;
    } catch {
      /* ignore */
    }
    let cleanup = noop;
    let cancelled = false;
    import('@supabase/supabase-js')
      .then(({ createClient }) => {
        if (cancelled || typeof createClient !== 'function') return;
        const client = createClient(supabaseUrl(), supabaseAnonKey(), {
          auth: { persistSession: false, autoRefreshToken: false },
          realtime: { params: { eventsPerSecond: 5 } },
        });
        const channel = client
          .channel('schedules-live')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, (payload) => {
            try {
              cb(payload);
            } catch {
              /* ignore listener errors */
            }
          })
          .subscribe();
        cleanup = () => {
          try {
            client.removeChannel(channel);
          } catch {
            /* ignore */
          }
        };
      })
      .catch(() => {
        /* offline / import failure: stay on fallback */
      });
    return () => {
      cancelled = true;
      try {
        cleanup();
      } catch {
        /* ignore */
      }
    };
  } catch {
    return noop;
  }
}
