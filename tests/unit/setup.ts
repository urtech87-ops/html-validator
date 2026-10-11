import "@testing-library/jest-dom/vitest";

// Rate limits are tested on their own (rate-limit.test.ts); other tests call
// the API routes far faster than a person would.
process.env.RATE_LIMIT_ENABLED ??= "false";
