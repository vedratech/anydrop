---
title: "Themes: CSS variables, presets and dark mode for the AnyDrop UI"
description: "Style AnyDrop with the --ad CSS variables, pick a ready preset (minimal, rounded, enterprise, glass), follow dark mode, or make your own preset. Includes a live theme builder."
---

# Themes

AnyDrop is styled with CSS variables, so a theme is a few lines of CSS. There is also a [live theme builder](/theme-builder) that produces the CSS for you.

## CSS variables

Set them on the element, or any ancestor:

```css
#uploader {
  --ad-color-accent: #7c3aed;
  --ad-radius: 12px;
}
```


There are 28 variables, in three groups.

### Colours

| Variable                | Meaning                           |
| ----------------------- | --------------------------------- |
| `--ad-color-bg`         | Background                        |
| `--ad-color-surface`    | Surface (the zone and rows)       |
| `--ad-color-text`       | Text                              |
| `--ad-color-muted`      | Secondary text                    |
| `--ad-color-border`     | Strong border                     |
| `--ad-color-border-soft`| Soft border                       |
| `--ad-color-accent`     | Primary colour                    |
| `--ad-color-on-accent`  | Text on the primary colour        |
| `--ad-color-hover`      | Hover background                  |
| `--ad-color-success`    | Success                           |
| `--ad-color-error`      | Error                             |
| `--ad-color-warning`    | Warning                           |
| `--ad-color-track`      | Progress track                    |
| `--ad-color-focus`      | Focus ring                        |

### Shape, size and text

| Variable              | Default                | Meaning                                                       |
| --------------------- | ---------------------- | ------------------------------------------------------------- |
| `--ad-radius`         | `8px`          | Corner radius                                                 |
| `--ad-btn-radius`     | `var(--ad-radius)`     | Button corner radius                                          |
| `--ad-gap`            | `12px`                 | Spacing                                                       |
| `--ad-target`         | `44px`                 | Minimum tap target. Do not lower it.                          |
| `--ad-font`           | system font stack      | Font family                                                   |
| `--ad-font-size`      | `1rem`                 | Base font size                                                |
| `--ad-icon-size`      | `22px`                 | Icon size                                                     |
| `--ad-thumb-size`     | `40px`                 | List thumbnail size                                           |
| `--ad-list-max-height`| `420px`                | Height of the list before it scrolls                          |
| `--ad-indent`         | `20px`                 | Tree indent per level                                         |

### Zone

| Variable            | Default  | Meaning                                                                          |
| ------------------- | -------- | -------------------------------------------------------------------------------- |
| `--ad-border-width` | `2px`    | Border of the drop zone                                                          |
| `--ad-border-style` | `dashed` | Border style of the drop zone                                                    |
| `--ad-shadow`       | `none`   | Shadow of the zone                                             |
| `--ad-backdrop`     | `none`   | Applied as `backdrop-filter` (and the `-webkit-` form) on the zone, for example `blur(12px)` |

## Presets

A preset is a stylesheet that sets these variables. There are four, in `@vedratech/anydrop-ui/themes/<name>.css`:

| Preset       | Look                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `minimal`    | A thin solid soft border instead of a dashed one, flat surfaces, 4 px radius, neutral accent.                              |
| `rounded`    | 16 px radius, pill-shaped buttons, a soft shadow.                                                                          |
| `enterprise` | Slate neutrals, a strong blue accent, 2 px radius, solid borders, slightly smaller text (0.9375rem).                       |
| `glass`      | Translucent surfaces with a blur behind the zone, 14 px radius, a shadow. A solid colour is used when the browser has no `backdrop-filter`. |

Import the stylesheet after the main one, and set `themePreset`:

```js
import '@vedratech/anydrop-ui/style.css';
import '@vedratech/anydrop-ui/themes/glass.css';
import { AnyDrop } from '@vedratech/anydrop-ui';

new AnyDrop('#uploader', { url: '/upload', themePreset: 'glass' });
```

From the CDN:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@vedratech/anydrop-ui@0.1/dist/style.css" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@vedratech/anydrop-ui@0.1/dist/themes/glass.css" />
```

`themePreset` adds the class `ad-theme-<name>` to the element and to the list panel (which can live in another container), and removes it when you change it or call `ad.destroy()`. A preset file only affects elements with its class, so importing a file alone changes nothing, and several presets can be used on one page. Presets work with `setOption('themePreset', ...)`.

Presets do not change sizes that affect tap targets (44 px), row heights or the layout, and every preset sets its colours for both light and dark.


## Dark mode

Dark mode follows `prefers-color-scheme`. Force it with the `theme` option (`'light'`, `'dark'` or `'auto'`), or with `data-ad-theme="light"` or `"dark"` on the element. `theme` combines with any preset. To follow your own site's switch:

```js
const isDark = document.documentElement.classList.contains('dark'); // however your site marks dark mode
ad.setOption('theme', isDark ? 'dark' : 'light');
```

## Make your own preset

Write a class named after the preset and set the variables for light and dark. Use the same three selectors as the built-in presets so it wins over the base dark rules, and load the file after `style.css`:

```css
.ad-root.ad-theme-acme,
.ad-panel.ad-theme-acme {
  --ad-color-accent: #0f766e;
  --ad-color-on-accent: #ffffff;
  --ad-radius: 10px;
}
@media (prefers-color-scheme: dark) {
  .ad-root.ad-theme-acme:not([data-ad-theme='light']),
  .ad-panel.ad-theme-acme:not([data-ad-theme='light']) {
    --ad-color-accent: #2dd4bf;
    --ad-color-on-accent: #042f2e;
  }
}
.ad-root.ad-theme-acme[data-ad-theme='dark'],
.ad-panel.ad-theme-acme[data-ad-theme='dark'] {
  --ad-color-accent: #2dd4bf;
  --ad-color-on-accent: #042f2e;
}
```

```js
new AnyDrop('#uploader', { url: '/upload', themePreset: 'acme' });
```

Rules of thumb:

- A colour you set for light must be set for dark too.
- Keep text at least 4.5:1 and controls and the focus ring at least 3:1 against their background, in both schemes.
- Set variables, plus a few visual rules on `ad-` classes at most. Do not change sizes that affect tap targets.

If you do not need a switchable preset, setting the variables on your own element (the first example on this page) is enough.

## Try it

The [theme builder](/theme-builder) lets you pick a preset, colours, radius, density, font, layout and light or dark with a live preview, and copies the CSS.
