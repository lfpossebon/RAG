import { NextRequest } from "next/server";

export function checkAuth(req: NextRequest): boolean {
  const header = req.headers.get("x-app-password");
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  return header === expected;
}
