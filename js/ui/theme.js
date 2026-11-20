import { themeStore } from '../store.js';

/** Light/dark toggle; with no saved choice the OS preference applies. */
export function initTheme(button) {
  const root = document.documentElement;
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  const current = () => root.dataset.theme ?? (systemDark.matches ? 'dark' : 'light');

  function apply(theme) {
    if (theme) root.dataset.theme = theme;
    const next = current() === 'dark' ? 'Light' : 'Dark';
    button.textContent = next === 'Dark' ? '☾ Dark' : '☀ Light';
    button.setAttribute('aria-label', `Switch to ${next.toLowerCase()} mode`);
  }

  apply(themeStore.load());
  systemDark.addEventListener('change', () => apply(null));
  button.addEventListener('click', () => {
    const theme = current() === 'dark' ? 'light' : 'dark';
    themeStore.save(theme);
    apply(theme);
  });
}
