import {
  ApplicationRef,
  Component,
  NgZone,
  provideExperimentalZonelessChangeDetection,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AnyDropFileContext } from '@vedratech/anydrop-ui';
import { ANYDROP_IMPORTS, type AnyDropComponent } from '../src/public-api';

@Component({
  standalone: true,
  imports: [ANYDROP_IMPORTS],
  template: `<any-drop
      url="/upload"
      [layout]="layout()"
      (ready)="ready.set(true)"
      (emptyfolder)="addFolder($event)"
    >
      <ng-template anyDropFile let-ctx>
        <span class="n">{{ ctx.file.name }}</span>
        <button class="b" type="button" (click)="clicks.set(clicks() + 1)">{{ clicks() }}</button>
      </ng-template>
    </any-drop>
    <p class="folders">{{ folders().join(',') }}</p>`,
})
class ZonelessHost {
  layout = signal<'list' | 'compact'>('list');
  ready = signal(false);
  clicks = signal(0);
  folders = signal<string[]>([]);
  addFolder(path: string) {
    this.folders.update((list) => list.concat(path));
  }
}

describe('zoneless', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideExperimentalZonelessChangeDetection()] });
  });

  it('runs without NgZone ticks: creates the instance, applies input changes, emits outputs', async () => {
    const fixture = TestBed.createComponent(ZonelessHost);
    await fixture.whenStable();
    const zone = fixture.debugElement.children[0]!.componentInstance as AnyDropComponent;
    expect(zone.instance).not.toBeNull();
    expect(fixture.componentInstance.ready()).toBe(true);

    fixture.componentInstance.layout.set('compact');
    await fixture.whenStable();
    expect(zone.instance!.options.layout).toBe('compact');

    zone.instance!.emit('emptyfolder', 'a');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.folders').textContent).toBe('a');
  });

  it('refreshes a slot view after a click and after an update, with no zone', async () => {
    const fixture = TestBed.createComponent(ZonelessHost);
    await fixture.whenStable();
    const zone = fixture.debugElement.children[0]!.componentInstance as AnyDropComponent;
    const instance = zone.instance!;
    const app = TestBed.inject(ApplicationRef);
    const base = app.viewCount;
    const render = instance.options.render as unknown as Record<
      string,
      (c: unknown) => { el: HTMLElement; update(c: unknown): void; destroy(): void }
    >;
    const ctx = (name: string) => ({ file: { name } }) as unknown as AnyDropFileContext;
    const view = render['file']!.call(instance, ctx('one'));
    document.body.appendChild(view.el);
    expect(app.viewCount).toBe(base + 1);
    const span = view.el.querySelector('.n') as HTMLElement;
    expect(span.textContent).toBe('one');

    view.update(ctx('two'));
    expect(span.textContent).toBe('two');

    (view.el.querySelector('.b') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(view.el.querySelector('.b')!.textContent).toBe('1');

    view.destroy();
    view.el.remove();
    expect(app.viewCount).toBe(base);
  });

  it('uses no real zone and cleans up on destroy', async () => {
    const fixture = TestBed.createComponent(ZonelessHost);
    await fixture.whenStable();
    expect(TestBed.inject(NgZone).constructor.name).toBe('NoopNgZone');
    const zone = fixture.debugElement.children[0]!.componentInstance as AnyDropComponent;
    const instance = zone.instance!;
    fixture.destroy();
    expect(zone.instance).toBeNull();
    expect(instance.hasListeners('emptyfolder')).toBe(false);
  });
});
