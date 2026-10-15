import { createConfiguredWebAPIs } from './runtimeConfig';
import type { RuntimeAPIs } from '@alcode/ui/lib/api/types';
import '@alcode/ui/index.css';
import '@alcode/ui/styles/fonts';
import '@alcode/ui/styles/katex-css';

declare global {
  interface Window {
    __ALCODE_RUNTIME_APIS__?: RuntimeAPIs;
  }
}

window.__ALCODE_RUNTIME_APIS__ = createConfiguredWebAPIs();

void import('@alcode/ui/apps/renderMobileApp')
  .then(({ renderMobileApp }) => {
    renderMobileApp(window.__ALCODE_RUNTIME_APIS__ ?? createConfiguredWebAPIs());
  });
