import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`practice starts empty and fits at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/practice");
    await expect(page.getByRole("heading", { name: "No identities in this browser." })).toBeVisible();
    await page.getByRole("button", { name: "Make the two test identities" }).click();
    await expect(page.getByRole("heading", { name: /The two names/ })).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText("Client", { exact: true })).toBeVisible();
    await expect(page.getByText("Freelancer", { exact: true })).toBeVisible();
    await expect(page.getByText("The panel keys cannot be paid.")).toBeVisible();
    await expect(page.getByText("Fund the client from the faucet.")).toBeVisible();
    await expect(page.getByText("These should fail. Run them once an escrow exists.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Try to steal the pay" })).toBeDisabled();
    await expect(page.getByText("Courier did not carry this file.")).toBeVisible();
    await expect(page.getByText("1 Receipt")).toBeVisible();
    await expect(page.getByText("2 Deliver")).toBeVisible();
    await expect(page.getByText("Create the escrow first.", { exact: true })).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Release", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Deliver", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Receipt the sealed file" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Deliver the sealed file" })).toBeDisabled();
    await expect(page.getByText("No sealed file yet.")).toBeVisible();
    await page.getByRole("button", { name: "You as the freelancer" }).click();
    await expect(page.getByText("Create the escrow first.", { exact: true })).toHaveCount(2);
    await expect(page.getByText("Now. Receipt this file.", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Now. Deliver this file.", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Receipt the sealed file" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Deliver the sealed file" })).toBeDisabled();
    await expect(page.getByText("No sealed file yet.")).toBeVisible();
    let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: "Forget" }).click();
    await page.getByRole("button", { name: "Forget them" }).click();
    await expect(page.getByRole("heading", { name: "No identities in this browser." })).toBeVisible();
    overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}
