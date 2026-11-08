<script setup lang="ts">
// Theme builder: the real AnyDrop UI build with the fake transport of the live demo, and controls
// that edit the --ad-* variables. It uses only the public ui API (options, setOption, CSS variables).
// Controls for features the loaded build does not have yet (layout, presets) are disabled.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useData } from 'vitepress';
import {
  addSampleFolderTo,
  createFakeTransport,
  fakeOptions,
  loadAnyDrop,
  loadPreset,
} from './fakeTransport';

const { isDark } = useData();

type Scheme = 'light' | 'dark';

const colourVars = [
  { name: '--ad-color-accent', label: 'Accent' },
  { name: '--ad-color-on-accent', label: 'Text on accent' },
  { name: '--ad-color-bg', label: 'Background' },
  { name: '--ad-color-surface', label: 'Surface' },
  { name: '--ad-color-text', label: 'Text' },
  { name: '--ad-color-muted', label: 'Muted text' },
  { name: '--ad-color-border', label: 'Border' },
  { name: '--ad-color-hover', label: 'Hover' },
  { name: '--ad-color-success', label: 'Success' },
  { name: '--ad-color-error', label: 'Error' },
  { name: '--ad-color-focus', label: 'Focus ring' },
];
const presets = ['minimal', 'rounded', 'enterprise', 'glass'];
const layouts = ['list', 'compact'];
const fonts: Record<string, string> = {
  system: '',
  serif: "Georgia, 'Times New Roman', serif",
  monospace: 'ui-monospace, Menlo, Consolas, monospace',
};

const host = ref<HTMLElement | null>(null);
const ready = ref(false);
const failed = ref('');
const copied = ref('');
const supports = reactive({ layout: false, preset: false });
const presetNote = ref('');

const scheme = ref<Scheme>(isDark.value ? 'dark' : 'light');
const preset = ref('');
const layout = ref('list');
const fontChoice = ref('system');
const customFont = ref('');
const radius = ref<number | null>(null); // null = not changed
const gap = ref<number | null>(null);
const fontSize = ref<number | null>(null);
const colours = reactive<Record<Scheme, Record<string, string>>>({ light: {}, dark: {} });
// The values AnyDrop has with no override (the stylesheet plus the preset), read from the DOM.
const base = reactive<Record<Scheme, Record<string, string>>>({ light: {}, dark: {} });
const baseCommon = reactive<Record<string, string>>({});

let ad: any = null;
let styleEl: HTMLStyleElement | null = null;
let folders = 0;

const sim = { failRate: 0, speed: 2, offline: false };

const fontValue = computed(() =>
  fontChoice.value === 'custom' ? customFont.value.trim() : fonts[fontChoice.value],
);

/** Non-colour declarations, shared by both colour schemes. */
const commonDecls = computed(() => {
  const d: [string, string][] = [];
  if (radius.value !== null) d.push(['--ad-radius', radius.value + 'px']);
  if (gap.value !== null) d.push(['--ad-gap', gap.value + 'px']);
  if (fontSize.value !== null) d.push(['--ad-font-size', fontSize.value + 'rem']);
  if (fontValue.value) d.push(['--ad-font', fontValue.value]);
  return d;
});
const colourDecls = (s: Scheme): [string, string][] =>
  colourVars.filter((v) => colours[s][v.name]).map((v) => [v.name, colours[s][v.name]]);

const block = (selector: string, decls: [string, string][], pad = '') =>
  `${pad}${selector} {\n${decls.map(([k, v]) => `${pad}  ${k}: ${v};`).join('\n')}\n${pad}}`;

const css = computed(() => {
  const light = [...commonDecls.value, ...colourDecls('light')];
  const dark = colourDecls('dark');
  const parts: string[] = [];
  if (light.length) parts.push(block('.anydrop', light));
  if (dark.length) {
    parts.push(block(".anydrop[data-ad-theme='dark']", dark));
    parts.push(
      '@media (prefers-color-scheme: dark) {\n' +
        block(".anydrop:not([data-ad-theme='light'])", dark, '  ') +
        '\n}',
    );
  }
  return parts.length ? parts.join('\n\n') : '/* No changes yet. Edit a control. */';
});

const options = computed(() => {
  const o: Record<string, string> = {};
  if (preset.value) o.themePreset = preset.value;
  if (layout.value !== 'list') o.layout = layout.value;
  return Object.keys(o).length ? JSON.stringify(o, null, 2) : '{}';
});

function previewCss() {
  const rule = (s: Scheme) => {
    const decls = [...commonDecls.value, ...colourDecls(s)];
    if (!decls.length) return '';
    const sel = `div.tb-preview .ad-root[data-ad-theme='${s}'], div.tb-preview .ad-panel[data-ad-theme='${s}']`;
    return block(sel, decls);
  };
  return rule('light') + '\n' + rule('dark');
}
function applyPreview() {
  if (styleEl) styleEl.textContent = previewCss();
}
watch([commonDecls, () => colours.light, () => colours.dark], applyPreview, { deep: true });

// --- reading the values AnyDrop has by itself (no overrides) ---------------------------------
const allVars = [...colourVars.map((v) => v.name), '--ad-radius', '--ad-gap', '--ad-font-size'];

function readBase() {
  const el: HTMLElement | null = ad?.element ?? null;
  if (!el || !styleEl) return;
  const saved = styleEl.textContent;
  const attr = el.getAttribute('data-ad-theme');
  styleEl.textContent = '';
  for (const s of ['light', 'dark'] as Scheme[]) {
    el.setAttribute('data-ad-theme', s);
    const cs = getComputedStyle(el);
    for (const n of allVars) base[s][n] = cs.getPropertyValue(n).trim();
  }
  el.setAttribute('data-ad-theme', attr ?? scheme.value);
  styleEl.textContent = saved;
  for (const n of ['--ad-radius', '--ad-gap', '--ad-font-size']) baseCommon[n] = base.light[n];
}
const settle = () => nextTick(() => requestAnimationFrame(readBase));

// --- colour helpers ---------------------------------------------------------------------------
function toRgb(v: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(v);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}
const toHex = (v: string) => {
  const c = toRgb(v);
  return c ? '#' + c.map((n) => n.toString(16).padStart(2, '0')).join('') : '#000000';
};
const lum = (c: [number, number, number]) => {
  const [r, g, b] = c.map((n) => {
    const s = n / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
function ratio(a: string, b: string): number | null {
  const x = toRgb(a);
  const y = toRgb(b);
  if (!x || !y) return null;
  const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}
const effective = (s: Scheme, name: string) => colours[s][name] || base[s][name] || '';

const warnings = computed(() => {
  const out: string[] = [];
  for (const s of ['light', 'dark'] as Scheme[]) {
    const pairs: [string, string, string][] = [
      ['--ad-color-text', '--ad-color-bg', 'Text on background'],
      ['--ad-color-text', '--ad-color-surface', 'Text on surface'],
      ['--ad-color-muted', '--ad-color-bg', 'Muted text on background'],
      ['--ad-color-on-accent', '--ad-color-accent', 'Text on accent'],
    ];
    for (const [fg, bg, label] of pairs) {
      const r = ratio(effective(s, fg), effective(s, bg));
      if (r !== null && r < 4.5)
        out.push(`${label} (${s}): contrast ${r.toFixed(1)}:1, below 4.5:1`);
    }
  }
  return out;
});

// --- controls ---------------------------------------------------------------------------------
const colourValue = (name: string) => toHex(effective(scheme.value, name));
function setColour(name: string, value: string) {
  colours[scheme.value][name] = value;
}
const resetColour = (name: string) => delete colours[scheme.value][name];

watch(scheme, (s) => {
  ad?.setOption('theme', s);
  settle();
});

watch(layout, (l) => {
  if (supports.layout) ad?.setOption('layout', l);
  settle();
});

watch(preset, async (p) => {
  presetNote.value = '';
  if (!supports.preset) return;
  if (p && !(await loadPreset(p))) {
    presetNote.value = `The file for "${p}" is not part of this build of the docs yet.`;
  }
  ad?.setOption('themePreset', p || null);
  settle();
});

function reset() {
  preset.value = '';
  layout.value = 'list';
  fontChoice.value = 'system';
  customFont.value = '';
  radius.value = null;
  gap.value = null;
  fontSize.value = null;
  colours.light = {};
  colours.dark = {};
  scheme.value = isDark.value ? 'dark' : 'light';
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  copied.value = what;
  setTimeout(() => (copied.value = ''), 1800);
}

function addSample() {
  if (ad) addSampleFolderTo(ad, ++folders);
}

onMounted(async () => {
  try {
    await loadAnyDrop();
  } catch (e) {
    failed.value = (e as Error).message;
    return;
  }
  const AnyDrop = (window as any).AnyDrop;
  const defaults = typeof AnyDrop.uiDefaults === 'function' ? AnyDrop.uiDefaults() : {};
  supports.layout = 'layout' in defaults;
  supports.preset = 'themePreset' in defaults;

  styleEl = document.createElement('style');
  styleEl.setAttribute('data-theme-builder', '');
  document.head.appendChild(styleEl);

  ad = new AnyDrop(host.value, {
    ...fakeOptions(createFakeTransport(sim)),
    theme: scheme.value,
  });
  addSampleFolderTo(ad, ++folders);
  ready.value = true;
  settle();
});

onBeforeUnmount(() => {
  ad?.destroy();
  ad = null;
  styleEl?.remove();
  styleEl = null;
});
</script>

<template>
  <div class="tb">
    <p class="note">
      <strong>This builder is simulated.</strong> It runs the real AnyDrop UI with a fake transport,
      so nothing you drop leaves your browser. Change a control, watch the preview, then copy the
      CSS.
    </p>

    <div class="grid">
      <div class="panel" role="group" aria-label="Theme controls">
        <div class="row">
          <span class="lbl">Colour scheme</span>
          <div class="seg" role="radiogroup" aria-label="Colour scheme">
            <button
              v-for="s in ['light', 'dark']"
              :key="s"
              type="button"
              role="radio"
              :aria-checked="scheme === s"
              :class="{ on: scheme === s }"
              @click="scheme = s as Scheme"
            >
              {{ s }}
            </button>
          </div>
        </div>
        <p class="hint">The colours you change apply to the scheme selected here.</p>

        <div class="row">
          <label class="lbl" for="tb-preset">Preset</label>
          <select id="tb-preset" v-model="preset" :disabled="!supports.preset">
            <option value="">none</option>
            <option v-for="p in presets" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>
        <p v-if="!supports.preset && ready" class="hint warn">
          Presets are not in this build of the UI yet, so this control is off.
        </p>
        <p v-if="presetNote" class="hint warn">{{ presetNote }}</p>

        <div class="row">
          <label class="lbl" for="tb-layout">Layout</label>
          <select id="tb-layout" v-model="layout" :disabled="!supports.layout">
            <option v-for="l in layouts" :key="l" :value="l">{{ l }}</option>
          </select>
        </div>
        <p v-if="!supports.layout && ready" class="hint warn">
          Layouts are not in this build of the UI yet, so this control is off.
        </p>

        <h3>Colours ({{ scheme }})</h3>
        <div v-for="v in colourVars" :key="v.name" class="row colour">
          <label class="lbl" :for="'tb' + v.name">{{ v.label }}</label>
          <input
            :id="'tb' + v.name"
            type="color"
            :value="colourValue(v.name)"
            :disabled="!ready"
            @input="setColour(v.name, ($event.target as HTMLInputElement).value)"
          />
          <code class="val">{{ effective(scheme, v.name) }}</code>
          <button
            type="button"
            class="mini"
            :disabled="!colours[scheme][v.name]"
            :aria-label="'Reset ' + v.label"
            @click="resetColour(v.name)"
          >
            Reset
          </button>
        </div>

        <h3>Shape and text</h3>
        <div class="row">
          <label class="lbl" for="tb-radius">Corner radius</label>
          <input
            id="tb-radius"
            type="range"
            min="0"
            max="24"
            step="1"
            :value="radius ?? parseInt(baseCommon['--ad-radius'] || '8')"
            @input="radius = Number(($event.target as HTMLInputElement).value)"
          />
          <code class="val"
            >{{ radius ?? baseCommon['--ad-radius'] ?? '' }}{{ radius !== null ? 'px' : '' }}</code
          >
        </div>
        <div class="row">
          <label class="lbl" for="tb-gap">Spacing (density)</label>
          <input
            id="tb-gap"
            type="range"
            min="4"
            max="24"
            step="1"
            :value="gap ?? parseInt(baseCommon['--ad-gap'] || '12')"
            @input="gap = Number(($event.target as HTMLInputElement).value)"
          />
          <code class="val"
            >{{ gap ?? baseCommon['--ad-gap'] ?? '' }}{{ gap !== null ? 'px' : '' }}</code
          >
        </div>
        <div class="row">
          <label class="lbl" for="tb-fsize">Font size</label>
          <input
            id="tb-fsize"
            type="range"
            min="0.8"
            max="1.25"
            step="0.0625"
            :value="fontSize ?? 1"
            :disabled="!ready"
            @input="fontSize = Number(($event.target as HTMLInputElement).value)"
          />
          <code class="val">{{ fontSize !== null ? fontSize + 'rem' : 'default' }}</code>
        </div>
        <p class="hint">
          Font size needs <code>--ad-font-size</code>, which older builds do not use.
        </p>
        <div class="row">
          <label class="lbl" for="tb-font">Font</label>
          <select id="tb-font" v-model="fontChoice">
            <option value="system">system</option>
            <option value="serif">serif</option>
            <option value="monospace">monospace</option>
            <option value="custom">custom</option>
          </select>
        </div>
        <div v-if="fontChoice === 'custom'" class="row">
          <label class="lbl" for="tb-customfont">Font family</label>
          <input
            id="tb-customfont"
            v-model="customFont"
            type="text"
            class="text"
            placeholder="Inter, sans-serif"
          />
        </div>
        <p class="hint">A web font must also be loaded by your page.</p>
      </div>

      <div class="side">
        <div class="preview-bar">
          <button type="button" class="primary" :disabled="!ready" @click="addSample">
            Add sample folder
          </button>
          <button type="button" :disabled="!ready" @click="reset">Reset</button>
        </div>
        <p v-if="failed" class="error">{{ failed }}</p>
        <div class="tb-preview" :class="{ dark: scheme === 'dark' }" :data-scheme="scheme">
          <div ref="host" class="host" />
        </div>

        <ul v-if="warnings.length" class="warnings" aria-live="polite">
          <li v-for="w in warnings" :key="w">{{ w }}</li>
        </ul>

        <div class="out-head">
          <h3>CSS</h3>
          <button type="button" class="primary" @click="copy(css, 'css')">
            {{ copied === 'css' ? 'Copied' : 'Copy CSS' }}
          </button>
        </div>
        <pre class="out"><code>{{ css }}</code></pre>
        <p class="hint">
          Add the block after the AnyDrop stylesheet, and give your uploader element the class
          <code>anydrop</code>. The list panel keeps the same values when it is inside that element.
        </p>

        <div class="out-head">
          <h3>Options</h3>
          <button type="button" @click="copy(options, 'opts')">
            {{ copied === 'opts' ? 'Copied' : 'Copy options' }}
          </button>
        </div>
        <pre class="out"><code>{{ options }}</code></pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.note {
  padding: 10px 14px;
  border-left: 4px solid var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  border-radius: 6px;
  font-size: 14px;
}
.grid {
  display: grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
@media (max-width: 860px) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
.panel {
  padding: 14px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
}
h3 {
  margin: 18px 0 8px;
  font-size: 15px;
  border: 0;
  padding: 0;
  letter-spacing: 0;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
  min-height: 36px;
}
.lbl {
  flex: 0 0 128px;
  font-size: 13.5px;
  color: var(--vp-c-text-2);
}
.val {
  font-size: 12px;
  min-width: 64px;
}
.hint {
  margin: 2px 0 8px;
  font-size: 12.5px;
  color: var(--vp-c-text-3);
  line-height: 1.5;
}
.hint.warn {
  color: var(--vp-c-warning-1);
}
button,
select,
.text {
  font: inherit;
  font-size: 14px;
  min-height: 36px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  cursor: pointer;
}
.text {
  cursor: text;
  flex: 1;
  min-width: 0;
}
button:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
}
button:disabled,
select:disabled {
  opacity: 0.5;
  cursor: default;
}
button.primary {
  background: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-button-brand-text, #fff);
  font-weight: 600;
}
button.mini {
  min-height: 28px;
  padding: 0 8px;
  font-size: 12px;
}
.seg {
  display: inline-flex;
}
.seg button {
  border-radius: 0;
}
.seg button:first-child {
  border-radius: 8px 0 0 8px;
}
.seg button:last-child {
  border-radius: 0 8px 8px 0;
}
.seg button.on {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand-1);
  font-weight: 600;
}
input[type='color'] {
  width: 44px;
  height: 36px;
  padding: 2px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  cursor: pointer;
}
input[type='range'] {
  flex: 1;
  min-width: 0;
}
.colour .val {
  flex: 1;
}
.preview-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.tb-preview {
  padding: 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: #ffffff;
}
.tb-preview.dark {
  background: #111827;
}
.warnings {
  margin: 12px 0;
  padding: 10px 14px 10px 28px;
  border-left: 4px solid var(--vp-c-warning-1);
  background: var(--vp-c-warning-soft);
  border-radius: 6px;
  font-size: 13.5px;
}
.out-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.out {
  margin: 4px 0 8px;
  padding: 12px 14px;
  overflow: auto;
  border-radius: 8px;
  background: var(--vp-code-block-bg);
  font-size: 12.5px;
  line-height: 1.6;
  max-height: 280px;
}
.error {
  color: var(--vp-c-danger-1);
}
</style>
