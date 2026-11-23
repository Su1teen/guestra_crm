import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.fn();
vi.mock("@/lib/api", () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/store/crm-store", () => ({ useCrm: () => ({ data: { properties: [{ id: "les_borovoe", name: "ЛЕС Боровое" }] }, property: "les_borovoe" }) }));

import Knowledge from "@/pages/Knowledge";
import PriceCalendarView from "@/pages/PriceCalendarView";

beforeEach(() => apiRequest.mockReset());

describe("AI knowledge base editor", () => {
  it("shows filled and missing topics and saves a topic text for the property", async () => {
    apiRequest.mockImplementation(async (url: string) => String(url).startsWith("/api/crm/knowledge?") ? {
      topics: [{ topic: "pets", title: "Животные" }, { topic: "food", title: "Питание" }], canEdit: true,
      items: [{ id: "k1", topic: "food", title: "Питание", content: "Завтрак включён.", tags: [], language: "ru", active: true, updatedAt: "" }] } : {});
    render(<Knowledge />);
    expect(await screen.findByText("Завтрак включён.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Проверить ответ ИИ в Studio/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Заполнить" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Текст" }), { target: { value: "Можно с маленькими собаками." } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/api/crm/knowledge", expect.objectContaining({ method: "PUT" })));
    const sent = JSON.parse(apiRequest.mock.calls.find(([url]) => url === "/api/crm/knowledge")![1].body);
    expect(sent).toMatchObject({ propertyId: "les_borovoe", topic: "pets", content: "Можно с маленькими собаками." });
  });
});

describe("price calendar view", () => {
  it("shows the PMS price with its reason and says when PMS is not connected", async () => {
    apiRequest.mockResolvedValueOnce({ source: "guestra_pms", days: [{ date: "2027-06-01", roomTypeId: "t1", roomType: "Forest House", ratePlan: "BAR",
      price: 60000, why: ["Базовая цена тарифа", "Сезон «Лето»"] }] });
    const { unmount } = render(<PriceCalendarView />);
    expect(await screen.findByText("Forest House · BAR")).toBeTruthy();
    expect(screen.getByText("Сезон «Лето»")).toBeTruthy();
    unmount();
    apiRequest.mockResolvedValueOnce({ source: "not_connected", days: [] });
    render(<PriceCalendarView />);
    expect(await screen.findByText(/PMS не подключена/)).toBeTruthy();
  });
});
