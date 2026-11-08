import { ApplicationRef, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ANYDROP_IMPORTS, type AnyDropComponent } from '../src/public-api';

@Component({
  standalone: true,
  imports: [ANYDROP_IMPORTS],
  template: `<any-drop url="/upload" [options]="{ autoProcessQueue: false }">
    <ng-template anyDropFile let-ctx
      ><b class="row">{{ ctx.file.name }}</b></ng-template
    >
  </any-drop>`,
})
class RowsHost {}

const frame = () => new Promise<void>((r) => setTimeout(r, 60));

describe('rows made by the ui', () => {
  it('mounts a slot view per added file and destroys the views with the instance', async () => {
    const fixture = TestBed.createComponent(RowsHost);
    fixture.detectChanges();
    const zone = fixture.debugElement.children[0]!.componentInstance as AnyDropComponent;
    const app = TestBed.inject(ApplicationRef);
    const base = app.viewCount;
    zone.instance!.addFile(new File(['x'], 'a.txt'));
    await frame();
    const slots = fixture.nativeElement.querySelectorAll('[data-ad-slot="file"]');
    expect(slots.length).toBe(1);
    expect(app.viewCount - base).toBe(1);
    expect(slots[0].querySelector('.row').textContent).toBe('a.txt');
    const file = zone.instance!.files[0]!;
    zone.instance!.removeFile(file);
    await frame();
    expect(fixture.nativeElement.querySelectorAll('[data-ad-slot="file"]').length).toBe(0);
    expect(app.viewCount).toBe(base);
    zone.instance!.addFile(new File(['y'], 'b.txt'));
    await frame();
    expect(app.viewCount - base).toBe(1);
    fixture.destroy();
    expect(app.viewCount).toBe(base);
  });
});
