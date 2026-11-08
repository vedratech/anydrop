<template>
  <div class="art" aria-hidden="true">
    <div class="bar"><span /><span /><span /></div>
    <div class="row folder"><i class="caret open" />Photos<em>9/12</em></div>
    <div class="row sub"><i class="caret open" />2024<em>5/6</em></div>
    <div class="row file"><b class="ok" />IMG_0412.jpg<s style="--w: 100%" /></div>
    <div class="row file"><b class="up" />IMG_0413.jpg<s style="--w: 64%" /></div>
    <div class="row file"><b class="q" />IMG_0414.jpg<s style="--w: 0%" /></div>
    <div class="row sub"><i class="caret" />Empty folder<em>kept</em></div>
    <div class="row folder"><i class="caret" />Documents<em class="err">1 failed</em></div>
  </div>
</template>

<style scoped>
.art {
  width: min(420px, 86vw);
  padding: 10px 12px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg-soft);
  box-shadow: 0 18px 50px -20px rgb(29 78 216 / 45%);
  font-size: 14px;
}
.bar {
  display: flex;
  gap: 6px;
  padding: 4px 2px 10px;
}
.bar span {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--vp-c-divider);
}
.row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 8px;
  color: var(--vp-c-text-1);
}
.row.folder {
  font-weight: 600;
}
.row.sub {
  margin-left: 18px;
  font-weight: 600;
}
.row.file {
  margin-left: 40px;
  color: var(--vp-c-text-2);
}
.row em {
  margin-left: auto;
  font-style: normal;
  font-size: 12px;
  color: var(--vp-c-text-3);
}
.row em.err {
  color: var(--vp-c-danger-1);
}
.caret {
  width: 0;
  height: 0;
  border-left: 5px solid var(--vp-c-text-3);
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
}
.caret.open {
  transform: rotate(90deg);
}
b {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
b.ok {
  background: var(--vp-c-success-1);
}
b.up {
  background: var(--vp-c-brand-1);
}
b.q {
  background: var(--vp-c-text-3);
}
s {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 2px;
  height: 3px;
  border-radius: 2px;
  background: var(--vp-c-divider);
  text-decoration: none;
  overflow: hidden;
}
s::after {
  content: '';
  display: block;
  width: var(--w);
  height: 100%;
  background: var(--vp-c-brand-1);
}
</style>
