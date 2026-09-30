import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "@/App";

const renderMockRoute = async (path: string) => {
  window.history.replaceState({}, "", path);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === "/api/auth/me") return new Response(JSON.stringify({ id: "user_sales", email: "sales@guestra.com",
      role: "sales", dataMode: "mock", employeeId: "emp_sultan", name: "Султан Аманжолов" }),
    { status: 200, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ error: "Unexpected request" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }));
  render(<App />);
};

describe("stay workspace demo flows", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("shows the in-house guest's stay context, completes a request, takes payment, and records both events", async () => {
    await renderMockRoute("/reservations?reservation=reservation_demo_balance_request");
    expect(await screen.findByRole("heading", { name: "Нурлан Жумабаев" })).toBeInTheDocument();
    expect(screen.getAllByText("A-103 · A-Frame").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/120\u00a0000|120 000/).length).toBeGreaterThan(0);
    expect(screen.getByText("Дополнительные полотенца")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Выполнено" }));
    await waitFor(() => expect(screen.queryByText("Дополнительные полотенца")).not.toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "Добавить оплату" })[0]);
    expect(await screen.findByRole("heading", { name: "Добавить оплату" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "120000" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить оплату" }));
    await waitFor(() => expect(screen.getByText(/Баланс:/).parentElement).toHaveTextContent(/0\u00a0₸|0 ₸/));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "История" }), { button: 0, ctrlKey: false });
    const history = await screen.findByRole("heading", { name: "История этого визита" });
    expect(history.closest("section")).toHaveTextContent(/Запрос .*выполн/);
    expect(screen.getByText(/Добавлена оплата/)).toBeInTheDocument();
  }, 45000);

  it("keeps due-out checkout blocked until balance and services are settled", async () => {
    await renderMockRoute("/reservations?reservation=reservation_demo_due_out");
    expect(await screen.findByText("ВЫЕЗД СЕГОДНЯ · требует внимания")).toBeInTheDocument();
    const checkout = screen.getByRole("button", { name: "Выселить гостя" });
    expect(checkout).toBeDisabled();
    expect(screen.getByText(/Выселение пока заблокировано/)).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Счёт" }), { button: 0, ctrlKey: false });
    expect(await screen.findByText(/остаётся открытым до расчёта/)).toBeInTheDocument();
  }, 45000);

  it("exposes the completed stay in the customer's visit history", async () => {
    await renderMockRoute("/guests/guest_002");
    expect(await screen.findByRole("heading", { name: "Айдос Тлеубаев" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Бронирования/ }));
    expect(await screen.findByText(/Итого 609\u00a0000 ₸|Итого 609 000 ₸/)).toBeInTheDocument();
    expect(screen.getByText(/Проживание 540\u00a0000 ₸|Проживание 540 000 ₸/)).toBeInTheDocument();
    expect(screen.getByText(/Доп\. услуги 69\u00a0000 ₸|Доп\. услуги 69 000 ₸/)).toBeInTheDocument();
  }, 45000);
});
