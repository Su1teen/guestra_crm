import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import Calendar from "@/pages/Calendar";
import { CrmProvider } from "@/store/crm-store";

const renderCalendar = () =>
  render(
    <CrmProvider>
      <MemoryRouter>
        <Calendar />
      </MemoryRouter>
    </CrmProvider>,
  );

const todayLabel = new Intl.DateTimeFormat("ru-RU", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
}).format(new Date());

describe("Calendar month grid", () => {
  it("renders 42 day cells in a seven-column grid with a legend and property chip", async () => {
    renderCalendar();
    await waitFor(() => expect(screen.getByRole("grid", { name: /Календарь на/ })).toBeTruthy());
    expect(screen.getAllByRole("gridcell")).toHaveLength(42);
    expect(screen.getByText("Легенда")).toBeTruthy();
    expect(screen.getByText(/Объект:/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Предыдущий месяц" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Следующий месяц" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Сегодня" })).toBeTruthy();
  });

  it("opens day details on click and keeps counters consistent with the dialog", async () => {
    renderCalendar();
    await waitFor(() => expect(screen.getByRole("grid", { name: /Календарь на/ })).toBeTruthy());

    const todayButton = screen.getByRole("button", { name: new RegExp(`^${todayLabel}:`) });
    fireEvent.click(todayButton);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(screen.getByText(todayLabel, { exact: false })).toBeTruthy();
    // Сводка в заголовке диалога перечисляет те же счётчики, что и ячейка.
    expect(dialog.textContent).toMatch(/уникальн[а-я]* гост/);
    expect(dialog.textContent).toMatch(/заезд/);
    expect(dialog.textContent).toMatch(/выезд/);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("switches months and returns to today", async () => {
    renderCalendar();
    const monthYear = () => screen.getByRole("heading", { level: 2 }).textContent;

    await waitFor(() => expect(screen.getByRole("grid", { name: /Календарь на/ })).toBeTruthy());
    const initial = monthYear();
    fireEvent.click(screen.getByRole("button", { name: "Следующий месяц" }));
    expect(monthYear()).not.toBe(initial);
    fireEvent.click(screen.getByRole("button", { name: "Сегодня" }));
    expect(monthYear()).toBe(initial);
  });
});
