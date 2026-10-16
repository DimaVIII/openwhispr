import React from 'react';
import { render } from '@testing-library/react-native';
import { I18nManager } from 'react-native';
import { AndroidSystemIcon as SystemIcon } from '../SystemIcon';

jest.mock('lucide-react-native', () => {
  const Text = require('react-native').Text;
  return Object.fromEntries(
    ['ArrowLeft', 'ArrowRight', 'ChevronLeft', 'ChevronRight', 'Mic'].map((name) => [
      name,
      () => <Text>{name}</Text>,
    ]),
  );
});
jest.mock('@/config/colors', () => ({ BRAND: '#2457C5', iosColor: () => '#111' }));

it.each([
  ['ArrowLeft', 'ArrowRight'],
  ['ChevronRight', 'ChevronLeft'],
  ['Mic', 'Mic'],
] as const)(
  'mirrors directional %s in RTL without mirroring non-directional icons',
  (icon, expected) => {
    const original = I18nManager.isRTL;
    try {
      I18nManager.isRTL = true;
      const view = render(<SystemIcon name="test" mdName={icon} />);
      expect(view.getByText(expected)).toBeTruthy();
      I18nManager.isRTL = false;
      view.rerender(<SystemIcon name="test" mdName={icon} />);
      expect(view.getByText(icon)).toBeTruthy();
    } finally {
      I18nManager.isRTL = original;
    }
  },
);
