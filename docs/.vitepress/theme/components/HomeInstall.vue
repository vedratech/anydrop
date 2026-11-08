<script setup lang="ts">
import { ref } from 'vue';

const npm = 'npm install @vedratech/anydrop-ui @vedratech/anydrop-core';
const cdn = [
  '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@vedratech/anydrop-ui@0.1/dist/style.css" />',
  '<script src="https://cdn.jsdelivr.net/npm/@vedratech/anydrop-ui@0.1"><' + '/script>',
].join('\n');
const copied = ref('');

async function copy(key: string, text: string) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = key;
    setTimeout(() => (copied.value = ''), 1500);
  } catch {
    /* clipboard not available: the text can still be selected by hand */
  }
}
</script>

<template>
  <section class="home-install" aria-label="Install">
    <div class="card">
      <div class="head">
        <span>npm</span>
        <button type="button" @click="copy('npm', npm)">
          {{ copied === 'npm' ? 'Copied' : 'Copy' }}
        </button>
      </div>
      <pre class="wrap"><code>{{ npm }}</code></pre>
    </div>
    <div class="card">
      <div class="head">
        <span>CDN (pin the minor version)</span>
        <button type="button" @click="copy('cdn', cdn)">
          {{ copied === 'cdn' ? 'Copied' : 'Copy' }}
        </button>
      </div>
      <pre><code>{{ cdn }}</code></pre>
    </div>
  </section>
</template>

<style scoped>
.home-install {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  max-width: 1152px;
  margin: 0 auto;
  padding: 8px 24px 32px;
}
@media (min-width: 768px) {
  .home-install {
    grid-template-columns: 1fr 1.6fr;
    padding: 8px 48px 40px;
  }
}
@media (min-width: 1280px) {
  .home-install {
    padding: 8px 64px 40px;
  }
}
.card {
  min-width: 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  border-bottom: 1px solid var(--vp-c-divider);
}
.head button {
  font: inherit;
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 6px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  cursor: pointer;
}
.head button:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}
pre {
  margin: 0;
  padding: 12px 14px;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.6;
}
pre.wrap {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
code {
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-1);
}
</style>
