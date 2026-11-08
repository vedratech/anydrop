// @vitest-environment node
import { createRef } from 'react';
import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AnyDrop, useAnyDrop } from '../src/index';
import { SERVER_STATE } from '../src/shared/state-store';

it('runs without window, document or navigator', () => {
  expect(typeof window).toBe('undefined');
  expect(typeof document).toBe('undefined');
  expect(typeof navigator === 'undefined' || typeof navigator.userAgent === 'string').toBe(true);
});

it('renders only the two empty divs on the server', () => {
  const html = renderToString(
    <AnyDrop url="/upload" id="z" className="c" onAddedfile={() => {}} renderFile={() => <b />} />,
  );
  expect(html).toBe('<div id="z" class="c"><div></div></div>');
});

it('the ref stays null and the headless hook returns the server state', () => {
  const ref = createRef<never>();
  renderToString(<AnyDrop ref={ref} url="/upload" />);
  expect(ref.current).toBeNull();
  let seen: ReturnType<typeof useAnyDrop> | undefined;
  function Probe() {
    seen = useAnyDrop({ url: '/upload' });
    return null;
  }
  renderToString(<Probe />);
  expect(seen!.instance).toBeNull();
  expect(seen!.files).toBe(SERVER_STATE.files);
  expect(seen!.tree).toBeNull();
  expect(seen!.connection.state).toBe('online');
});
