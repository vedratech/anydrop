---
title: "Languages and right-to-left (RTL): translate the AnyDrop UI"
description: "Use a ready language pack for Hindi, Spanish, French, German, Portuguese, Japanese, Chinese or Arabic, switch language at runtime, and get right-to-left layout. Status of each translation."
---

# Languages and RTL

Every text in the interface is an option (see [Customising the UI](/guide/customising-ui#texts-dict)). A **language pack** is a ready-made set of them, with the language code and text direction. Packs are separate small files, so they add nothing to your bundle unless you import them.

## Use a pack with npm

```js
import { AnyDrop } from '@vedratech/anydrop-ui';
import { hi } from '@vedratech/anydrop-ui/locales/hi';

new AnyDrop('#uploader', { url: '/upload', locale: hi });
```

A pack is an object `{ code, dir, dict }`. Each module exports it by name (`hi`, `es`, `fr`, `de`, `ptBR`, `ja`, `zhCN`, `ar`) and as the default export. A pack has no runtime imports, so it never pulls the UI into a bundle and works with server-side rendering.

You can also register packs and refer to them by code:

```js
import { ar } from '@vedratech/anydrop-ui/locales/ar';

AnyDrop.locales.ar = ar;
new AnyDrop('#uploader', { url: '/upload', locale: 'ar' });
```

Spreading also works, without setting `lang` or `dir`:

```js
new AnyDrop('#uploader', { url: '/upload', ...hi.dict });
```

## Use a pack from the CDN

Load the pack after the main script. It registers itself in `AnyDrop.locales`:

```html
<script src="https://cdn.jsdelivr.net/npm/@vedratech/anydrop-ui@0.1/dist/index.global.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@vedratech/anydrop-ui@0.1/dist/locales/ar.global.js"></script>
<script>
  new AnyDrop('#uploader', { url: '/upload', locale: 'ar' });
</script>
```

If `window.AnyDrop` is missing, the pack file throws `Load AnyDrop before its locale files.`

## Switch language at runtime

```js
import { es } from '@vedratech/anydrop-ui/locales/es';

ad.setOption('locale', es); // or 'es' when it is registered
ad.setOption('locale', null); // back to English
```

The texts are rewritten, the row labels are refreshed, and `lang` and `dir` are updated.

## The options

| Option   | Type                                | Default  | Meaning                                                                                                                                  |
| -------- | ----------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `locale` | `AnyDropLocale \| string \| null`   | `null`   | A pack, or a code looked up in `AnyDrop.locales`. `null` and `'en'` mean the built-in English. An unknown code logs a warning and uses English. |
| `dir`    | `'auto' \| 'ltr' \| 'rtl'`          | `'auto'` | `'ltr'` and `'rtl'` are used as given. `'auto'` uses the direction of the locale, or no attribute (inherit from the page) without a locale. |

## Precedence

From lowest to highest:

1. the built-in English texts;
2. the texts of `locale.dict`;
3. `dict*` options you set yourself (in `AnyDrop.options` presets, the constructor, or `setOption('dictX', ...)`).

AnyDrop remembers which `dict*` options you set. `setOption('locale', x)` rewrites every other text and keeps yours. So you can use a pack and still change one sentence:

```js
new AnyDrop('#uploader', {
  url: '/upload',
  locale: fr,
  dictDefaultMessage: 'Déposez vos dossiers ici',
});
```

## `lang`, `dir` and right-to-left

With a locale or an explicit `dir`, the element and the panel get `lang` (the locale code) and `dir`. The values that were on your element before are saved and **restored** by `ad.destroy()` and when you switch back to `null` or `'auto'`. `document.body` is never changed.

For right-to-left languages (Arabic):

- the tree indent, text alignment and the connection banner follow the direction;
- the expand and collapse arrow is mirrored when closed (the pause, play and retry icons are not);
- ArrowLeft and ArrowRight swap meaning in the tree;
- file and folder names and error paths use `unicode-bidi: plaintext`, so names that mix directions display correctly.

```js
import { ar } from '@vedratech/anydrop-ui/locales/ar'; // dir: 'rtl'

new AnyDrop('#uploader', { url: '/upload', locale: ar }); // dir is 'rtl' through 'auto'
new AnyDrop('#other', { url: '/upload', dir: 'rtl' }); // force it for English text
```

## Available packs

The packs were written from the English texts. Counts are worded without plural forms (for example "Files added: {{count}}"), because the library has no plural rules yet.

| Language              | Code    | Import                                    | Status                              |
| --------------------- | ------- | ----------------------------------------- | ----------------------------------- |
| English               | `en`    | built in (`.../locales/en` also exists)   | reference text                      |
| Hindi                 | `hi`    | `@vedratech/anydrop-ui/locales/hi`        | draft, pending native-speaker review |
| Spanish               | `es`    | `@vedratech/anydrop-ui/locales/es`        | draft, pending native-speaker review |
| French                | `fr`    | `@vedratech/anydrop-ui/locales/fr`        | draft, pending native-speaker review |
| German                | `de`    | `@vedratech/anydrop-ui/locales/de`        | draft, pending native-speaker review |
| Brazilian Portuguese  | `pt-BR` | `@vedratech/anydrop-ui/locales/pt-BR`     | draft, pending native-speaker review |
| Japanese              | `ja`    | `@vedratech/anydrop-ui/locales/ja`        | draft, pending native-speaker review |
| Simplified Chinese    | `zh-CN` | `@vedratech/anydrop-ui/locales/zh-CN`     | draft, pending native-speaker review |
| Arabic (right-to-left)| `ar`    | `@vedratech/anydrop-ui/locales/ar`        | draft, pending native-speaker review |

::: warning Drafts
These translations are drafts. Please have a native speaker check them before you rely on them in production. Corrections are very welcome: open an issue or a pull request on [GitHub](https://github.com/vedratech/anydrop) with the language code, the text key and your wording.
:::

For the CDN the file is `dist/locales/<code>.global.js`.


## Your own language

A pack is a plain object, so you can write one for a language that is not listed:

```js
const sv = {
  code: 'sv',
  dir: 'ltr',
  dict: { dictDefaultMessage: 'Släpp filer eller mappar här' },
};

new AnyDrop('#uploader', { url: '/upload', locale: sv });
```

The type of `dict` is `Partial<AnyDropTexts>`: leave out any text to keep the English one. The list of texts is in [Options, Texts](/api/options#texts).
