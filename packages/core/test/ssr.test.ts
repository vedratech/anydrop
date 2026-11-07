// @vitest-environment node
// SSR safety: importing core and creating an instance must not touch window or document.
import { describe, expect, it } from 'vitest';

describe('SSR', () => {
  it('imports and constructs without window or document', async () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
    const mod = await import('../src/index');
    const core = new mod.AnyDropCore({ url: '/upload' });
    expect(core.getTree().path).toBe('');
    expect(core.filesize(1500)).toBe('<strong>1.5</strong> KB');
    core.destroy();
  });
});
