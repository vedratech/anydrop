<template>
  <div class="art" aria-hidden="true">
    <div class="head">
      <div class="title">
        <strong>Uploading “Trip 2024”</strong>
        <span>9 of 12 files · 186 MB</span>
      </div>
      <span class="btn">Pause all</span>
    </div>
    <div class="total"><i style="--w: 72%" /></div>

    <ul class="tree">
      <li class="folder">
        <svg viewBox="0 0 20 20">
          <path
            d="M2 5.5A1.5 1.5 0 0 1 3.5 4h4l2 2h7A1.5 1.5 0 0 1 18 7.5v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 14.5z"
          />
        </svg>
        <span class="name">Photos</span>
        <span class="meta">6 / 7</span>
      </li>
      <li class="file">
        <span class="thumb t1" />
        <span class="name">beach.jpg<small>4.2 MB</small></span>
        <span class="pill ok">Done</span>
      </li>
      <li class="file active">
        <span class="thumb t2" />
        <span class="name">sunset.heic<small>12.8 MB · chunk 5 of 7</small></span>
        <span class="pill up">64%</span>
        <i class="bar" />
      </li>
      <li class="file">
        <span class="thumb t3" />
        <span class="name">harbour.mov<small>148 MB</small></span>
        <span class="pill q">Queued</span>
      </li>
      <li class="folder">
        <svg viewBox="0 0 20 20">
          <path
            d="M2 5.5A1.5 1.5 0 0 1 3.5 4h4l2 2h7A1.5 1.5 0 0 1 18 7.5v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 14.5z"
          />
        </svg>
        <span class="name">Documents</span>
        <span class="pill err">1 failed · Retry</span>
      </li>
      <li class="folder empty">
        <svg viewBox="0 0 20 20">
          <path
            d="M2 5.5A1.5 1.5 0 0 1 3.5 4h4l2 2h7A1.5 1.5 0 0 1 18 7.5v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 14.5z"
          />
        </svg>
        <span class="name">Receipts</span>
        <span class="meta">empty · kept</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.art {
  position: relative;
  width: min(440px, 88vw);
  padding: 18px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  background: var(--vp-c-bg-elv);
  box-shadow:
    0 1px 2px rgb(0 0 0 / 6%),
    0 24px 60px -24px rgb(15 23 42 / 35%);
  font-size: 14px;
  line-height: 1.3;
  color: var(--vp-c-text-1);
  text-align: left;
}
.dark .art {
  box-shadow:
    0 0 0 1px rgb(255 255 255 / 4%),
    0 24px 60px -20px rgb(0 0 0 / 70%);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.title {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.title strong {
  font-size: 15px;
  font-weight: 600;
}
.title span {
  font-size: 12.5px;
  color: var(--vp-c-text-2);
}
.btn {
  flex: none;
  padding: 5px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-soft);
}
.total {
  height: 6px;
  margin: 14px 0 12px;
  border-radius: 99px;
  background: var(--vp-c-default-soft);
  overflow: hidden;
}
.total i {
  display: block;
  width: var(--w);
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--vp-c-brand-1), #38bdf8);
}

.tree {
  margin: 0;
  padding: 0;
  list-style: none;
}
.tree li {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px;
  border-radius: 10px;
}
.tree li + li {
  margin-top: 2px;
}
.tree li.file {
  margin-left: 22px;
}
.tree li.active {
  background: var(--vp-c-brand-soft);
}
.folder svg {
  flex: none;
  width: 18px;
  height: 18px;
  fill: var(--vp-c-brand-1);
}
.folder.empty svg {
  fill: none;
  stroke: var(--vp-c-text-3);
  stroke-width: 1.4;
}
.folder .name {
  font-weight: 600;
}
.name {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.name small {
  font-size: 12px;
  color: var(--vp-c-text-2);
}
.meta {
  margin-left: auto;
  font-size: 12.5px;
  color: var(--vp-c-text-2);
}
.thumb {
  flex: none;
  width: 30px;
  height: 30px;
  border-radius: 7px;
}
.t1 {
  background: linear-gradient(135deg, #38bdf8, #0ea5e9 45%, #fde68a 46%, #fbbf24);
}
.t2 {
  background: linear-gradient(160deg, #f97316, #db2777 55%, #1e1b4b);
}
.t3 {
  background: linear-gradient(135deg, #334155, #64748b);
}

.pill {
  flex: none;
  margin-left: auto;
  padding: 3px 9px;
  border-radius: 99px;
  font-size: 12px;
  font-weight: 600;
}
.pill.ok {
  color: var(--vp-c-success-1);
  background: var(--vp-c-success-soft);
}
.pill.up {
  color: var(--vp-c-brand-1);
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-brand-soft);
}
.pill.q {
  color: var(--vp-c-text-2);
  background: var(--vp-c-default-soft);
}
.pill.err {
  color: var(--vp-c-danger-1);
  background: var(--vp-c-danger-soft);
}

.bar {
  position: absolute;
  left: 48px;
  right: 10px;
  bottom: 3px;
  height: 3px;
  border-radius: 99px;
  background: var(--vp-c-default-soft);
  overflow: hidden;
}
.bar::after {
  content: '';
  display: block;
  width: 64%;
  height: 100%;
  border-radius: inherit;
  background: var(--vp-c-brand-1);
  animation: fill 3.2s ease-in-out infinite alternate;
}
@keyframes fill {
  from {
    width: 48%;
  }
  to {
    width: 82%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .bar::after {
    animation: none;
  }
}
</style>
