# SSR and frameworks

Both packages are safe to import on the server: nothing touches `window` or `document` when you import them. Create the instance only in the browser, after your component has mounted, and destroy it when the component unmounts.

There are no official framework wrappers yet. The API has no framework assumptions (everything is options, methods and events), so wrapping it is a few lines, as shown below.

## Rules for any framework

1. Create the instance **after mount**, in the browser only (it needs a real element).
2. Call `destroy()` on unmount. It removes listeners, DOM and timers.
3. Use `setOption()` to react to changed props. You do not have to recreate the instance.
4. Keep the instance outside reactive state (a ref or a plain variable), so the framework does not wrap it in a proxy.
5. `on()` returns an unsubscribe function: collect them and call them on unmount if you want, or rely on `destroy()`.

## React

```jsx
import { useEffect, useRef } from 'react';
import { AnyDrop } from '@vedratech/anydrop-ui';
import '@vedratech/anydrop-ui/style.css';

export function Uploader({ url, onDone }) {
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

## Next.js

Import in a client component, or load it dynamically. Importing is safe during server rendering, but the constructor must run in the browser, which `useEffect` guarantees:

```jsx
'use client';
// the Uploader component from the React example above
```

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

## Nuxt

Wrap the component in `<ClientOnly>`, or name the file `Uploader.client.vue`.

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

Add the stylesheet to the `styles` array of `angular.json`, or import it in `styles.css`. With Angular Universal, `ngAfterViewInit` does not run on the server, so the constructor is never called there.

## Svelte

```svelte
<script>
  import { onMount } from 'svelte';
  import { AnyDrop } from '@vedratech/anydrop-ui';
  import '@vedratech/anydrop-ui/style.css';

  let el;
  onMount(() => {
    const ad = new AnyDrop(el, { url: '/upload', chunking: true });
    return () => ad.destroy();
  });
</script>

<div bind:this={el}></div>
```

## Several instances

There is no global state, so you can have several instances on one page. Give each its own `persistKey` if they upload to the same URL but must not share saved progress.

## The core in a store or service

`@vedratech/anydrop-core` has no DOM rendering, so you can keep one `AnyDropCore` in a store or service and bind it to your own components. It still needs the browser (`File`, `XMLHttpRequest`, IndexedDB) to upload, so it cannot run in Node.
