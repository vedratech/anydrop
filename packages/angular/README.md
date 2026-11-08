# @vedratech/anydrop-angular

**Angular component for folder upload: drag and drop folders, chunked and resumable uploads, pause and resume, retry. Part of [AnyDrop](https://github.com/vedratech/anydrop).**

[![npm version](https://img.shields.io/npm/v/@vedratech/anydrop-angular.svg)](https://www.npmjs.com/package/@vedratech/anydrop-angular)
[![npm downloads](https://img.shields.io/npm/dm/@vedratech/anydrop-angular.svg)](https://www.npmjs.com/package/@vedratech/anydrop-angular)
[![bundle size](https://deno.bundlejs.com/badge?q=@vedratech/anydrop-angular)](https://bundlejs.com/?q=@vedratech/anydrop-angular)
[![CI](https://github.com/vedratech/anydrop/actions/workflows/ci.yml/badge.svg)](https://github.com/vedratech/anydrop/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/npm/l/@vedratech/anydrop-angular.svg)](https://github.com/vedratech/anydrop/blob/main/LICENSE)
[![docs](https://img.shields.io/badge/docs-vedratech.github.io%2Fanydrop-1d4ed8.svg)](https://vedratech.github.io/anydrop/)

A standalone `<any-drop>` component for Angular 18 and later, with an output for every event, template slots for custom rows, a headless `AnyDropService` with signals, and `provideAnyDrop` for app-wide defaults. It works with server rendering and hydration, and with or without zone.js.

**Documentation: https://vedratech.github.io/anydrop/guide/angular** ([API reference](https://vedratech.github.io/anydrop/api/), [backend contract](https://vedratech.github.io/anydrop/protocol), [live demo](https://vedratech.github.io/anydrop/demo))

## Install

```sh
npm install @vedratech/anydrop-angular @vedratech/anydrop-ui @vedratech/anydrop-core
```

`@angular/core`, `@angular/common` (18 or newer), `rxjs`, `@vedratech/anydrop-ui` and `@vedratech/anydrop-core` are peer dependencies. Add the stylesheet to the `styles` of your `angular.json`:

```json
"styles": ["node_modules/@vedratech/anydrop-ui/dist/style.css", "src/styles.css"]
```

## Quick start

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

## Inputs, outputs and slots

| | |
|---|---|
| Inputs | `options` (the full configuration), `url`, `locale`, `themePreset`, `layout`, `disabled`. The dedicated inputs override the same key of `options` |
| Outputs | The core event names: `(addedfile)`, `(uploadprogress)`, `(errorlistchanged)`, ... 34 outputs, plus `(ready)` with the instance. A single argument is `$event`, several arguments are one object. The drop, drag and paste events are native DOM events on `<any-drop>`, not outputs |
| Slots | `<ng-template anyDropFile let-ctx>`, and `anyDropFolder`, `anyDropToolbar`, `anyDropMessage`, `anyDropErrorItem`. A row is created once and updated in place |
| Service | `AnyDropService`: a headless core instance with `files`, `tree`, `errors`, `progress` and `connection` signals and `on$(event)` |
| Defaults | `provideAnyDrop({ url: '/upload', chunking: true })` |

The instance is created in the browser after the view is initialised, outside the Angular zone, so progress causes no change detection. `(uploadprogress)` re-enters the zone for each event; bind `(totaluploadprogress)` for a progress bar. The instance is available as `(ready)`, or as `#drop="anyDrop"` and `drop.instance`.

## Size

About 5.2 kB gzip on top of AnyDrop, without Angular (the file holds partial declarations that your build links). Sizes of core and ui: [size comparison](https://vedratech.github.io/anydrop/size-comparison).

## Browser support and iOS

The same as the UI package: [Mobile and iOS](https://vedratech.github.io/anydrop/guide/mobile-ios).

## Licence

MIT. Created and maintained by **Jayesh Gupta**.
