import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "@/App";

describe("sales demo mode", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders the existing CRM dataset after a mock-mode session is restored", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/auth/me") {
        return new Response(JSON.stringify({
          id: "user_sales",
          email: "sales@guestra.com",
          role: "sales",
          dataMode: "mock",
          employeeId: "emp_sultan",
          name: "Султан Аманжолов",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "Unexpected request" }), { status: 500, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Обзор продаж" }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getAllByText(/· Демо/).length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
