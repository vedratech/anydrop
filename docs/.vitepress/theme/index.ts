import { h } from 'vue';
import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import HomeInstall from './components/HomeInstall.vue';
import HeroArt from './components/HeroArt.vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'home-hero-image': () => h(HeroArt),
      'home-hero-after': () => h(HomeInstall),
    });
  },
} satisfies Theme;
