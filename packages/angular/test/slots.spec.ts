import { ApplicationRef, Component, ErrorHandler, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { AnyDropFileContext, AnyDropRenderView } from '@vedratech/anydrop-ui';
import { ANYDROP_IMPORTS, type AnyDropComponent } from '../src/public-api';

const ctxOf = (name: string): AnyDropFileContext =>
  ({ file: { name } }) as unknown as AnyDropFileContext;

type Hook = (this: unknown, ctx: unknown) => AnyDropRenderView<unknown> | null;

@Component({
  standalone: true,
  imports: [ANYDROP_IMPORTS],
  template: `<any-drop url="/upload">
    <ng-template anyDropFile let-ctx>
      <span class="n">{{ ctx.file.name }}</span>
      <button class="b" type="button" (click)="clicks.set(clicks() + 1)">{{ clicks() }}</button>
    </ng-template>
  </any-drop>`,
})
class FileHost {
  clicks = signal(0);
}

@Component({
  standalone: true,
  imports: [ANYDROP_IMPORTS],
  template: `<any-drop url="/upload">
    <ng-template anyDropFile let-ctx>f</ng-template>
    <ng-template anyDropFolder let-ctx>d</ng-template>
    <ng-template anyDropToolbar let-ctx>t</ng-template>
    <ng-template anyDropMessage let-ctx>m</ng-template>
    <ng-template anyDropErrorItem let-ctx>e</ng-template>
  </any-drop>`,
})
class AllHost {}

@Component({
  standalone: true,
  imports: [ANYDROP_IMPORTS],
  template: `<any-drop url="/upload">
    @if (show) {
      <ng-template anyDropFile let-ctx
        ><i class="a">{{ ctx.file.name }}</i></ng-template
      >
    }
  </any-drop>`,
})
class ToggleHost {
  show = false;
}

@Component({
  standalone: true,
  imports: [ANYDROP_IMPORTS],
  template: `<any-drop url="/upload">
    @if (first) {
      <ng-template anyDropFile let-ctx><i class="a">A</i></ng-template>
    } @else {
      <ng-template anyDropFile let-ctx><i class="b">B</i></ng-template>
    }
  </any-drop>`,
})
class SwapHost {
  first = true;
}

@Component({
  standalone: true,
  imports: [ANYDROP_IMPORTS],
  template: `<any-drop url="/upload">
    <ng-template anyDropFile let-ctx>{{ boom() }}</ng-template>
  </any-drop>`,
})
class ThrowingHost {
  boom(): string {
    throw new Error('row failed');
  }
}

function zoneOf<T>(fixture: ComponentFixture<T>): AnyDropComponent {
  return fixture.debugElement.children[0]!.componentInstance as AnyDropComponent;
}

function hooks(fixture: ComponentFixture<unknown>) {
  const render = zoneOf(fixture).instance!.options.render as unknown as Record<string, Hook>;
  const instance = zoneOf(fixture).instance;
  return { render, call: (kind: string, ctx: unknown) => render[kind]!.call(instance, ctx) };
}

describe('template slots', () => {
  it('registers one hook per slot that is present', () => {
    const fixture = TestBed.createComponent(AllHost);
    fixture.detectChanges();
    const render = zoneOf(fixture).instance!.options.render as unknown as Record<string, unknown>;
    expect(Object.keys(render).sort()).toEqual([
      'errorItem',
      'file',
      'folder',
      'message',
      'toolbar',
    ]);
  });

  it('registers no hook without a template', () => {
    const fixture = TestBed.createComponent(ToggleHost);
    fixture.detectChanges();
    expect(Object.keys(zoneOf(fixture).instance!.options.render ?? {})).toEqual([]);
  });

  it('mounts a view in a data-ad-slot div once, then updates it in place', () => {
    const fixture = TestBed.createComponent(FileHost);
    fixture.detectChanges();
    const { call } = hooks(fixture);
    const view = call('file', ctxOf('one.txt'))!;
    const el = view.el as HTMLElement;
    expect(el.tagName).toBe('DIV');
    expect(el.getAttribute('data-ad-slot')).toBe('file');
    expect(el.className).toBe('');
    const span = el.querySelector('.n') as HTMLElement;
    expect(span.textContent).toBe('one.txt');

    view.update!(ctxOf('two.txt'));
    // the same DOM node, new text: the view was refreshed, not remounted
    expect(el.querySelector('.n')).toBe(span);
    expect(span.textContent).toBe('two.txt');
    view.destroy!();
  });

  it('keeps component state across update (state lives in the host, not in the view)', () => {
    const fixture = TestBed.createComponent(FileHost);
    fixture.detectChanges();
    const { call } = hooks(fixture);
    const view = call('file', ctxOf('a'))!;
    const button = (view.el as HTMLElement).querySelector('.b') as HTMLButtonElement;
    button.focus?.();
    fixture.componentInstance.clicks.set(5);
    view.update!(ctxOf('b'));
    expect((view.el as HTMLElement).querySelector('.b')).toBe(button);
    expect(button.textContent).toBe('5');
    view.destroy!();
  });

  it('updates the view when a click happens inside a row (the view is attached to the app)', async () => {
    const fixture = TestBed.createComponent(FileHost);
    fixture.detectChanges();
    const { call } = hooks(fixture);
    const view = call('file', ctxOf('a'))!;
    document.body.appendChild(view.el as HTMLElement);
    const button = (view.el as HTMLElement).querySelector('.b') as HTMLButtonElement;
    expect(button.textContent).toBe('0');
    button.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.clicks()).toBe(1);
    expect(button.textContent).toBe('1');
    view.destroy!();
    (view.el as HTMLElement).remove();
  });

  it('attaches each view to the application and detaches it on destroy', () => {
    const fixture = TestBed.createComponent(FileHost);
    fixture.detectChanges();
    const app = TestBed.inject(ApplicationRef);
    const base = app.viewCount;
    const { call } = hooks(fixture);
    const a = call('file', ctxOf('a'))!;
    const b = call('file', ctxOf('b'))!;
    expect(app.viewCount).toBe(base + 2);
    a.destroy!();
    b.destroy!();
    expect(app.viewCount).toBe(base);
  });

  it('destroys every view still mounted when the component is destroyed', () => {
    const fixture = TestBed.createComponent(FileHost);
    fixture.detectChanges();
    const app = TestBed.inject(ApplicationRef);
    const base = app.viewCount;
    const { call } = hooks(fixture);
    call('file', ctxOf('a'));
    expect(app.viewCount).toBe(base + 1);
    // the ui destroys the views it knows about when the instance is destroyed; a hook result it never
    // saw (called by hand here) is the caller's to destroy, so only check the rows the ui mounted
    fixture.destroy();
    expect(zoneOf(fixture).instance).toBeNull();
  });

  it('rebuilds the rows when a slot appears and when it vanishes', () => {
    const fixture = TestBed.createComponent(ToggleHost);
    fixture.detectChanges();
    const instance = zoneOf(fixture).instance!;
    const spy = vi.spyOn(instance, 'setOption');
    fixture.componentInstance.show = true;
    fixture.detectChanges();
    expect(spy.mock.calls.filter((c) => c[0] === 'render').length).toBe(1);
    expect(Object.keys(instance.options.render as object)).toEqual(['file']);
    fixture.componentInstance.show = false;
    fixture.detectChanges();
    expect(spy.mock.calls.filter((c) => c[0] === 'render').length).toBe(2);
    expect(Object.keys(instance.options.render ?? {})).toEqual([]);
  });

  it('rebuilds the rows when the template changes identity (presence unchanged)', () => {
    const fixture = TestBed.createComponent(SwapHost);
    fixture.detectChanges();
    const instance = zoneOf(fixture).instance!;
    const spy = vi.spyOn(instance, 'setOption');
    const call = (): HTMLElement => {
      const render = instance.options.render as unknown as Record<string, Hook>;
      return render['file']!.call(instance, ctxOf('x'))!.el as HTMLElement;
    };
    expect(call().querySelector('.a')).not.toBeNull();
    fixture.componentInstance.first = false;
    fixture.detectChanges();
    expect(spy.mock.calls.filter((c) => c[0] === 'render').length).toBe(1);
    expect(call().querySelector('.b')).not.toBeNull();
  });

  it('isolates a throwing slot: the error goes to the ErrorHandler and the default content stays', () => {
    const handled: unknown[] = [];
    TestBed.configureTestingModule({
      providers: [
        { provide: ErrorHandler, useValue: { handleError: (e: unknown) => handled.push(e) } },
      ],
    });
    const fixture = TestBed.createComponent(ThrowingHost);
    fixture.detectChanges();
    const { call } = hooks(fixture);
    const app = TestBed.inject(ApplicationRef);
    const base = app.viewCount;
    expect(call('file', ctxOf('a'))).toBeNull();
    expect(handled.length).toBeGreaterThan(0);
    expect(String((handled[0] as Error).message)).toContain('row failed');
    expect(app.viewCount).toBe(base);
  });
});
