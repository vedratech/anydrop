import { Component, NgZone } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { defaultOptions } from '@vedratech/anydrop-core';
import { AnyDrop } from '@vedratech/anydrop-ui';
import type { AnyDropConfig, AnyDropLayout } from '@vedratech/anydrop-ui';
import { AnyDropComponent, type AnyDropInstance } from '../src/public-api';

@Component({
  standalone: true,
  imports: [AnyDropComponent],
  template: `<any-drop
    [url]="url"
    [options]="options"
    [layout]="layout"
    [locale]="locale"
    [themePreset]="themePreset"
    [disabled]="disabled"
    (ready)="readyCount = readyCount + 1; readyInstance = $event"
    (queuecomplete)="queuecomplete($event)"
    (complete)="completed($event)"
    (reconnecting)="reconnecting($event)"
  />`,
})
class Host {
  url?: string = '/upload';
  options: AnyDropConfig | null = null;
  layout?: AnyDropLayout;
  locale?: string;
  themePreset?: string;
  disabled: boolean | string = false;
  readyCount = 0;
  readyInstance: AnyDropInstance | null = null;
  queuecomplete = vi.fn();
  completed = vi.fn();
  reconnecting = vi.fn();
}

function setup(patch: Partial<Host> = {}) {
  const fixture = TestBed.createComponent(Host);
  Object.assign(fixture.componentInstance, patch);
  fixture.detectChanges();
  return fixture;
}

function zoneOf(fixture: ComponentFixture<Host>): AnyDropComponent {
  return fixture.debugElement.children[0]!.componentInstance as AnyDropComponent;
}

/** Changes a field of the host and runs change detection, as a parent component would. */
function change(fixture: ComponentFixture<Host>, patch: Partial<Host>) {
  Object.assign(fixture.componentInstance, patch);
  fixture.detectChanges();
}

describe('AnyDropComponent', () => {
  describe('creation', () => {
    it('creates the ui instance in the inner div after the view init, and emits (ready) once', () => {
      const fixture = setup();
      const zone = zoneOf(fixture);
      expect(zone.instance).toBeInstanceOf(AnyDrop);
      const host = fixture.nativeElement.querySelector('any-drop > div') as HTMLElement;
      expect(host.classList.contains('ad-root')).toBe(true);
      expect(fixture.componentInstance.readyCount).toBe(1);
      expect(fixture.componentInstance.readyInstance).toBe(zone.instance);
      fixture.detectChanges();
      expect(fixture.componentInstance.readyCount).toBe(1);
    });

    it('creates the instance outside the Angular zone', () => {
      let inside: boolean | null = null;
      setup({
        options: {
          init() {
            inside = NgZone.isInAngularZone();
          },
        },
      });
      expect(inside).toBe(false);
    });

    it('uses the dedicated inputs over options and keeps display: block on the host', () => {
      const fixture = setup({
        options: { url: '/ignored', layout: 'list' },
        layout: 'compact',
        locale: 'hi',
      });
      const o = zoneOf(fixture).instance!.options;
      expect(o.url).toBe('/upload');
      expect(o.layout).toBe('compact');
      expect(o.locale).toBe('hi');
      expect((fixture.nativeElement.querySelector('any-drop') as HTMLElement).style.display).toBe(
        'block',
      );
    });

    it('disabled at creation disables the instance (a bare attribute is true)', () => {
      const fixture = setup({ disabled: '' });
      expect(zoneOf(fixture).instance!.disabled).toBe(true);
    });
  });

  describe('inputs and options', () => {
    it('applies a changed input with setOption and never recreates the instance', () => {
      const fixture = setup();
      const zone = zoneOf(fixture);
      const instance = zone.instance!;
      const spy = vi.spyOn(instance, 'setOption');
      change(fixture, { layout: 'compact', url: '/two' });
      expect(zone.instance).toBe(instance);
      expect(instance.options.layout).toBe('compact');
      expect(instance.options.url).toBe('/two');
      expect(spy.mock.calls.map((c) => c[0]).sort()).toEqual(['layout', 'url']);
      expect(fixture.componentInstance.readyCount).toBe(1);
    });

    it('applies disabled true and false with disable() and enable()', () => {
      const fixture = setup();
      const instance = zoneOf(fixture).instance!;
      change(fixture, { disabled: true });
      expect(instance.disabled).toBe(true);
      change(fixture, { disabled: false });
      expect(instance.disabled).toBe(false);
    });

    it('calls no setOption for inline functions, and the latest function is the one that runs', () => {
      const a = vi.fn();
      const b = vi.fn();
      const fixture = setup({ options: { queuecomplete: a } });
      const instance = zoneOf(fixture).instance!;
      const spy = vi.spyOn(instance, 'setOption');
      change(fixture, { options: { queuecomplete: b } });
      expect(spy).not.toHaveBeenCalled();
      instance.emit('queuecomplete');
      expect(a).not.toHaveBeenCalled();
      expect(b).toHaveBeenCalledTimes(1);
    });

    it('calls no setOption for structurally equal plain data, and one for a real change', () => {
      const fixture = setup({ options: { rowActions: { file: ['pause', 'cancel'] } } });
      const instance = zoneOf(fixture).instance!;
      const spy = vi.spyOn(instance, 'setOption');
      change(fixture, { options: { rowActions: { file: ['pause', 'cancel'] } } });
      expect(spy).not.toHaveBeenCalled();
      change(fixture, { options: { rowActions: { file: ['pause'] } } });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]![0]).toBe('rowActions');
    });

    it('resets a removed key to its default', () => {
      const fixture = setup({ options: { parallelUploads: 5 } });
      const instance = zoneOf(fixture).instance!;
      expect(instance.options.parallelUploads).toBe(5);
      change(fixture, { options: {} });
      expect(instance.options.parallelUploads).toBe(defaultOptions().parallelUploads);
    });

    it('resets a removed event handler key', () => {
      const a = vi.fn();
      const fixture = setup({ options: { queuecomplete: a } });
      const instance = zoneOf(fixture).instance!;
      change(fixture, { options: {} });
      instance.emit('queuecomplete');
      expect(a).not.toHaveBeenCalled();
    });

    it('ignores construction-only keys after creation and warns once in development', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const fixture = setup();
        const instance = zoneOf(fixture).instance!;
        const spy = vi.spyOn(instance, 'setOption');
        change(fixture, { options: { forceFallback: true } });
        change(fixture, { options: { forceFallback: true, fallback: () => undefined } });
        change(fixture, { options: { forceFallback: false } });
        expect(spy.mock.calls.map((c) => c[0])).not.toContain('forceFallback');
        const messages = warn.mock.calls.map((c) => String(c[0]));
        expect(messages.filter((m) => m.includes('"forceFallback"')).length).toBe(1);
        expect(messages[0]).toContain('is only read when the instance is created');
      } finally {
        warn.mockRestore();
      }
    });

    it('passes transport by identity', () => {
      // A class instance keeps its identity in the ui constructor (it clones plain object literals).
      class Transport {
        send() {
          return undefined as never;
        }
      }
      const first = new Transport();
      const fixture = setup({ options: { transport: first } });
      const instance = zoneOf(fixture).instance!;
      expect(instance.options.transport).toBe(first);
      const second = { send: () => undefined as never };
      change(fixture, { options: { transport: second } });
      expect(instance.options.transport).toBe(second);
    });
  });

  describe('outputs', () => {
    it('attaches a core listener only while an output has a subscriber', () => {
      const fixture = setup();
      const zone = zoneOf(fixture);
      const instance = zone.instance!;
      // (complete) is bound in the template; (actionclicked) is not
      expect(instance.hasListeners('complete')).toBe(true);
      expect(instance.hasListeners('actionclicked')).toBe(false);
      const sub = zone.actionclicked.subscribe(() => undefined);
      expect(instance.hasListeners('actionclicked')).toBe(true);
      const sub2 = zone.actionclicked.subscribe(() => undefined);
      sub.unsubscribe();
      expect(instance.hasListeners('actionclicked')).toBe(true);
      sub2.unsubscribe();
      expect(instance.hasListeners('actionclicked')).toBe(false);
    });

    it('emits void and object payloads from the right events', () => {
      const fixture = setup();
      const instance = zoneOf(fixture).instance!;
      instance.emit('queuecomplete');
      expect(fixture.componentInstance.queuecomplete).toHaveBeenCalledTimes(1);
      expect(fixture.componentInstance.queuecomplete.mock.calls[0]![0]).toBeUndefined();
      instance.emit('reconnecting', 3, 1500);
      expect(fixture.componentInstance.reconnecting).toHaveBeenCalledWith({
        attempt: 3,
        delayMs: 1500,
      });
    });

    it('subscribes before the instance exists, then attaches at creation', () => {
      const fixture = TestBed.createComponent(Host);
      const zone = zoneOf(fixture);
      const seen: unknown[] = [];
      zone.emptyfolder.subscribe((p) => seen.push(p));
      expect(zone.instance).toBeNull();
      fixture.detectChanges();
      zone.instance!.emit('emptyfolder', 'a/b');
      expect(seen).toEqual(['a/b']);
    });

    it('emits inside the Angular zone', () => {
      const fixture = setup();
      const zone = zoneOf(fixture);
      let inside: boolean | null = null;
      zone.emptyfolder.subscribe(() => (inside = NgZone.isInAngularZone()));
      NgZone.assertNotInAngularZone();
      zone.instance!.emit('emptyfolder', 'x');
      expect(inside).toBe(true);
    });

    it('has no output for the 7 DOM-colliding events, but has (ready)', () => {
      const zone = zoneOf(setup()) as unknown as Record<string, unknown>;
      for (const name of [
        'drop',
        'dragstart',
        'dragend',
        'dragenter',
        'dragover',
        'dragleave',
        'paste',
      ]) {
        expect(zone[name]).toBeUndefined();
      }
      expect(zone['ready']).toBeDefined();
    });
  });

  describe('destroy', () => {
    it('destroys the instance once, removes every listener and detaches', () => {
      const fixture = setup();
      const zone = zoneOf(fixture);
      const instance = zone.instance!;
      const destroy = vi.spyOn(instance, 'destroy');
      const before = AnyDrop.instances.length;
      fixture.destroy();
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(zone.instance).toBeNull();
      expect(AnyDrop.instances).not.toContain(instance);
      expect(AnyDrop.instances.length).toBe(before - 1);
      expect(instance.hasListeners('complete')).toBe(false);
      expect(instance.hasListeners('emptyfolder')).toBe(false);
    });

    it('creates no instance when the host is destroyed before the view init', () => {
      const before = AnyDrop.instances.length;
      const fixture = TestBed.createComponent(Host);
      fixture.destroy();
      expect(AnyDrop.instances.length).toBe(before);
    });
  });
});
