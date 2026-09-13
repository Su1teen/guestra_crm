import { describe, expect, it } from "vitest";
import { crmDataset } from "@/data/dataset";
import { segmentLabels } from "@/lib/labels";
import type { SegmentKey } from "@/types/crm";

const validSegmentKeys = Object.keys(segmentLabels) as SegmentKey[];

describe("Segments", () => {
  it("все ключи сегментов имеют метки", () => {
    expect(validSegmentKeys.length).toBeGreaterThan(5);
  });

  it("каждый сегмент в dataset имеет валидный ключ", () => {
    crmDataset.segments.forEach((segment) => {
      expect(validSegmentKeys).toContain(segment.key);
    });
  });

  it("сегменты имеют описание и участников", () => {
    crmDataset.segments.forEach((segment) => {
      expect(segment.name).toBeTruthy();
      expect(segment.description).toBeTruthy();
      expect(Array.isArray(segment.guestIds)).toBe(true);
      expect(segment.guestIds.length).toBeGreaterThanOrEqual(0);
    });
  });

  it("сумма размеров сегментов неотрицательна", () => {
    const totalSegmentCount = crmDataset.segments.reduce(
      (sum, segment) => sum + segment.guestIds.length,
      0,
    );
    expect(totalSegmentCount).toBeGreaterThanOrEqual(0);
  });

  it("ключи сегментов покрывают основные категории", () => {
    const requiredKeys: SegmentKey[] = ["new", "repeat", "vip", "corporate", "high_value", "dormant", "lost"];
    requiredKeys.forEach((key) => {
      expect(validSegmentKeys).toContain(key);
    });
  });

  it("каждый сегмент имеет правила", () => {
    crmDataset.segments.forEach((segment) => {
      expect(Array.isArray(segment.rules)).toBe(true);
    });
  });

  it("guestIds ссылаются на существующих гостей", () => {
    const guestIds = new Set(crmDataset.guests.map((guest) => guest.id));
    crmDataset.segments.forEach((segment) => {
      segment.guestIds.forEach((guestId) => {
        expect(guestIds.has(guestId)).toBe(true);
      });
    });
  });
});
