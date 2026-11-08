import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@vedratech/anydrop-ui/style.css';
import '@vedratech/anydrop-ui/themes/minimal.css';
import '@vedratech/anydrop-ui/themes/rounded.css';
import '@vedratech/anydrop-ui/themes/glass.css';
import '@vedratech/anydrop-ui/themes/enterprise.css';
import { Scenario } from './Scenario';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Scenario />
  </StrictMode>,
);
