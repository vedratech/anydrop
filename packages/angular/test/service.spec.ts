import { Component, NgZone, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { defaultOptions } from '@vedratech/anydrop-core';
import { AnyDropComponent, AnyDropService, provideAnyDrop } from '../src/public-api';

const frame = () => new Promise<void>((r) => setTimeout(r, 60));

describe('AnyDropService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [AnyDropService] });
  });

  it('has server values before create()', () => {
    const svc = TestBed.inject(AnyDropService);
    expect(svc.instance()).toBeNull();
    expect(svc.files()).toEqual([]);
    expect(svc.tree()).toBeNull();
    expect(svc.errors()).toEqual([]);
    expect(svc.progress()).toEqual({ progress: 0, totalBytes: 0, totalBytesSent: 0 });
    expect(svc.connection()).toEqual({ state: 'online', attempt: 0, retryAt: null });
  });

  it('creates a headless core instance outside the zone and fills the signals', async () => {
    const svc = TestBed.inject(AnyDropService);
    let inside: boolean | null = null;
    const core = svc.create({
      url: '/upload',
      autoProcessQueue: false,
      init() {
        inside = NgZone.isInAngularZone();
      },
    } as never)!;
    expect(core).not.toBeNull();
    expect(svc.instance()).toBe(core);
    core.addFile(new File(['x'], 'a.txt'));
    await frame();
    expect(svc.files().length).toBe(1);
    expect(svc.files()[0]!.name).toBe('a.txt');
    expect(svc.tree()).toBe(core.getTree());
    // `init` is a ui option; the headless core does not call it
    expect(inside).toBeNull();
  });

  it('builds a new state at most once per frame', async () => {
    const svc = TestBed.inject(AnyDropService);
    const core = svc.create({ autoProcessQueue: false })!;
    const first = svc.state();
    core.addFile(new File(['x'], 'a.txt'));
    core.addFile(new File(['y'], 'b.txt'));
    expect(svc.state()).toBe(first);
    await frame();
    const next = svc.state();
    expect(next).not.toBe(first);
    expect(next.files.length).toBe(2);
  });

  it('on$ emits payloads inside the zone, also when subscribed before create()', () => {
    const svc = TestBed.inject(AnyDropService);
    const seen: unknown[] = [];
    let inside: boolean | null = null;
    const sub = svc.on$('emptyfolder').subscribe((p) => {
      seen.push(p);
      inside = NgZone.isInAngularZone();
    });
    const core = svc.create({ autoProcessQueue: false })!;
    core.emit('emptyfolder', 'a/b');
    expect(seen).toEqual(['a/b']);
    expect(inside).toBe(true);
    const reconnect: unknown[] = [];
    svc.on$('reconnecting').subscribe((p) => reconnect.push(p));
    core.emit('reconnecting', 2, 100);
    expect(reconnect).toEqual([{ attempt: 2, delayMs: 100 }]);
    sub.unsubscribe();
    expect(core.hasListeners('emptyfolder')).toBe(false);
    core.emit('emptyfolder', 'c');
    expect(seen).toEqual(['a/b']);
  });

  it('setOptions diffs into setOption and resets removed keys', () => {
    const svc = TestBed.inject(AnyDropService);
    const core = svc.create({ parallelUploads: 4, chunkSize: 1000 })!;
    const spy = vi.spyOn(core, 'setOption');
    svc.setOptions({ parallelUploads: 4, chunkSize: 1000 });
    expect(spy).not.toHaveBeenCalled();
    svc.setOptions({ parallelUploads: 3 });
    expect(core.options.parallelUploads).toBe(3);
    expect(core.options.chunkSize).toBe(defaultOptions().chunkSize);
  });

  it('create() again replaces the instance and destroys the old one', () => {
    const svc = TestBed.inject(AnyDropService);
    const a = svc.create({})!;
    const destroy = vi.spyOn(a, 'destroy');
    const b = svc.create({})!;
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(svc.instance()).toBe(b);
  });

  it('cleans up when the service is destroyed', () => {
    const svc = TestBed.inject(AnyDropService);
    const core = svc.create({})!;
    const destroy = vi.spyOn(core, 'destroy');
    const sub = svc.on$('emptyfolder').subscribe();
    TestBed.resetTestingModule();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(core.hasListeners('emptyfolder')).toBe(false);
    expect(core.hasListeners('addedfile')).toBe(false);
    sub.unsubscribe();
  });

  it('creates nothing on the server', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [AnyDropService, { provide: PLATFORM_ID, useValue: 'server' }],
    });
    const svc = TestBed.inject(AnyDropService);
    expect(svc.create({})).toBeNull();
    expect(svc.instance()).toBeNull();
    expect(svc.state().files).toEqual([]);
  });
});

@Component({
  standalone: true,
  imports: [AnyDropComponent],
  template: `<any-drop [options]="options" />`,
})
class DefaultsHost {
  options = { parallelUploads: 9 };
}

describe('provideAnyDrop', () => {
  it('gives defaults to the component, and the component options win', () => {
    TestBed.configureTestingModule({
      providers: [provideAnyDrop({ url: '/default', parallelUploads: 7, chunkSize: 12345 })],
    });
    const fixture = TestBed.createComponent(DefaultsHost);
    fixture.detectChanges();
    const o = (fixture.debugElement.children[0]!.componentInstance as AnyDropComponent).instance!
      .options;
    expect(o.url).toBe('/default');
    expect(o.chunkSize).toBe(12345);
    expect(o.parallelUploads).toBe(9);
  });

  it('gives defaults to the service, and create() options win', () => {
    TestBed.configureTestingModule({
      providers: [AnyDropService, provideAnyDrop({ parallelUploads: 7, chunkSize: 12345 })],
    });
    const core = TestBed.inject(AnyDropService).create({ parallelUploads: 2 })!;
    expect(core.options.chunkSize).toBe(12345);
    expect(core.options.parallelUploads).toBe(2);
  });
});
