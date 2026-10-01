export class ApiError extends Error {
  constructor(public status: number, message: string, public blockers?: { code: string; label: string }[]) {
    super(message);
  }
}

export const apiRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; blockers?: { code: string; label: string }[] };
    const message = body.error === "offer_not_ready" || body.error === "stage_requirements_not_met"
      ? `Нужно заполнить: ${body.blockers?.map((blocker) => blocker.label).join("; ") || "данные обращения"}` : body.error ?? `HTTP ${response.status}`;
    throw new ApiError(response.status, message, body.blockers);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
};

