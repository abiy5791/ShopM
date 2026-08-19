import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Radix pins its internal packages to exact versions, so bumping one wrapper
 * (dialog) without the others (dropdown-menu, select, tabs) leaves npm with two
 * installed copies of the primitives underneath them.
 *
 * The ones listed here keep module-level state: which layers have disabled
 * outside pointer events, and what `<body>` looked like before the first one
 * did. Two copies means two disagreeing records — a menu blanks out
 * `pointer-events` on <body>, a dialog opened from that menu reads `none` as
 * the original, and restores `none` when it closes. The page then renders
 * normally and ignores every click until a reload.
 */
const STATEFUL_PRIMITIVES = ["react-dismissable-layer", "react-focus-scope", "react-focus-guards"];

const SCOPE = resolve(process.cwd(), "node_modules/@radix-ui");

/** Every install of `pkg` under an @radix-ui directory, however deeply nested. */
function copiesOf(pkg: string, scope: string, found: string[] = []): string[] {
  for (const entry of readdirSync(scope, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(scope, entry.name);
    if (entry.name === pkg) found.push(dir);
    const nested = join(dir, "node_modules", "@radix-ui");
    if (existsSync(nested)) copiesOf(pkg, nested, found);
  }
  return found;
}

describe.runIf(existsSync(SCOPE))("Radix layer primitives", () => {
  it.each(STATEFUL_PRIMITIVES)("are installed exactly once: %s", (pkg) => {
    // More than one? Align the @radix-ui/* versions in package.json until the
    // wrappers agree on the same primitive again.
    expect(copiesOf(pkg, SCOPE)).toHaveLength(1);
  });
});
