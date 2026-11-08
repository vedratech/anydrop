---
title: "Theme builder: design an AnyDrop theme and copy the CSS"
description: "Pick colours, radius, spacing, font, preset, layout and light or dark mode, see the real AnyDrop upload UI change live, and copy ready CSS variables for your site."
aside: false
---

<script setup>
import ThemeBuilder from './.vitepress/theme/components/ThemeBuilder.vue'
</script>

# Theme builder

Design a theme for the AnyDrop interface with a live preview. Change the controls, then press **Copy CSS** and paste the block into your stylesheet. The theme is only CSS variables; see [Themes](/guide/themes) for what each one does.

<ClientOnly>
  <ThemeBuilder />
</ClientOnly>

## How to use the result

1. Give your uploader element the class `anydrop`, or change the selector in the copied block to your own.
2. Put the copied CSS **after** the AnyDrop stylesheet (`style.css`), so it wins over the defaults.
3. If you picked a preset or a layout, copy the options and pass them to the constructor, and import the preset file (see [Themes](/guide/themes#presets)):

```js
new AnyDrop('#uploader', { url: '/upload', themePreset: 'glass', layout: 'compact' });
```

The copied block only has the variables you changed. When you edit colours in dark mode, it also has a dark block, which applies when the page prefers a dark scheme or the element has `data-ad-theme="dark"`.

The builder warns when a text and background pair is below the 4.5:1 contrast that WCAG AA asks for.

