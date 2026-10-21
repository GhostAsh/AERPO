export async function readJsonResponse<T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const responseText = await response.text();

  try {
    return JSON.parse(responseText) as T;
  } catch {
    const statusSuffix = response.status ? ` (${response.status})` : "";
    throw new Error(`${fallbackMessage}${statusSuffix}`);
  }
}
