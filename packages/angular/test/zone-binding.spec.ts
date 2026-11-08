import { Component, NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AnyDropFileContext } from '@vedratech/anydrop-ui';
import { ANYDROP_IMPORTS, type AnyDropComponent } from '../src/public-api';

// A plain field (not a signal): the view refreshes after a click only if the row's listener is bound
// to the Angular zone, so that the zone triggers a tick.
@Component({
  standalone: true,
  imports: [ANYDROP_IMPORTS],
  template: `<any-drop url="/upload">
    <ng-template anyDropFile let-ctx>
      <button class="b" type="button" (click)="count = count + 1">{{ count }}</button>
    </ng-template>
  </any-drop>`,
})
class PlainHost {
  count = 0;
}

describe('row template listeners and the zone', () => {
  it('bind to the Angular zone when the mount is triggered outside it', async () => {
    const fixture = TestBed.createComponent(PlainHost);
    fixture.detectChanges();
    const zone = fixture.debugElement.children[0]!.componentInstance as AnyDropComponent;
    const instance = zone.instance!;
    const ngZone = TestBed.inject(NgZone);
    let view!: { el: HTMLElement; destroy(): void };
    ngZone.runOutsideAngular(() => {
      const render = instance.options.render as unknown as Record<
        string,
        (c: unknown) => typeof view
      >;
      view = render['file']!.call(instance, {
        file: { name: 'a' },
      } as unknown as AnyDropFileContext);
    });
    document.body.appendChild(view.el);
    const button = view.el.querySelector('.b') as HTMLButtonElement;
    expect(button.textContent).toBe('0');
    const sub = ngZone.onStable.subscribe(() => undefined);
    ngZone.runOutsideAngular(() => button.click());
    // the listener itself must run in the Angular zone wherever the click was dispatched
    await fixture.whenStable();
    expect(fixture.componentInstance.count).toBe(1);
    expect(button.textContent).toBe('1');
    sub.unsubscribe();
    view.destroy();
    view.el.remove();
  });
});
