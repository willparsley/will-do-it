// Exercise each control through the desktop toolbar or the mobile menus.
export async function addCard(page) {
  await page.getByRole('banner').waitFor();
  const quick = page.getByRole('button', { name: 'Quick Add', exact: true });
  if (await quick.isVisible()) return quick.click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New card', exact: true }).click();
}
export async function addStream(page) {
  await page.getByRole('banner').waitFor();
  const button = page.getByRole('button', { name: 'New Stream', exact: true });
  if (await button.isVisible()) return button.click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New stream', exact: true }).click();
}
export async function mobileBoard(page) {
  await page.getByRole('banner').waitFor();
  const layout = page.getByRole('button', { name: /Mobile layout/ });
  if (await layout.isVisible()) {
    await layout.click();
    await page.getByRole('option', { name: 'Board', exact: true }).click();
  }
}
export async function openFilters(page) {
  await page.getByRole('banner').waitFor();
  const button = page.getByRole('button', { name: /Filters/ });
  if (await button.isVisible() && !await page.getByRole('dialog', { name: 'Filters', exact: true }).isVisible()) await button.click();
}
export async function closeFilters(page) {
  const dialog = page.getByRole('dialog', { name: 'Filters', exact: true });
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Done', exact: true }).click();
}
export async function selectArea(page, name) {
  await openFilters(page);
  await page.getByRole('group', { name: 'Area filter', exact: true }).getByRole('button', { name, exact: true }).click();
  await closeFilters(page);
}
