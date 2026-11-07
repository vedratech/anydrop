import { test, expect } from '@playwright/test';

// Smoke test for the demo page. Runs in all five projects (the matrix is proven to start).
test('demo page loads and shows the library version', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByTestId('version')).toHaveText(/^\d+\.\d+\.\d+/);
  expect(errors).toEqual([]);
});
