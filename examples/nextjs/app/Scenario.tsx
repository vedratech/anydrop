'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { AnyDrop, type AnyDropInstance } from '@vedratech/anydrop-react';
import type { ErrorEntry } from '@vedratech/anydrop-core';
import type { AnyDropFileContext } from '@vedratech/anydrop-ui';
import { ar } from '@vedratech/anydrop-ui/locales/ar';
import { de } from '@vedratech/anydrop-ui/locales/de';
import { en } from '@vedratech/anydrop-ui/locales/en';

const LOCALES = { en, de, ar } as const;
const PRESETS = ['', 'minimal', 'rounded', 'glass', 'enterprise'] as const;

/** A value from a provider above <AnyDrop>: custom rows read it, which proves that context flows. */
const AppLabel = createContext('no-provider');

// Counts mounted and destroyed row views, for leak checks (mounted - destroyed = rows on screen).
const counts = { mounted: 0, destroyed: 0 };
let snapshot = { ...counts };
const listeners = new Set<() => void>();
const bump = (key: 'mounted' | 'destroyed') => {
  counts[key]++;
  snapshot = { ...counts };
  listeners.forEach((l) => l());
};
const useCounts = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
    () => snapshot,
  );

const btn = { minWidth: 44, minHeight: 44 } as const;

function FileRow({ ctx }: { ctx: AnyDropFileContext }) {
  const label = useContext(AppLabel);
  useEffect(() => {
    bump('mounted');
    return () => bump('destroyed');
  }, []);
  return (
    <div
      style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '0 8px', height: '100%' }}
    >
      <strong style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{ctx.label}</strong>
      <span data-testid="row-context">{label}</span>
      <span data-testid="row-progress">{Math.round(ctx.progress)}%</span>
      <span data-testid="row-status">{ctx.status}</span>
      {ctx.can.pause && (
        <button type="button" data-testid="row-pause" style={btn} onClick={() => ctx.pause()}>
          Pause
        </button>
      )}
      {ctx.can.resume && (
        <button type="button" data-testid="row-resume" style={btn} onClick={() => ctx.resume()}>
          Resume
        </button>
      )}
    </div>
  );
}

export function Scenario() {
  const ref = useRef<AnyDropInstance | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [errors, setErrors] = useState<readonly ErrorEntry[]>([]);
  const [locale, setLocale] = useState<keyof typeof LOCALES>('en');
  const [preset, setPreset] = useState<(typeof PRESETS)[number]>('');
  const { mounted, destroyed } = useCounts();
  const say = (line: string) => setLog((l) => [...l.slice(-49), line]);

  return (
    <AppLabel.Provider value="ctx:acme">
      <main style={{ maxWidth: 860, margin: '0 auto', padding: 16, fontFamily: 'system-ui' }}>
        <h1>AnyDrop React example</h1>
        <p>
          <label>
            Language{' '}
            <select
              data-testid="locale"
              value={locale}
              onChange={(e) => setLocale(e.target.value as keyof typeof LOCALES)}
            >
              {Object.keys(LOCALES).map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>{' '}
          <label>
            Theme{' '}
            <select
              data-testid="preset"
              value={preset}
              onChange={(e) => setPreset(e.target.value as (typeof PRESETS)[number])}
            >
              {PRESETS.map((p) => (
                <option key={p} value={p}>
                  {p || 'default'}
                </option>
              ))}
            </select>
          </label>
        </p>

        <AnyDrop
          ref={ref}
          id="uploader"
          url="/upload"
          locale={LOCALES[locale]}
          themePreset={preset || null}
          options={{
            chunking: true,
            chunkSize: 64 * 1024,
            forceChunking: true,
            parallelUploads: 2,
            folders: true,
            preserveEmptyFolders: true,
            sendManifest: true,
            manifestUrl: '/upload/manifest',
            chunkStatusUrl: '/upload/status',
            finalizeUrl: '/upload/finalize',
            maxFilesize: 64,
          }}
          renderFile={(ctx) => <FileRow ctx={ctx} />}
          onAddedfile={(file) => say(`addedfile ${file.relativePath}`)}
          onAddedfolder={(folder) => say(`addedfolder ${folder.path}`)}
          onSuccess={({ file }) => say(`success ${file.relativePath}`)}
          onError={({ file, message }) => say(`error ${file.relativePath}: ${String(message)}`)}
          onPaused={(t) => say(`paused ${t.scope}`)}
          onResumed={(t) => say(`resumed ${t.scope}`)}
          onQueuecomplete={() => say('queuecomplete')}
          onErrorlistchanged={(list) => setErrors(list)}
        />

        <p style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            data-testid="pause-all"
            style={btn}
            onClick={() => ref.current?.pause()}
          >
            Pause all
          </button>
          <button
            type="button"
            data-testid="resume-all"
            style={btn}
            onClick={() => ref.current?.resume()}
          >
            Resume all
          </button>
        </p>

        <section data-testid="slot-mounts">
          Row views: <span data-testid="slot-mounted">{mounted}</span> mounted,{' '}
          <span data-testid="slot-destroyed">{destroyed}</span> destroyed
        </section>

        <section>
          <h2>Errors ({errors.length})</h2>
          <button
            type="button"
            data-testid="retry-failed"
            style={btn}
            disabled={errors.length === 0}
            onClick={() => ref.current?.retryFailedOnly()}
          >
            Retry failed
          </button>
          <ul data-testid="error-list">
            {errors.map((e) => (
              <li key={e.fileId ?? e.relativePath} data-testid="error-item">
                {e.relativePath}: {e.code}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Event log</h2>
          <pre data-testid="event-log" style={{ maxHeight: 220, overflow: 'auto' }}>
            {log.join('\n')}
          </pre>
        </section>
      </main>
    </AppLabel.Provider>
  );
}
