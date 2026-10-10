// The update banner must stand out from the app's own blue bars: amber, with text that passes WCAG AA.
import { cleanup, render, screen } from '@testing-library/react';
import { startAppUpdates } from '@/services/app-update';
import { UpdateBanner } from './update-banner';
import { fakeSetup, fakeWorker } from '@/test/fake-registration';

// Tailwind 4 default palette values for the shades the banner may use.
const PALETTE: Record<string, string> = {
  'amber-300': '#ffd230',
  'amber-400': '#ffb900',
  'amber-500': '#fe9a00',
  'gray-900': '#101828',
  'gray-950': '#030712',
  black: '#000000',
};

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  cleanup();
});

function bannerClasses(): string[] {
  const setup = fakeSetup({ waiting: fakeWorker() });
  stop = startAppUpdates({ container: setup.container, registration: setup.registration, reload: setup.reload }).stop;
  render(<UpdateBanner />);
  return screen.getByRole('button', { name: 'Update ready, tap to reload' }).className.split(/\s+/);
}

describe('the update banner colour', () => {
  it('is not blue, so it does not blend in with the app bars', () => {
    const classes = bannerClasses();
    expect(classes.some((c) => /^bg-/.test(c))).toBe(true);
    expect(classes.filter((c) => /blue|sky|indigo/.test(c))).toEqual([]);
  });

  it('is amber with text that has at least AA contrast (4.5:1)', () => {
    const classes = bannerClasses();
    const bg = classes.find((c) => /^bg-amber-\d+$/.test(c))?.slice(3);
    const text = classes.find((c) => /^text-(gray-\d+|black)$/.test(c))?.slice(5);
    expect(bg).toBeDefined();
    expect(text).toBeDefined();
    expect(contrast(PALETTE[bg!], PALETTE[text!])).toBeGreaterThanOrEqual(4.5);
  });

  it('has no dark: override that would drop the contrast in dark mode', () => {
    expect(bannerClasses().filter((c) => c.startsWith('dark:'))).toEqual([]);
  });

  it('keeps reading as a button that can be tapped', () => {
    bannerClasses();
    expect(screen.getByRole('button', { name: 'Update ready, tap to reload' })).toBeEnabled();
  });
});
