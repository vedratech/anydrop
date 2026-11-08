---
title: "Angular file and folder upload"
description: "AnyDrop for Angular: a standalone <any-drop> component with outputs for every event, template slots for custom rows, an AnyDropService with signals, server rendering and zoneless support."
---

# Angular

`@vedratech/anydrop-angular` wraps the AnyDrop UI in a standalone component and the headless core in a service. It needs Angular 18 or newer, works with server rendering and hydration, and runs with or without zone.js. Everything the [UI](/guide/quick-start) does is available: folders, chunked uploads, pause and resume, the error list, themes and languages.

## Install

```sh
npm install @vedratech/anydrop-angular @vedratech/anydrop-ui @vedratech/anydrop-core
```

`@angular/core`, `@angular/common`, `rxjs`, `@vedratech/anydrop-ui` and `@vedratech/anydrop-core` are peer dependencies. Add the stylesheet to the `styles` array in `angular.json`:

```json
"styles": [
  "node_modules/@vedratech/anydrop-ui/dist/style.css",
  "src/styles.css"
]
```

or import it in `src/styles.css`:

```css
@import '@vedratech/anydrop-ui/style.css';
```

Theme files work the same way, for example `@vedratech/anydrop-ui/themes/rounded.css`. See [Themes](/guide/themes).

The package is distributed as ES modules only (Angular Package Format). It is compiled with Angular 18 and linked by the Angular compiler of your app, so it works on 18 and every later version.

## Your first uploader

```ts
import { Component } from '@angular/core';
import { ANYDROP_IMPORTS, type AnyDropEventPayload } from '@vedratech/anydrop-angular';

@Component({
  standalone: true,
  selector: 'app-uploader',
  imports: [ANYDROP_IMPORTS],
  template: `
    <any-drop
      url="/upload"
      [options]="options"
      (success)="onSuccess($event)"
      (queuecomplete)="done()"
    />
  `,
})
export class UploaderComponent {
  options = { chunking: true, sendManifest: true, manifestUrl: '/upload/manifest' };

  onSuccess({ file }: AnyDropEventPayload<'success'>) {
    console.log('uploaded', file.name);
  }
  done() {
    console.log('all done');
  }
}
```

`ANYDROP_IMPORTS` is a list with the component and the five template directives. You can also import `AnyDropComponent` alone. `url` is required, either as the input or as `options.url`. Without one the constructor of the UI throws `No URL provided.`

## Inputs

| Input | Type | Description |
|---|---|---|
| `options` | `AnyDropConfig \| null` | The full configuration: every [UI and core option](/api/options). Replace the object to change an option. Mutating it is not detected, which matches `OnPush`. |
| `url` | `AnyDropConfig['url']` (string or function) | Overrides `options.url` when set. |
| `locale` | `AnyDropConfig['locale']` | Overrides `options.locale`. A language pack object or the code of a registered one. See [Languages](/guide/languages). |
| `themePreset` | `AnyDropConfig['themePreset']` | Overrides `options.themePreset`. |
| `layout` | `AnyDropLayout` | Overrides `options.layout`. See [Layouts](/guide/layouts). |
| `disabled` | `boolean` | `true` calls `disable()`, `false` calls `enable()`. A bare attribute (`<any-drop disabled>`) counts as `true`. |

Priority, from lowest to highest: the defaults from [`provideAnyDrop`](#provideanydrop), then `options`, then the dedicated inputs (only when they are not `undefined`). Attributes and classes on `<any-drop>` (`id`, `class`) are normal Angular host attributes. The element is `display: block`.

### Changing inputs later

The instance is created once, in `ngAfterViewInit`, and is never recreated because an input changed. Changed values go to `setOption()`:

- **Inline values are fine.** Plain data (arrays and plain objects) is compared by value, and a function in `options` is called through a stable wrapper that always runs the latest function, so a new `options` object with the same content does nothing.
- **A removed option goes back to its default.**
- **Some options are read only when the instance is created:** `init`, `fallback` and `forceFallback`. Changing them later is ignored, and in development mode the console says so once. To apply a change, remove the component and create it again (for example with `@if`). The component does not recreate the instance by itself, because that would stop uploads in progress and drop the file list.
- Changes in the middle of an upload behave as they do in the UI: a new `url` applies to the next request, and `render` or `layout` rebuild the panel.
- `transport` is passed by identity and never cloned. (In ui 0.1.0 only, a plain-object `transport` given at creation was copied by the UI; update to ui 0.1.1 or later.)

## Outputs

The outputs have the same names as the core events: `(addedfile)`, `(uploadprogress)`, `(errorlistchanged)`. The payload rule:

- An event with no arguments gives `EventEmitter<void>`.
- An event with one argument gives that value as `$event`.
- An event with several arguments gives one object with named keys, as `$event`: `(success)="onSuccess($event.file, $event.response)"`.

Outputs are lazy: the listener on the instance exists only while the output has a subscriber, so an output you do not bind costs nothing. Handlers run inside the Angular zone, so state they change is rendered with zone.js. Files and folders in payloads are the live core objects.

| Output | Payload |
|---|---|
| `(ready)` | `AnyDropInstance`. Emitted once, as soon as the instance exists. Not a core event. |
| `(addedfile)`, `(removedfile)`, `(processing)`, `(canceled)`, `(complete)`, `(maxfilesexceeded)` | `AnyDropFile` |
| `(addedfiles)`, `(processingmultiple)`, `(canceledmultiple)`, `(completemultiple)`, `(maxfilesreached)` | `AnyDropFile[]` |
| `(reset)`, `(queuecomplete)`, `(offline)`, `(online)` | none |
| `(emptyfolder)` | `string` (the folder path) |
| `(addedfolder)`, `(removedfolder)`, `(foldercomplete)` | `FolderNode` |
| `(folderprogress)` | `{ folder: FolderNode; progress: number; bytesSent: number }` |
| `(thumbnail)` | `{ file: AnyDropFile; dataUrl: string }` |
| `(uploadprogress)` | `{ file: AnyDropFile; progress: number; bytesSent: number }` |
| `(totaluploadprogress)` | `{ progress: number; totalBytes: number; totalBytesSent: number }` |
| `(sending)` | `{ file: AnyDropFile; xhr: XMLHttpRequest; formData?: FormData }` |
| `(sendingmultiple)` | `{ files: AnyDropFile[]; xhr: XMLHttpRequest; formData?: FormData }` |
| `(success)` | `{ file: AnyDropFile; response: unknown; progressEvent?: ProgressEvent \| null }` |
| `(successmultiple)` | `{ files: AnyDropFile[]; response: unknown; progressEvent?: ProgressEvent \| null }` |
| `(error)` | `{ file: AnyDropFile; message: unknown; xhr?: XMLHttpRequest }` |
| `(errormultiple)` | `{ files: AnyDropFile[]; message: unknown; xhr?: XMLHttpRequest }` |
| `(paused)`, `(resumed)` | `PauseTarget` |
| `(reconnecting)` | `{ attempt: number; delayMs: number }` |
| `(errorlistchanged)` | `ErrorEntry[]` |
| `(actionclicked)` | `{ action: string; target: AnyDropFile \| FolderNode }` |

That is 34 outputs plus `(ready)`. The type of a payload is `AnyDropEventPayload<'success'>`, and the whole map is `AnyDropEventPayloads`; both are exported.

### Progress and change detection

The component creates the instance outside the Angular zone, so drag-over, progress and painting cause no change detection. Emitting an output goes back into the zone, so **binding `(uploadprogress)` makes one change detection run for each progress event.** For a progress bar bind `(totaluploadprogress)`, or use the signals of [`AnyDropService`](#anydropservice), which are updated at most once per animation frame.

### Why drop, drag and paste are not outputs

Seven core events are not outputs: `drop`, `dragstart`, `dragend`, `dragenter`, `dragover`, `dragleave` and `paste`. They are native DOM events, and they bubble from inside `<any-drop>` to the host element. Angular binds `(drop)` on a component both to an output of that name and to the native event of the host, so the handler would run twice with two different meanings. The names are left out instead of being renamed, because the native events already reach the host. Use the native binding, which receives the same `DragEvent` or `ClipboardEvent`:

```html
<any-drop url="/upload" (drop)="onDrop($event)" (paste)="onPaste($event)" />
```

or subscribe on the instance:

```ts
onReady(instance: AnyDropInstance) {
  instance.on('dragover', (event) => { /* DragEvent */ });
}
```

Other names, such as `(error)` and `(reset)`, collide with no DOM event that reaches the host in practice, so they stay. If you run the `no-output-native` rule of `angular-eslint`, it flags those two outputs; it is safe to turn it off for them.

## Accessing the instance

The instance has every [method](/api/methods): `pause()`, `resume()`, `retryFailedOnly()`, `getErrors()`, `addFile()`. There are two ways to reach it:

```html
<any-drop #drop="anyDrop" url="/upload" (ready)="instance = $event" />
<button type="button" (click)="drop.instance?.pause()">Pause all</button>
```

- `(ready)` gives you the instance as soon as it exists.
- The component is exported as `anyDrop`, so a template reference variable gives you its public `instance` property. A `@ViewChild(AnyDropComponent)` query works too.

`instance` is `null` on the server and before the view is initialised.

## Render slots

A template directive replaces the default content of one part of the UI with a real Angular template. There are five, one for each [render hook](/guide/render-hooks):

| Directive | Context type | Replaces |
|---|---|---|
| `<ng-template anyDropFile let-ctx>` | `AnyDropFileContext` | The content of a file row |
| `<ng-template anyDropFolder let-ctx>` | `AnyDropFolderContext` | The content of a folder row |
| `<ng-template anyDropToolbar let-ctx>` | `AnyDropToolbarContext` | The toolbar |
| `<ng-template anyDropMessage let-ctx>` | `AnyDropMessageContext` | The drop message and the empty state |
| `<ng-template anyDropErrorItem let-ctx>` | `AnyDropErrorItemContext` | A row of the error panel |

The context is `{ $implicit: ctx }`, and it is typed, so `let-ctx` has the right type in strict templates. The context types come from `@vedratech/anydrop-ui`, and their fields are listed in [Render hooks](/guide/render-hooks).

```ts
import { Component, Input } from '@angular/core';
import type { AnyDropFileContext } from '@vedratech/anydrop-ui';

@Component({
  standalone: true,
  selector: 'app-file-row',
  template: `
    <div class="row">
      <strong>{{ ctx.label }}</strong>
      <span>{{ ctx.progress }}%</span>
      @if (ctx.can.pause) {
        <button type="button" (click)="ctx.pause()">Pause</button>
      }
      @if (ctx.can.resume) {
        <button type="button" (click)="ctx.resume()">Resume</button>
      }
    </div>
  `,
})
export class FileRowComponent {
  @Input({ required: true }) ctx!: AnyDropFileContext;
}
```

```html
<any-drop url="/upload">
  <ng-template anyDropFile let-ctx>
    <app-file-row [ctx]="ctx" />
  </ng-template>
</any-drop>
```

How slots behave:

- **A row is created once and updated in place.** On every progress update the same view gets a new `ctx` and is refreshed. Component state and focus survive, so a menu or a text field in a row does not reset while the file uploads. Error panel rows are shown once and never updated.
- **Rows are real parts of your application.** Dependency injection works as it does for any template, because the view comes from where the template is declared. Clicks, the `async` pipe and signals inside a row refresh it.
- **A row lives as long as its row on screen, not as long as its file.** Progress and status changes update the same view. A structural change destroys it and creates a new one: files or folders added or removed, a folder expanded or collapsed, a row scrolled out of the virtualised list, or a `render` or `layout` rebuild. State that must survive (open details, typed text) belongs outside the row, in a service or a store, keyed by `ctx.file.id`.
- **A slot is a replace.** While a directive is present it replaces the default content. To keep the default and add to it, use the `render` option (decorate mode, see [Render hooks](/guide/render-hooks)). A slot overrides the same key of `options.render`.
- **A slot that appears or disappears rebuilds the panel**, and so does a template that changes identity (for example one inside an `@if` that toggles).
- **A throwing row does not take down the uploader.** The error goes to Angular's `ErrorHandler`.
- Keep the content inside the row height (`rowHeight`, `errorRowHeight`) and make interactive elements real buttons of at least 44 by 44 px.
- The `<any-drop>` element takes only these templates as content. The library owns everything else inside it.

## `AnyDropService`

`AnyDropService` is the headless route: a core instance (no UI) with signals and observables, for when you build your own interface. It is not `providedIn: 'root'`. Add it to the `providers` of a component, which also ties the instance to that component's lifetime:

```ts
import { Component, OnInit, inject } from '@angular/core';
import { AnyDropService } from '@vedratech/anydrop-angular';

@Component({
  standalone: true,
  selector: 'app-my-uploader',
  providers: [AnyDropService],
  template: `
    <div (dragover)="$event.preventDefault()" (drop)="onDrop($event)">Drop files here</div>
    <p>{{ files().length }} files, {{ progress().progress }}%</p>
    <p>{{ errors().length }} failed, connection {{ connection().state }}</p>
  `,
})
export class MyUploaderComponent implements OnInit {
  private readonly ad = inject(AnyDropService);
  files = this.ad.files;
  errors = this.ad.errors;
  progress = this.ad.progress;
  connection = this.ad.connection;

  ngOnInit() {
    this.ad.create({ url: '/upload', chunking: true });
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.ad.instance()?.drop(event); // call it synchronously
  }
}
```

| Member | Type | Description |
|---|---|---|
| `create(options)` | `(AnyDropCoreConfig) => AnyDropCore \| null` | Creates the instance, in the browser only. A previous one is destroyed first. Returns `null` on the server. |
| `setOptions(options)` | `(AnyDropCoreConfig) => void` | Applies changed options with `setOption()`, with the same rules as the component. |
| `on$(event)` | `(name) => Observable<payload>` | An observable of one event. It can be subscribed to before `create()`. It emits inside the zone. |
| `instance` | `Signal<AnyDropCore \| null>` | The core instance. |
| `state` | `Signal<AnyDropState>` | All of the following together. |
| `files` | `Signal<readonly AnyDropFile[]>` | A copy of the file list. |
| `tree` | `Signal<FolderNode \| null>` | The live root of the folder tree. Its identity does not change, so this signal notifies on every update. |
| `errors` | `Signal<readonly ErrorEntry[]>` | The error list. |
| `progress` | `Signal<{ progress: number; totalBytes: number; totalBytesSent: number }>` | Overall progress, 0 to 100. |
| `connection` | `Signal<ConnectionState>` | `{ state: 'online' \| 'offline' \| 'unreachable', attempt, retryAt }` |

The state is rebuilt at most once per animation frame. On the server `instance()` is `null` and the state is empty. See [Headless core](/guide/headless-core) for the instance.

```ts
this.ad.on$('success').subscribe(({ file, response }) => console.log(file.name, response));
```

## `provideAnyDrop`

`provideAnyDrop(defaults)` sets default options for every `<any-drop>` and every `AnyDropService` in the application. The options of a component or service win over these defaults:

```ts
import { ApplicationConfig } from '@angular/core';
import { provideAnyDrop } from '@vedratech/anydrop-angular';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAnyDrop({ url: '/upload', chunking: true, retryChunksLimit: 2 }),
  ],
};
```

The defaults are available as the token `ANYDROP_DEFAULTS`. With the defaults above, `<any-drop />` needs no `url`.

## Server rendering

Nothing touches `window` or `document` when the package is imported or while Angular renders on the server. The server output is `<any-drop><div></div></any-drop>`. The instance is created in the browser, in `ngAfterViewInit`, after hydration, and only inside the browser (the component checks the platform). Hydration is kept: the library writes only inside the inner `div`, which Angular does not manage. On the server `instance` is `null` and no output fires. The uploader appears one layout pass after hydration; give `<any-drop>` a `min-height` in CSS if layout shift matters.

```ts
// app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideClientHydration } from '@angular/platform-browser';
import { provideAnyDrop } from '@vedratech/anydrop-angular';

export const appConfig: ApplicationConfig = {
  providers: [provideClientHydration(), provideAnyDrop({ url: '/upload' })],
Current Angular releases (tested on 18.2.14 and 22.2) need the server entry to pass the bootstrap context to `bootstrapApplication` as a third argument:
```

On Angular 18.2, the server entry must pass the platform context to `bootstrapApplication` as a third argument, as every Angular 18.2 server entry does:

```ts
// main.server.ts
import { bootstrapApplication, type BootstrapContext } from '@angular/platform-browser';
import { App } from './app/app';
import { config } from './app/app.config.server';

const bootstrap = (context: BootstrapContext) => bootstrapApplication(App, config, context);
export default bootstrap;
```

Uploads come from the browser, so `/upload` must reach your backend from the page origin. The example app keeps the browser on one origin: its `src/server.ts` forwards `/upload` to the upload backend with a small Express handler, and `proxy.conf.mjs` does the same for `ng serve`. A complete SSR app is in `examples/angular` in the repository.

## Zoneless mode

The component works in zoneless applications (`provideExperimentalZonelessChangeDetection()` on Angular 18 and 19, `provideZonelessChangeDetection()` from Angular 20). Nothing in the wrapper depends on zone ticks: slot views are refreshed explicitly and attached to the application. The usual zoneless rules apply to your code:

- Handlers of outputs that change state must use signals (or call `markForCheck`). A plain property change is not rendered without zone.js.
- A component inside a slot template reads signals, or calls `markForCheck`, for its own state. A row is refreshed with each progress update, but a state change that happens in between needs a signal.

## Recipes

### Pause and resume buttons

```ts
@Component({
  standalone: true,
  selector: 'app-uploader',
  imports: [ANYDROP_IMPORTS],
  template: `
    <any-drop #drop="anyDrop" url="/upload" [options]="options" />
    <button type="button" (click)="drop.instance?.pause()">Pause all</button>
    <button type="button" (click)="drop.instance?.resume()">Resume all</button>
  `,
})
export class UploaderComponent {
  options = { chunking: true };
}
```

`pause()` and `resume()` act on everything. For one folder or one file use `pauseFolder(path)` and `pauseFile(file)`. See [Pause and resume](/guide/pause-resume).

### Your own error list

```ts
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ANYDROP_IMPORTS, type AnyDropEventPayload, type AnyDropInstance } from '@vedratech/anydrop-angular';

@Component({
  standalone: true,
  selector: 'app-uploader',
  imports: [ANYDROP_IMPORTS],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <any-drop url="/upload" (ready)="instance = $event" (errorlistchanged)="errors.set($event)" />
    <h2>Failed uploads ({{ errors().length }})</h2>
    <button type="button" [disabled]="!errors().length" (click)="instance?.retryFailedOnly()">
      Retry failed
    </button>
    <ul>
      @for (e of errors(); track $index) {
        <li>{{ e.relativePath }}: {{ e.code }} ({{ e.message }})</li>
      }
    </ul>
  `,
})
export class UploaderComponent {
  instance: AnyDropInstance | null = null;
  errors = signal<AnyDropEventPayload<'errorlistchanged'>>([]);
}
```

The built-in error panel is still shown. Turn it off with the `errorPanel` option if you only want your own list. See [Errors and retry](/guide/errors-retry).

### A custom row with an injected service

A row component can inject services like any component:

```ts
@Component({
  standalone: true,
  selector: 'app-file-row',
  template: `
    <div class="row">
      <strong>{{ ctx.label }}</strong>
      <span>{{ ctx.status }} {{ ctx.progress }}%</span>
      <span>{{ labels.suffix }}</span>
      <button type="button" (click)="ctx.pause()" [hidden]="!ctx.can.pause">Pause</button>
    </div>
  `,
})
export class FileRowComponent {
  @Input({ required: true }) ctx!: AnyDropFileContext;
  readonly labels = inject(RowLabels);
}
```

```html
<any-drop url="/upload">
  <ng-template anyDropFile let-ctx>
    <app-file-row [ctx]="ctx" />
  </ng-template>
</any-drop>
```

For small changes (an extra button, a badge) you do not need a slot: `rowActions` and `render` add to the default row. See [Row actions and icons](/guide/row-actions-icons).

### Themes and languages at runtime

```ts
import { hi } from '@vedratech/anydrop-ui/locales/hi';

@Component({
  standalone: true,
  imports: [ANYDROP_IMPORTS],
  template: `<any-drop url="/upload" [locale]="hi" themePreset="rounded" layout="compact" />`,
})
export class UploaderComponent {
  hi = hi;
}
```

Changing `locale`, `themePreset` or `layout` later calls `setOption()`, and the uploader updates without being recreated.

## Sizes

The Angular wrapper is about 5.2 kB gzip on top of AnyDrop, without Angular. That file holds partial declarations that your build links, so it is a guide and not the shipped cost. See the [size comparison](/size-comparison) for the numbers of core and ui.

## Exported types

| Type | What it describes |
|---|---|
| `AnyDropSlotContext` | The `let-ctx` context given to every slot template. |
| `AnyDropFileTemplate`, `AnyDropFolderTemplate`, `AnyDropToolbarTemplate`, `AnyDropMessageTemplate`, `AnyDropErrorItemTemplate` | The slot directives (`anyDropFile` …). |
| `AnyDropEventPayloads` / `AnyDropEventPayload<K>` | Payload of every output, by event name. |
| `AnyDropState` / `AnyDropProgress` | The state exposed by `AnyDropService`. |
| `AnyDropInstance` | The type of `instance` on the component. |
