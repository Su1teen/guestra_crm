import { describe, expect, it } from "vitest";
import { propertyDate, propertyDateTimeIso, propertyTime } from "./service-time";

describe("property-local service time", () => {
  it("uses the property zone independently of browser timezone", () => {
    const instant = propertyDateTimeIso("2027-10-08", "10:00", "Asia/Qyzylorda");
    expect(instant).toBe("2027-10-08T05:00:00.000Z");
    expect(propertyTime(instant, "Asia/Qyzylorda")).toBe("10:00");
    expect(propertyDate(instant, "Asia/Qyzylorda")).toBe("2027-10-08");
  });
});
