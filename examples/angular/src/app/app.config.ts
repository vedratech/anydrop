import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideClientHydration } from '@angular/platform-browser';
import { provideAnyDrop } from '@vedratech/anydrop-angular';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideClientHydration(),
    // App-wide defaults: every <any-drop> starts from these, its own options win.
    provideAnyDrop({ url: '/upload', retryChunks: true, retryChunksLimit: 2 }),
  ],
};
