const { test, expect } = require('@playwright/test');

test.describe('Finance app UI', () => {
  test('loads the main lending manager page', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/Lending Manager - Ledger/i);
    await expect(page.locator('.sidebar-header h2')).toContainText('Lending Manager');
  });

  test('shows the sidebar navigation and the Add Loan page works', async ({ page }) => {
    await page.goto('/');

    const addLendingMenu = page.locator('.sidebar-menu .menu-item[data-page="add-lending"]');
    const addLoanMenu = page.locator('.sidebar-menu .menu-item[data-page="add-loan"]');

    await expect(addLendingMenu).toBeVisible();
    await expect(addLoanMenu).toBeVisible();

    await addLoanMenu.click();
    await expect(page.locator('#add-loan')).toBeVisible();
    await expect(page.locator('#loan-form')).toBeVisible();
    await expect(page.locator('#bank-name')).toBeVisible();
  });

  test('switches between desktop and mobile device view', async ({ page }) => {
    await page.goto('/');

    const toggle = page.locator('#device-toggle');
    await expect(toggle).toBeVisible();

    const beforeText = await page.locator('#device-toggle-label').textContent();
    await toggle.click();

    await expect(page.locator('#device-toggle-label')).not.toHaveText(beforeText || '');
  });
});
