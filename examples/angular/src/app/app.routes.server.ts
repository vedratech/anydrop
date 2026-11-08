import { RenderMode, type ServerRoute } from '@angular/ssr';

// Rendered on every request (not prerendered), so the server HTML always comes from the live app.
export const serverRoutes: ServerRoute[] = [{ path: '**', renderMode: RenderMode.Server }];
