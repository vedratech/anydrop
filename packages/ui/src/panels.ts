// Toolbar (pause all, resume all, retry failed, clear) and the persistent error panel.
import type { ErrorEntry } from '@vedratech/anydrop-core';
import type { AnyDrop } from './AnyDrop';
import { fmt, h, Listeners, textBtn } from './dom';
import { destroyView, type Mounted, runHook, updateView } from './render';
import type { AnyDropErrorItemContext, AnyDropToolbarContext } from './types';
import { VirtualList } from './virtual';

/** What decides whether a view needs an update call: the values a context shows. */
export const key = (c: {
  counts?: unknown;
  progress?: unknown;
  summaryText?: unknown;
  can?: unknown;
}) => JSON.stringify([c.counts, c.progress, c.summaryText, c.can]);

export class Toolbar {
  readonly el = h('div', 'ad-toolbar', { role: 'toolbar' });
  private summary = h('div', 'ad-summary');
  private bar = h('span', 'ad-bar');
  private info = h('div', 'ad-toolbar-info');
  private acts = h('div', 'ad-toolbar-actions');
  private b: Record<string, HTMLButtonElement> = {};
  private dom = new Listeners();
  private view: Mounted | null;
  private last = '';

  constructor(private ad: AnyDrop) {
    const prog = h('div', 'ad-progress ad-total-progress', { role: 'progressbar' });
    prog.appendChild(this.bar);
    this.info.append(this.summary, prog);
    for (const a of ['pause-all', 'resume-all', 'retry-failed', 'clear']) {
      this.acts.appendChild((this.b[a] = textBtn(a, '')));
    }
    this.el.append(this.info, this.acts);
    this.dom.on(this.el, 'click', (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('[data-ad-action]');
      if (a) ad._uiRun(a.getAttribute('data-ad-action') as string);
    });
    this.labels();
    const c = this.ctx();
    this.last = key(c);
    this.view = runHook(ad, 'toolbar', c);
    if (this.view && this.view.el) {
      this.el.textContent = '';
      this.el.appendChild(this.view.el);
    }
  }

  labels(): void {
    const o = this.ad.options;
    const t: Record<string, string> = {
      'pause-all': o.dictPauseAll,
      'resume-all': o.dictResumeAll,
      'retry-failed': o.dictRetryFailed,
      clear: o.dictClear,
    };
    for (const k in t) (this.b[k] as HTMLElement).textContent = t[k] as string;
    this.el.setAttribute('aria-label', o.dictToolbarLabel);
  }

  private ctx(): AnyDropToolbarContext {
    const ad = this.ad;
    const n = ad.getTree().counts;
    const live = n.queued + n.uploading + n.added;
    const can = {
      pauseAll: !(ad._uiUserAll || live + n.paused === 0),
      resumeAll: ad._uiPausedAll || n.paused > 0,
      retryFailed: n.error > 0,
      clear: n.total > 0 || !!ad._uiExtras.length,
    };
    const run = (id: string, ok: boolean) => () => {
      if (ok) ad._uiRun(id);
    };
    return Object.assign(ad._uiBase(), {
      kind: 'toolbar' as const,
      el: this.el,
      parts: { info: this.info, actions: this.acts },
      counts: { ...n },
      progress: Math.round(n.total && ad._uiTotal >= 0 ? ad._uiTotal : 0),
      summaryText: fmt(ad.options.dictSummary, {
        done: n.success,
        total: n.total,
        failed: n.error,
      }),
      can,
      pauseAll: run('pause-all', can.pauseAll),
      resumeAll: run('resume-all', can.resumeAll),
      retryFailed: run('retry-failed', can.retryFailed),
      clear: run('clear', can.clear),
    });
  }

  update(): void {
    const c = this.ctx();
    this.summary.textContent = c.summaryText;
    this.bar.style.width = c.progress + '%';
    const p = this.bar.parentElement as HTMLElement;
    p.setAttribute('aria-valuenow', String(c.progress));
    p.setAttribute('aria-label', c.summaryText);
    (this.b['pause-all'] as HTMLButtonElement).disabled = !c.can.pauseAll;
    (this.b['resume-all'] as HTMLButtonElement).disabled = !c.can.resumeAll;
    (this.b['retry-failed'] as HTMLButtonElement).disabled = !c.can.retryFailed;
    (this.b.clear as HTMLButtonElement).disabled = !c.can.clear;
    const k = key(c);
    if (k !== this.last) {
      this.last = k;
      updateView(this.view, c);
    }
  }

  destroy(): void {
    destroyView(this.view);
    this.dom.clear();
    this.el.remove();
  }
}

export class ErrorPanel {
  readonly el = h('div', 'ad-errors', { role: 'region', hidden: true });
  private title = h('strong', 'ad-errors-title');
  private list: VirtualList;
  private entries: ErrorEntry[] = [];
  private b: Record<string, HTMLButtonElement> = {};
  private dom = new Listeners();
  private views = new WeakMap<HTMLElement, Mounted>();

  constructor(private ad: AnyDrop) {
    const head = h('div', 'ad-errors-head');
    const acts = h('div', 'ad-errors-actions');
    for (const a of [
      'retry-failed',
      'export-json',
      'export-csv',
      'copy-errors',
      'dismiss-errors',
    ]) {
      acts.appendChild((this.b[a] = textBtn(a, '')));
    }
    head.append(this.title, acts);
    this.list = new VirtualList('ad-error-list', {
      render: (i) => this.row(i),
      release: (_i, el) => destroyView(this.views.get(el)),
    });
    this.list.el.setAttribute('role', 'list');
    this.list.el.setAttribute('tabindex', '0');
    this.el.append(head, this.list.el);
    this.dom.on(this.el, 'click', (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('[data-ad-action]');
      if (!a) return;
      const row = a.closest<HTMLElement>('.ad-error-row');
      const entry = row && this.entries[Number(row.getAttribute('data-index'))];
      ad._uiRun(a.getAttribute('data-ad-action') as string, undefined, entry || undefined);
    });
    this.labels();
  }

  labels(): void {
    const o = this.ad.options;
    const t: Record<string, string> = {
      'retry-failed': o.dictRetryFailed,
      'export-json': o.dictExportJson,
      'export-csv': o.dictExportCsv,
      'copy-errors': o.dictCopyErrors,
      'dismiss-errors': o.dictDismissErrors,
    };
    for (const k in t) (this.b[k] as HTMLElement).textContent = t[k] as string;
    this.el.setAttribute('aria-label', fmt(o.dictErrorsTitle, { count: this.entries.length }));
    this.list.el.setAttribute('aria-label', fmt(o.dictErrorsTitle, { count: this.entries.length }));
    this.title.textContent = fmt(o.dictErrorsTitle, { count: this.entries.length });
  }

  set(entries: ErrorEntry[]): void {
    this.entries = entries;
    this.el.hidden = !entries.length;
    this.labels();
    this.list.setCount(entries.length, this.ad.options.errorRowHeight);
  }

  private row(i: number): HTMLElement {
    const ad = this.ad;
    const e = this.entries[i] as ErrorEntry;
    const r = h('div', 'ad-error-row', { role: 'listitem', 'data-index': i });
    const text = h('div', 'ad-error-text');
    text.append(
      h('div', 'ad-error-path', { title: e.relativePath }, e.relativePath),
      h('div', 'ad-error-reason', { title: e.message }, `${e.code}: ${e.message}`),
    );
    r.appendChild(text);
    const retry = e.retryable ? textBtn('retry-entry', ad.options.dictRetry) : null;
    if (retry) r.appendChild(retry);
    const c: AnyDropErrorItemContext = Object.assign(ad._uiBase(), {
      kind: 'errorItem' as const,
      entry: e,
      index: i,
      file: (e.fileId && ad.getFile(e.fileId)) || null,
      row: r,
      parts: { text, retry },
      retry: () => {
        if (e.retryable) ad._uiRun('retry-entry', undefined, e);
      },
    });
    const v = runHook(ad, 'errorItem', c);
    if (v) {
      this.views.set(r, v);
      if (v.el) {
        r.textContent = '';
        r.appendChild(v.el);
        r.classList.add('ad-row-custom');
      }
    }
    return r;
  }

  destroy(): void {
    this.dom.clear();
    this.list.destroy();
    this.el.remove();
  }
}

export interface Conn {
  state: string;
  attempt: number;
  retryAt: number | null;
}

/** Connection banner: offline, or unreachable with a countdown and a "Retry now" button. */
export class Banner {
  readonly el = h('div', 'ad-banner', { hidden: true, role: 'group' });
  private text = h('span', 'ad-banner-text');
  private btn = textBtn('retry-now', '', 'ad-banner-btn');
  private timer: ReturnType<typeof setInterval> | null = null;
  private conn: Conn = { state: 'online', attempt: 0, retryAt: null };
  private dom = new Listeners();

  constructor(private ad: AnyDrop) {
    this.el.append(this.text, this.btn);
    this.dom.on(this.btn, 'click', () => ad._uiRun('retry-now'));
  }

  /** Shows the banner for `c`; the countdown ticks once a second and stops with the state. */
  set(c: Conn): void {
    this.conn = c;
    const o = this.ad.options;
    const down = c.state === 'offline' || c.state === 'unreachable';
    this.el.hidden = !down;
    this.btn.hidden = c.state !== 'unreachable';
    this.btn.textContent = o.dictRetryNow;
    this.el.setAttribute('data-state', c.state);
    if (down && c.state === 'unreachable') {
      if (!this.timer) this.timer = setInterval(() => this.paint(), 1000);
    } else this.stop();
    this.paint();
  }

  /** Seconds until the next attempt (0 when unknown). */
  seconds(): number {
    return this.conn.retryAt == null
      ? 0
      : Math.max(0, Math.ceil((this.conn.retryAt - Date.now()) / 1000));
  }

  private paint(): void {
    const o = this.ad.options;
    this.text.textContent =
      this.conn.state === 'offline'
        ? o.dictOffline
        : fmt(o.dictReconnecting, { seconds: this.seconds() });
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  destroy(): void {
    this.stop();
    this.dom.clear();
    this.el.remove();
  }
}
