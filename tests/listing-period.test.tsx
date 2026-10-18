// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { listingPeriodEnd } from '../src/web/lib/listing-period';
import ListingPeriodPresets from '../src/web/components/listing-period-presets';

it('calculates inclusive calendar months for the four sales shortcuts', () => {
  expect([1, 3, 6, 12].map(months => listingPeriodEnd('2026-10-18', months)))
    .toEqual(['2026-11-17', '2027-01-17', '2027-04-17', '2027-10-17']);
});
it('handles short months, leap years and periods starting on the first', () => {
  expect(listingPeriodEnd('2027-01-31', 1)).toBe('2027-02-28');
  expect(listingPeriodEnd('2024-01-31', 1)).toBe('2024-02-29');
  expect(listingPeriodEnd('2024-02-29', 12)).toBe('2025-02-28');
  expect(listingPeriodEnd('2026-01-01', 1)).toBe('2026-01-31');
  expect(listingPeriodEnd('2026-12-31', 3)).toBe('2027-03-30');
  expect(listingPeriodEnd('2026-02-30', 1)).toBe('');
});
it('disables shortcuts exceeding the verified account expiry and exposes the current selection', () => {
  document.body.innerHTML = renderToStaticMarkup(<ListingPeriodPresets startDate="2026-10-18" endDate="2026-11-17" maxEndDate="2027-02-01" onChange={() => {}} />);
  const buttons = [...document.querySelectorAll('button')];
  expect(buttons.map(x => x.textContent)).toEqual(['1달', '3달', '6개월', '1년']);
  expect(buttons.map(x => x.disabled)).toEqual([false, false, true, true]);
  expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
});
