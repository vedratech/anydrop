---
title: "Folder upload with React, Angular and Vue"
description: "Add drag and drop folder upload to React, Next.js, Vue, Nuxt and Angular with the vanilla AnyDrop API in a component. Official React, Next.js and Angular packages, and the plain API for Vue, Nuxt and Svelte."
---

# Folder upload with React, Angular and Vue

There are official packages for **React and Next.js** ([`@vedratech/anydrop-react`](/guide/react)) and **Angular** ([`@vedratech/anydrop-angular`](/guide/angular)). They give you a component, an event prop or output for every event, custom rows written as real components, and a headless hook or service. For Vue, Nuxt, Svelte and others there is no package, and you do not need one: AnyDrop is driven only by options, methods and events, with no framework assumptions, so a component of a few lines wraps it, as shown below.

## The pattern

1. Create the instance **after mount**, in the browser only (it needs a real element). Importing the package on the server is safe: nothing touches `window` or `document` at import time.
2. Call `destroy()` on unmount. It removes listeners, DOM and timers.
3. Use `setOption()` to react to changed props, instead of recreating the instance.
4. Keep the instance outside reactive state, so the framework does not wrap it in a proxy.

## React

```jsx
import { useEffect, useRef } from 'react';
import { AnyDrop } from '@vedratech/anydrop-ui';
import '@vedratech/anydrop-ui/style.css';

export function FolderUploader({ url, onDone }) {
  const el = useRef(null);
  const ad = useRef(null);

  useEffect(() => {
    ad.current = new AnyDrop(el.current, { url, chunking: true });
    const off = ad.current.on('queuecomplete', () => onDone?.(ad.current.getErrors()));
    return () => {
      off();
      ad.current.destroy();
    };
  }, []);

  useEffect(() => {
    ad.current?.setOption('url', url);
  }, [url]);

  return <div ref={el} />;
}
```

In **Next.js**, use it from a client component (`'use client'`). The constructor runs inside `useEffect`, which only runs in the browser.

## Vue 3

```vue
<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { AnyDrop } from '@vedratech/anydrop-ui';
import '@vedratech/anydrop-ui/style.css';

const props = defineProps({ url: String });
const emit = defineEmits(['done']);
const el = ref(null);
let ad = null; // not reactive on purpose

onMounted(() => {
  ad = new AnyDrop(el.value, { url: props.url, chunking: true });
  ad.on('queuecomplete', () => emit('done', ad.getErrors()));
});
onBeforeUnmount(() => ad?.destroy());
watch(() => props.url, (url) => ad?.setOption('url', url));
</script>

<template>
  <div ref="el"></div>
</template>
```

In **Nuxt**, wrap the component in `<ClientOnly>` or name the file `Uploader.client.vue`.

## Angular

```ts
import { Component, ElementRef, OnDestroy, AfterViewInit, ViewChild, Input } from '@angular/core';
import { AnyDrop } from '@vedratech/anydrop-ui';

@Component({
  selector: 'app-uploader',
  template: '<div #host></div>',
})
export class UploaderComponent implements AfterViewInit, OnDestroy {
  @Input() url = '/upload';
  @ViewChild('host') host!: ElementRef<HTMLElement>;
  private ad?: AnyDrop;

  ngAfterViewInit() {
    this.ad = new AnyDrop(this.host.nativeElement, { url: this.url, chunking: true });
  }
  ngOnDestroy() {
    this.ad?.destroy();
  }
}
```

Add the stylesheet `@vedratech/anydrop-ui/style.css` to the `styles` of `angular.json`, or import it in your global styles. With Angular Universal, `ngAfterViewInit` does not run on the server, so the constructor is never called there. Svelte works the same way in `onMount`.

## Own markup, own state

If you want your design system instead of the built-in UI, use the headless engine, `@vedratech/anydrop-core`, as a service or store and bind its events and `getTree()` to your own components. It still needs the browser (`File`, `XMLHttpRequest`, IndexedDB) to upload, so it cannot upload from Node. See [Headless core](/guide/headless-core).

## Notes

- Several instances on one page are fine. Give each its own `persistKey` if they upload to the same URL but must not share saved progress.
- Folder pickers and folder drops are not available in Safari on iOS: see [Mobile and iOS](/guide/mobile-ios).

## Related

- [SSR and frameworks](/guide/ssr-frameworks): Svelte, Nuxt and the rules in full.
- [Upload a folder in JavaScript](/use-cases/upload-folder-javascript)
