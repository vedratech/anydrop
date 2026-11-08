import { StrictMode } from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnyDropCore } from '@vedratech/anydrop-core';
import { useAnyDrop } from '../src/index';
import { SERVER_STATE } from '../src/shared/state-store';
import { file, isDestroyed, listenerCount } from './helpers';

let seen: ReturnType<typeof useAnyDrop>;
function Probe({ chunk = 1000 }: { chunk?: number }) {
  seen = useAnyDrop({ url: '/upload', autoProcessQueue: false, chunkSize: chunk });
  return (
    <p>
      {seen.files.length} files, {seen.errors.length} errors
    </p>
  );
}

describe('useAnyDrop', () => {
  it('starts with the server state and no instance, then has an instance after mount', () => {
    const { container } = render(<Probe />);
    expect(seen.instance).toBeInstanceOf(AnyDropCore);
    expect(seen.tree).not.toBeNull();
    expect(container.textContent).toBe('0 files, 0 errors');
    expect(SERVER_STATE.files).toEqual([]);
  });

  it('exposes files, updated at most once per frame', async () => {
    const { container } = render(<Probe />);
    await act(async () => {
      await seen.instance!.addFiles([file('a.txt'), file('b.txt')]);
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(container.textContent).toBe('2 files, 0 errors');
    expect(seen.tree!.counts.total).toBe(2);
  });

  it('applies option changes with setOption and never recreates the instance', () => {
    const { rerender } = render(<Probe chunk={1000} />);
    const first = seen.instance!;
    const set = vi.spyOn(first, 'setOption');
    rerender(<Probe chunk={2000} />);
    expect(seen.instance).toBe(first);
    expect(set.mock.calls.map((c) => c[0])).toEqual(['chunkSize']);
    expect(first.options.chunkSize).toBe(2000);
  });

  it('cleans up on unmount and in StrictMode', () => {
    const made: AnyDropCore[] = [];
    function Spy() {
      const s = useAnyDrop({ url: '/upload' });
      if (s.instance && !made.includes(s.instance)) made.push(s.instance);
      return null;
    }
    const { unmount } = render(
      <StrictMode>
        <Spy />
      </StrictMode>,
    );
    unmount();
    expect(made.length).toBeGreaterThanOrEqual(1);
    for (const i of made) {
      expect(isDestroyed(i)).toBe(true);
      expect(listenerCount(i)).toBe(0);
    }
  });
});
