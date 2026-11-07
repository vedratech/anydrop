import { AnyDrop, type AnyDropConfig } from '../src/index';

export const mount = (config: AnyDropConfig = {}, html = '<div id="z"></div>') => {
  document.body.innerHTML = html;
  const el = document.body.firstElementChild as HTMLElement;
  const ad = new AnyDrop(el, { url: '/upload', autoProcessQueue: false, ...config });
  return { el, ad };
};

/** Lets the batch close and the frame paint. */
export const settle = async (ad: AnyDrop) => {
  await new Promise((r) => setTimeout(r, 60));
  ad._uiFlush();
};

export const file = (name: string, size = 10, type = 'text/plain') =>
  new File([new Uint8Array(size)], name, { type });
