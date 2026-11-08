import { act } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { AnyDrop as AnyDropUI } from '@vedratech/anydrop-ui';
import { AnyDrop } from '../src/index';

it('hydrates the server output without a mismatch and then creates the instance', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const ui = <AnyDrop url="/upload" className="c" />;
  const container = document.createElement('div');
  document.body.appendChild(container);
  container.innerHTML = renderToString(ui);
  expect(AnyDropUI.instances).toHaveLength(0);
  await act(async () => {
    hydrateRoot(container, ui);
  });
  // renderToString runs here inside a DOM environment, where React 18 warns about layout effects on the
  // server. A real server has no window, so the isomorphic effect uses useEffect (see ssr.test.tsx).
  const real = error.mock.calls.filter(
    (c) => !String(c[0]).includes('useLayoutEffect does nothing'),
  );
  expect(real).toEqual([]);
  expect(AnyDropUI.instances).toHaveLength(1);
  error.mockRestore();
});
