import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`home and record fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open app" })).toBeVisible();
    let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await page.getByRole("link", { name: "Open app" }).click();
    await expect(page.getByRole("heading", { name: /What the chain/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "The sealed file" })).toBeVisible();
    await expect(page.getByText("SignatureInvalid").first()).toBeHidden();
    await page.getByRole("tab", { name: /The classical key/ }).click();
    await expect(page.getByText("SignatureInvalid").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "The sealed file" })).toHaveCount(0);
    await page.getByRole("tab", { name: "Two arbiters" }).click();
    await expect(page.getByRole("heading", { name: "The sealed file" })).toBeVisible();
    await expect(page.getByText("Three sealed envelopes, one per arbiter.")).toBeVisible();
    await expect(page.getByText("It cannot open it")).toBeVisible();
    overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test("a refusal filter can be empty, and an unknown hash is refused", async ({ page }) => {
  await page.goto("/record?scene=release");
  await page.getByRole("button", { name: "Refused", exact: true }).click();
  await expect(page.getByText("This scene has no refusals.")).toBeVisible();
  await page.getByLabel("Look up a transaction hash").fill("0xdeadbeef");
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByText("That hash is not in this record.")).toBeVisible();
});

test("record and practice live in the app sidebar", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Record" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Switch to light/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Open app" }).click();
  await expect(page.getByRole("link", { name: "Record" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Practice" })).toBeVisible();
  await page.getByRole("link", { name: "Practice" }).click();
  await expect(page.getByRole("heading", { name: /refuse/ })).toBeVisible();
});

test("the known release hash opens that step", async ({ page }) => {
  await page.goto("/record");
  await page.getByLabel("Look up a transaction hash").fill("0x2ef9eac1ad5f785e");
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByRole("heading", { level: 3, name: /1.000000 fUSD/ })).toBeVisible();
});
