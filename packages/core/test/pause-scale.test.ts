// Pause and resume stay cheap on large trees (0008): one pass over the files per call.
import { describe, expect, it } from 'vitest';
import { AnyDropCore } from '../src/index';
import { BUDGET_MS, timed } from './helpers/budget';

describe('pause at scale', () => {
  it('pauses and resumes 10,000 queued files in well under a second', async () => {
    const core = new AnyDropCore({ persistState: false });
    for (let i = 0; i < 10_000; i++)
      core.addFile(new File(['x'], `f${i}.txt`), `d${i % 50}/s${i % 7}`);
    await new Promise((r) => setTimeout(r, 0));
    expect(core.getQueuedFiles()).toHaveLength(10_000);
    const ms = await timed(() => {
      core.pause();
      core.resume();
      core.pauseFolder('d1');
      core.resumeFolder('d1');
    });
    expect(core.getQueuedFiles()).toHaveLength(10_000);
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});
