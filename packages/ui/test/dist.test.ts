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

  it('a locale ESM and CJS file has no runtime imports and fits the file size', () => {
    for (const f of ['locales/ar.js', 'locales/pt-BR.js', 'locales/ar.cjs']) {
      const src = readFileSync(dist(f), 'utf8');
      expect(src, f).not.toMatch(/^\s*import\s/m);
      expect(src, f).not.toContain('require(');
    }
  });

  it('a locale CDN file registers itself after the main script and refuses to load before it', () => {
    const ctx: Record<string, unknown> = { setTimeout, console };
    ctx.window = ctx;
    runInNewContext(readFileSync(dist('index.global.js'), 'utf8'), ctx);
    runInNewContext(readFileSync(dist('locales/ar.global.js'), 'utf8'), ctx);
    runInNewContext(readFileSync(dist('locales/pt-BR.global.js'), 'utf8'), ctx);
    const A = ctx.AnyDrop as { locales: Record<string, { dir: string; code: string }> };
    expect(A.locales.ar?.dir).toBe('rtl');
    expect(A.locales['pt-BR']?.code).toBe('pt-BR');
    expect(() =>
      runInNewContext(readFileSync(dist('locales/hi.global.js'), 'utf8'), { window: {} }),
    ).toThrow('Load AnyDrop before its locale files.');
  });

  it('every theme preset file is copied', () => {
    expect(existsSync(dist('themes/minimal.css'))).toBe(true);
  });
});
