# Dashboard design guidelines

The existing finance dashboard is the visual reference. The user requested the same clean style throughout the operations UI on 2026-10-18.

## Shared visual language

- White panels on #fafafa; dark text #191919; primary actions #171717.
- Subtle #e5e5e5 borders, restrained shadows, 8–12px corner radii.
- Pretendard/system sans-serif, calm typography, clear heading/body/helper hierarchy.
- Shared colors use CSS variables defined in src/web/styles.css; operations layout and reusable patterns live in src/web/operations.css.
- Preserve meaningful success/warning/error colors and service identity colors. Avoid purple/pastel surfaces or decorative gradients for dashboard chrome.

## Layout

- Desktop: fixed 232px navigation sidebar, 74px top bar, wide responsive content with a 1440px cap.
- Below 960px: workspace switcher stays in the top bar; navigation becomes a drawer with Escape/focus support.
- Mobile: 16px content gutters, stacked panels, readable inputs, no horizontal page overflow.
- Administrative routes share the same navigation and neutral design tokens. Chat keeps its focused layout; buyer access pages and standalone finance retain their own navigation.

## Selling forms

- Distinguish form fields, optional guidance, submission and existing listings.
- Spotify uses a form with a companion listing panel; the list stacks beneath the form on mobile.
- 1달 / 3달 / 6개월 / 1년 buttons use inclusive calendar dates and stay consistent with manual date editing. Account expiry disables unavailable periods.
- Registration, deletion, buyer isolation and automation behavior must be preserved during presentation changes.
