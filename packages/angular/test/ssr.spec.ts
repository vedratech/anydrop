// @vitest-environment node
import '@angular/compiler';
import { Component, destroyPlatform, inject, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideServerRendering, renderApplication } from '@angular/platform-server';
import {
  ANYDROP_IMPORTS,
  type AnyDropComponent,
  AnyDropService,
  provideAnyDrop,
} from '../src/public-api';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ANYDROP_IMPORTS],
  providers: [AnyDropService],
  template: `<any-drop url="/upload" [options]="{ chunkSize: 1000 }" (ready)="ready.set(true)">
    <ng-template anyDropFile let-ctx>{{ ctx.file.name }}</ng-template>
  </any-drop>`,
})
class Root {
  ready = signal(false);
  static zone: AnyDropComponent | null = null;
  static service: AnyDropService | null = null;
  static created: unknown = 'not run';
  private readonly service = inject(AnyDropService);
  constructor() {
    const service = this.service;
    Root.service = service;
    Root.created = service.create({ url: '/x' });
  }
}

describe('server rendering', () => {
  it('has no browser globals in the test environment', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
    expect(typeof navigator === 'undefined' || navigator.userAgent.startsWith('Node')).toBe(true);
  });

  it('renders <any-drop><div></div></any-drop> and creates no instance', async () => {
    // the test setup created a browser testing platform; the server needs its own
    destroyPlatform();
    const html = await renderApplication(
      (context) =>
        bootstrapApplication(
          Root,
          { providers: [provideServerRendering(), provideAnyDrop({ chunkSize: 5 })] },
          context,
        ),
      { document: '<html><body><app-root></app-root></body></html>' },
    );
    expect(html).toMatch(/<any-drop[^>]*style="display: block;?"[^>]*><div><\/div><\/any-drop>/);
    // the ui never ran: no class, no children, no ready event
    expect(html).not.toContain('ad-root');
    expect(html).not.toContain('data-ad-slot');
    expect(Root.created).toBeNull();
    expect(Root.service!.instance()).toBeNull();
    expect(Root.service!.state().files).toEqual([]);
    // still no browser globals after the render
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });

  it('imports the package in plain Node without touching window or document', async () => {
    const api = await import('../src/public-api');
    expect(typeof api.AnyDropComponent).toBe('function');
    expect(typeof api.provideAnyDrop).toBe('function');
  });
});
