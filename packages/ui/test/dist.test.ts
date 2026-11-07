// @vitest-environment node
// Smoke tests of the built files. They need `pnpm build` first and are skipped without it.
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const dist = (f: string) => new URL(`../dist/${f}`, import.meta.url);
const built = existsSync(dist('index.js')) && existsSync(dist('index.global.js'));

describe.skipIf(!built)('built files', () => {
  it('the ESM build imports in Node without window or document and does not auto-discover', async () => {
    expect(typeof document).toBe('undefined');
    const m = await import(dist('index.js').href);
    expect(typeof m.AnyDrop).toBe('function');
    expect(m.AnyDrop.autoDiscover).toBe(true);
    expect(m.AnyDrop.isBrowserSupported()).toBe(false);
  });

  it('the CDN build sets the class as the global, with statics, and runs without a document', () => {
    const ctx: Record<string, unknown> = { setTimeout, console };
    runInNewContext(readFileSync(dist('index.global.js'), 'utf8'), ctx);
    const A = ctx.AnyDrop as Record<string, unknown> & (new (...a: unknown[]) => unknown);
    expect(typeof A).toBe('function');
    expect(A.AnyDrop).toBe(A);
    expect(typeof A.AnyDropCore).toBe('function');
    expect(typeof A.VERSION).toBe('string');
    expect(typeof A.uiDefaults).toBe('function');
    expect(typeof A.DEFAULT_TEMPLATE).toBe('string');
    expect(typeof A.discover).toBe('function');
    expect(A.options).toEqual({});
  });
});
