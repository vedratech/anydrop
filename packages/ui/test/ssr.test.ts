// @vitest-environment node
import { expect, it } from 'vitest';

it('imports without window or document', async () => {
  expect(typeof document).toBe('undefined');
  const m = await import('../src/index');
  expect(typeof m.AnyDrop).toBe('function');
  expect(m.AnyDrop.isBrowserSupported()).toBe(false);
  expect(m.AnyDrop.supportsFolderPicker()).toBe(false);
});
