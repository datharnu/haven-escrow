import { expect, test } from "@playwright/test";

test("verify all against the live testnet", async ({ page }) => {
  test.skip(process.env.HAVEN_LIVE_VERIFY !== "1", "Set HAVEN_LIVE_VERIFY=1 to read the testnet.");
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/record");
  await page.getByRole("button", { name: "Verify all" }).click();
  await expect(page.getByText(/Checking \d+ of/)).toBeVisible();
  await expect(page.getByText(/Checking \d+ of/)).toHaveCount(0, { timeout: 170_000 });
  await page.getByRole("tab", { name: /Two arbiters/ }).click();
  await page.getByRole("button", { name: /Two arbiters, 7000/ }).click();
  await expect(page.getByText("The signature verifies over the message the contract builds.")).toBeVisible();
  let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 1440, height: 900 });
  overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
