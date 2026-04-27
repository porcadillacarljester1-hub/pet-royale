// Standard Playwright test fixture
import { test as base, expect } from "@playwright/test";

// Extend the base fixture with custom options if needed
export const test = base.extend({});

export { expect };
