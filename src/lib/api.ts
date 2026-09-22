export async function api<T>(
  path: string,
  token?: string,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new Error("Unable to reach the portal API. Please try again.");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (body?.message) throw new Error(body.message);
    if (path === "/api/auth/login" && response.status === 401)
      throw new Error("Invalid credentials");
    if (path === "/api/auth/login" && response.status >= 500)
      throw new Error(
        "Portal API or database is unavailable. Please start the API and try again.",
      );
    if (path === "/api/auth/login")
      throw new Error("Unable to sign in right now. Please try again.");
    throw new Error("Unable to complete this action. Please try again.");
  }
  return body as T;
}
