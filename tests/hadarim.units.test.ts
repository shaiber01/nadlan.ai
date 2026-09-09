import { describe, expect, it } from "vitest";
import { areCommensurable, convertQuantity, lineValue, pricePerUnitHe, unitFamily } from "../src/hadarim/engine/units";

/** The unit model behind an order's value: the quantity is converted into the unit the price is quoted in. */
describe("units", () => {
  it("converts inside a family and refuses across families", () => {
    expect(convertQuantity(12_000, "ק״ג", "טון")).toBe(12);
    expect(convertQuantity(12, "טון", "ק״ג")).toBe(12_000);
    expect(convertQuantity(250, "מ׳", "מ׳")).toBe(250);
    expect(convertQuantity(1, "טון", "מ״ר")).toBeNull();
    expect(convertQuantity(3, "יח׳", "קומפ׳")).toBeNull();
    expect(areCommensurable("ק״ג", "טון")).toBe(true);
    expect(areCommensurable("יח׳", "יח׳")).toBe(true);
    expect(areCommensurable("חודש", "מ״ק")).toBe(false);
    expect(unitFamily("טון")).toBe("מסה");
    expect(unitFamily("ביקור")).toBeNull();
  });

  it("values a line with the quantity restated in the priced unit", () => {
    // the supplier quotes per ton and delivers in kg — 12,000 ק״ג is 12 טון, so the line is 57,600 ₪
    expect(lineValue({ qty: 12_000, unit: "ק״ג", priceUnit: "טון", unitPrice: 4_800 })).toMatchObject({ pricedQty: 12, amount: 57_600, converted: true, incommensurable: false });
    // one unit on both sides: the plain product, and no conversion claimed
    expect(lineValue({ qty: 15, unit: "חודשים", priceUnit: "חודשים", unitPrice: 30_000 })).toMatchObject({ amount: 450_000, converted: false });
    // the same numbers with the wrong unit on the quantity are worth a thousand times more
    expect(lineValue({ qty: 12_000, unit: "טון", priceUnit: "טון", unitPrice: 4_800 }).amount).toBe(57_600_000);
    // units that do not convert leave the line unvalued rather than multiplied blindly
    expect(lineValue({ qty: 12_000, unit: "ק״ג", priceUnit: "מ״ר", unitPrice: 4_800 })).toMatchObject({ amount: null, incommensurable: true });
  });

  it("names a price by its unit", () => {
    expect(pricePerUnitHe(4_800, "טון")).toBe("4,800 ₪ לטון");
    expect(pricePerUnitHe(4.8, "ק״ג")).toBe("4.8 ₪ לק״ג");
  });
});
