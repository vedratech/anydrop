import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  ANYDROP_IMPORTS,
  type AnyDropEventPayload,
  type AnyDropInstance,
} from '@vedratech/anydrop-angular';
import type { AnyDropConfig } from '@vedratech/anydrop-ui';
import { hi } from '@vedratech/anydrop-ui/locales/hi';
import { FileRow } from './file-row';
import { SlotCounter } from './services';

/** The scenario page of decision 0022 section 8.3. */
@Component({
  selector: 'app-root',
  imports: [ANYDROP_IMPORTS, FileRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly counter = inject(SlotCounter);

  /** Chunked uploads of folders to the mock server, through the same-origin /upload proxy. */
  protected readonly options: AnyDropConfig = {
    chunking: true,
    chunkSize: 64 * 1024,
    forceChunking: true,
    parallelUploads: 2,
    folders: true,
    preserveEmptyFolders: true,
    folderView: 'tree',
    sendManifest: true,
    manifestUrl: '/upload/manifest',
    chunkStatusUrl: '/upload/status',
    finalizeUrl: '/upload/finalize',
    maxFilesize: 64,
    retryChunksLimit: 1,
  };

  protected readonly preset = signal<string | null>(null);
  protected readonly language = signal<'en' | 'hi'>('en');
  protected readonly lang = () => (this.language() === 'hi' ? hi : 'en');

  protected readonly log = signal<string[]>([]);
  protected readonly errorCount = signal(0);
  protected readonly errorList = signal<AnyDropEventPayload<'errorlistchanged'>>([]);
  protected readonly ready = signal(false);

  private instance: AnyDropInstance | null = null;

  protected say(line: string): void {
    this.log.update((l) => l.concat(line).slice(-200));
  }

  protected onReady(instance: AnyDropInstance): void {
    this.instance = instance;
    this.ready.set(true);
  }

  protected onSuccess(e: AnyDropEventPayload<'success'>): void {
    this.say(`success ${e.file.relativePath || e.file.name}`);
  }

  protected onError(e: AnyDropEventPayload<'error'>): void {
    this.say(
      `error ${e.file.relativePath || e.file.name}: ${typeof e.message === 'string' ? e.message : JSON.stringify(e.message)}`,
    );
  }

  protected onErrors(list: AnyDropEventPayload<'errorlistchanged'>): void {
    this.errorList.set(list);
    this.errorCount.set(list.length);
  }

  protected setPreset(value: string): void {
    this.preset.set(value || null);
  }

  protected pauseAll(): void {
    this.instance?.pause();
  }

  protected resumeAll(): void {
    this.instance?.resume();
  }

  protected retryFailed(): void {
    this.instance?.retryFailedOnly();
  }

  /** In-page files in nested folders (a picked folder cannot be automated in every browser). */
  protected addSampleFolder(): void {
    const instance = this.instance;
    if (!instance) return;
    const make = (name: string, size: number) =>
      new File([new Uint8Array(size).fill(65)], name, { type: 'application/octet-stream' });
    void instance.addFile(make('notes.txt', 1200), 'Holiday');
    void instance.addFile(make('beach.bin', 300 * 1024), 'Holiday/Photos');
    void instance.addFile(make('map.bin', 200 * 1024), 'Holiday/Photos');
  }
}
