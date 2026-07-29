import { describe, expect, it } from "vitest";

import { filenameFrom, readBlobError } from "./download";

describe("filenameFrom", () => {
  it("reads the server's filename", () => {
    expect(filenameFrom('attachment; filename="products-2026-07-28.xlsx"', "x.xlsx")).toBe(
      "products-2026-07-28.xlsx",
    );
  });

  it("decodes the RFC 5987 form", () => {
    expect(filenameFrom("attachment; filename*=UTF-8''sales%20report.pdf", "x.pdf")).toBe(
      "sales report.pdf",
    );
  });

  it("falls back when the header is missing or unparseable", () => {
    // Cross-origin responses hide the header unless the server exposes it.
    expect(filenameFrom(undefined, "products.xlsx")).toBe("products.xlsx");
    expect(filenameFrom("attachment", "products.xlsx")).toBe("products.xlsx");
  });
});

describe("readBlobError", () => {
  it("pulls detail out of a JSON error delivered as a blob", async () => {
    const blob = new Blob([JSON.stringify({ detail: "Only .xlsx files can be imported." })]);
    await expect(readBlobError(blob)).resolves.toBe("Only .xlsx files can be imported.");
  });

  it("returns null for non-blob or non-JSON bodies", async () => {
    await expect(readBlobError({ detail: "nope" })).resolves.toBeNull();
    await expect(readBlobError(new Blob(["<html>500</html>"]))).resolves.toBeNull();
  });
});
