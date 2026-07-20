import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const contrastRatio = (left, right) => {
  const luminance = (hex) => {
    const normalized = hex.length === 4 ? `#${[...hex.slice(1)].map((value) => value + value).join('')}` : hex;
    const channels = normalized.match(/[\da-f]{2}/gi).map((value) => Number.parseInt(value, 16) / 255)
      .map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const [light, dark] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
};

test('account management uses responsive accessible account cards', () => {
  const manage = read('src/web/pages/manage.tsx');
  const css = read('src/web/styles.css');

  assert.match(manage, /className="account-management-page"/);
  assert.match(manage, /className="management-account-grid"/);
  assert.match(manage, /className="management-account-card"/);
  assert.match(manage, /className="management-account-metrics"/);
  assert.match(manage, /className="management-account-actions"/);
  assert.match(manage, /className="management-account-details"/);
  assert.match(manage, /aria-expanded=\{isOpen\}/);
  assert.match(manage, /aria-expanded=\{isAcctOpen\}/);
  assert.match(manage, /aria-controls=\{servicePanelId\}/);
  assert.match(manage, /aria-controls=\{accountPanelId\}/);
  assert.match(manage, /role="region"/);
  assert.match(manage, /aria-label=\{`\$\{displayAccountEmail\} 상세 관리`\}/);
  assert.equal((manage.match(/openFillModalForAccount\(acct, vi\)/g) || []).length, 1, 'account card must not render duplicate fill actions');
  assert.match(manage, /title=\{isGeneratedPending[^\n]+fillActionLabel/);

  assert.match(css, /\.management-service-toggle\s*\{[^}]*flex:\s*1[^}]*min-width:\s*0/s);
  const fillRule = css.match(/\.management-service-fill\s*\{([^}]*)\}/s)?.[1] || '';
  const fillBackground = fillRule.match(/background:\s*(#[\dA-F]{6})/i)?.[1];
  const fillText = fillRule.match(/color:\s*(#[\dA-F]{3,6})/i)?.[1];
  assert.ok(fillBackground && fillText && contrastRatio(fillBackground, fillText) >= 4.5, 'category fill action must meet WCAG AA text contrast');
  assert.match(css, /\.management-service-toggle:focus-visible\s*\{[^}]*outline-offset:\s*-\d+px/s);
  assert.match(css, /\.management-account-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /@media\s*\(max-width:\s*1100px\)[\s\S]*\.management-account-grid\s*\{[^}]*repeat\(2,/);
  assert.match(css, /@media\s*\(max-width:\s*700px\)[\s\S]*\.management-account-grid\s*\{[^}]*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.management-touch-target[^}]*min-height:\s*44px/s);
  assert.match(css, /\.account-management-page[^}]*:focus-visible/s);
  assert.match(css, /\.management-account-email[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /@media\s*\(max-width:\s*320px\)/);
});
