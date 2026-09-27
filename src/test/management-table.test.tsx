import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ManagementReport from "@/pages/ManagementReport";

// По умолчанию раскрыты объекты (видны направления), статьи свёрнуты —
// как в исходной версии отчёта.
describe("ManagementReport hierarchy table", () => {
  it("renders every visible row inside a single flat tbody (no nested tbody)", () => {
    const { container } = render(<ManagementReport />);
    const bodies = container.querySelectorAll("tbody");
    expect(bodies).toHaveLength(1);
    expect(container.querySelectorAll("tbody tbody")).toHaveLength(0);
    // 2 объекта + 6 направлений (статьи свёрнуты) = 8 строк
    expect(bodies[0].querySelectorAll("tr")).toHaveLength(8);
    expect(container.querySelector("tfoot tr")).toBeTruthy();
    expect(screen.getByText("Итого · сеть, 2 объекта")).toBeTruthy();
  });

  it("keeps the hotel → direction → article expansion working", () => {
    const { container } = render(<ManagementReport />);
    const rows = () => container.querySelectorAll("tbody tr").length;

    const collapseHotel = screen.getByRole("button", { name: "Свернуть ЛЕС Боровое" });
    fireEvent.click(collapseHotel);
    expect(rows()).toBe(5);

    fireEvent.click(screen.getByRole("button", { name: "Развернуть ЛЕС Боровое" }));
    expect(rows()).toBe(8);

    fireEvent.click(screen.getAllByRole("button", { name: "Развернуть Проживание" })[0]);
    expect(rows()).toBe(10);

    fireEvent.click(screen.getAllByRole("button", { name: "Свернуть Проживание" })[0]);
    expect(rows()).toBe(8);
  });

  it("keeps header, body rows and totals aligned to the same column layout", () => {
    const { container } = render(<ManagementReport />);
    const table = container.querySelector("table.mrr-table")!;
    expect(table.querySelectorAll("thead th")).toHaveLength(9);
    for (const row of table.querySelectorAll("tbody tr")) {
      expect(row.querySelectorAll("th")).toHaveLength(1);
      expect(row.querySelectorAll("td")).toHaveLength(8);
    }
    const totalRow = table.querySelector("tfoot tr")!;
    expect(totalRow.querySelectorAll("th, td")).toHaveLength(9);
    expect(totalRow.querySelectorAll("td strong").length).toBeGreaterThan(0);
  });
});
