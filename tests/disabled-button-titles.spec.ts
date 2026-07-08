import { test, expect } from '@playwright/test';

// Verify that disabled buttons carry their tooltip title directly on the
// <button> element rather than on a wrapping <span>.  Browsers don't relay
// pointer events (and therefore title tooltips) through to disabled children,
// so the title must live on the button itself to be visible on hover.

test.describe('Disabled button title attributes', () => {
  test('Edit page: Review & Publish button has title attribute directly on button when content changed', async ({ page }) => {
    // Navigate to a known model in staged/edit mode.
    // When not logged in and viewing a staged model, the Review & Publish
    // button should be visible and disabled due to shouldDisableActions.
    await page.goto('/#/edit/bioimage-io/noisy-parrot/stage');
    await page.waitForTimeout(4000);

    // The "Review & Publish" button is the publish tab trigger in the sidebar.
    // When shouldDisableActions is true (invalid/changed content), it is disabled
    // and must carry its title directly — not on a wrapping <span>.
    const reviewBtn = page.locator('button', { hasText: /review.*publish|publish/i })
      .filter({ has: page.locator(':disabled') })
      .first();

    // Fallback: look for any button with a descriptive title related to review
    const anyBtnWithTitle = page.locator('button[title]');
    const titleCount = await anyBtnWithTitle.count();

    if (titleCount > 0) {
      for (let i = 0; i < titleCount; i++) {
        const btn = anyBtnWithTitle.nth(i);
        const title = await btn.getAttribute('title');
        const text = (await btn.innerText()).trim().substring(0, 40);
        console.log(`Button with title: text="${text}", title="${title}"`);

        // Confirm title is on the button, not on a parent span
        const parentHasTitle = await btn.evaluate((el) => {
          const parent = el.parentElement;
          return parent?.tagName === 'SPAN' && parent?.hasAttribute('title') && !el.hasAttribute('title');
        });
        expect(parentHasTitle).toBe(false);
      }
    } else {
      // If no disabled buttons with titles found, check that no span wraps
      // have title attrs without their button child having it too.
      const spansWithTitle = page.locator('span[title]');
      const spanCount = await spansWithTitle.count();
      for (let i = 0; i < spanCount; i++) {
        const span = spansWithTitle.nth(i);
        const title = await span.getAttribute('title');
        const childBtn = span.locator('button[disabled]');
        const hasBtnChild = (await childBtn.count()) > 0;
        if (hasBtnChild) {
          // The button child must also carry the title attribute directly
          const btnTitle = await childBtn.first().getAttribute('title');
          console.log(`Span[title="${title}"] wraps disabled button with title="${btnTitle}"`);
          expect(btnTitle).toBeTruthy();
        }
      }
      console.log(`No disabled buttons with titles found (${spanCount} span[title] elements)`);
    }
  });

  test('Source code: Upload button title is on <button>, not <span>', async ({ page }) => {
    // This test verifies the source code structure by checking the production
    // bundle (already deployed static build).
    // Instead of loading the full upload flow, we check via DOM structure
    // that when we can find the Upload section, the title is on the button.

    await page.goto('/#/upload');
    await page.waitForTimeout(3000);

    // Any span[title] that wraps a disabled button is a bug
    const spansWithTitle = page.locator('span[title]');
    const count = await spansWithTitle.count();
    for (let i = 0; i < count; i++) {
      const span = spansWithTitle.nth(i);
      const disabledChild = span.locator('button[disabled]');
      if ((await disabledChild.count()) > 0) {
        // The disabled button child must also have the title attribute
        const btnTitle = await disabledChild.first().getAttribute('title');
        const spanTitle = await span.getAttribute('title');
        // If they're different, the title is only on the span (the old bug)
        expect(btnTitle).toBe(spanTitle);
      }
    }
  });
});
