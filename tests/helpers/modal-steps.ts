import { expect, type Locator } from '@playwright/test';

/** Geometry/legacy-flow tests still navigate through the same validated Next action as users. */
export async function goToModalStep(dialog: Locator, name: string) {
  const tab = dialog.getByRole('tab', { name, exact: true });
  for (let index = 0; index < (await dialog.getByRole('tab').count()); index++) {
    if (!(await tab.isDisabled())) break;
    await dialog.getByRole('button', { name: 'مرحله بعد', exact: true }).click();
  }
  await expect(tab).toBeEnabled();
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
}
