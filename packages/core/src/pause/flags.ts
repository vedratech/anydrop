// Pause flags. User flags exist on the instance, on each folder (`FolderNode.userPaused`)
// and on each file; system reasons (`offline`, `hidden`) exist for the instance only. A file may
// run only if no user flag is set on it, an ancestor folder or the instance, and no system reason
// is set. Lifecycle code never clears a user flag.
import type { AnyDropFile, FolderNode, PauseReason } from '../types';

export class PauseFlags {
  /** `pause()` was called (cleared by `resume()`). */
  all = false;
  /** System reasons. `resume()` clears them all; lifecycle clears only its own. */
  readonly sys = new Set<PauseReason>();
  /** `pauseFile()` flags. */
  readonly files = new WeakSet<AnyDropFile>();

  /** Whether the whole instance is paused (user flag or any system reason). */
  any(): boolean {
    return this.all || this.sys.size > 0;
  }

  /** Whether a file may not run: a flag on it, on an ancestor folder, or on the instance. O(depth). */
  blocks(file: AnyDropFile): boolean {
    if (this.any() || this.files.has(file)) return true;
    for (let n: FolderNode | null = file.folder; n; n = n.parent) if (n.userPaused) return true;
    return false;
  }
}
