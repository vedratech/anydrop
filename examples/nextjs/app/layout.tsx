import type { ReactNode } from 'react';
import '@vedratech/anydrop-ui/style.css';
import '@vedratech/anydrop-ui/themes/minimal.css';
import '@vedratech/anydrop-ui/themes/rounded.css';
import '@vedratech/anydrop-ui/themes/glass.css';
import '@vedratech/anydrop-ui/themes/enterprise.css';

export const metadata = { title: 'AnyDrop React example (Next.js)' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
