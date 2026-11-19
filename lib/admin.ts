import { cookies } from "next/headers";
import { ADMIN_COOKIE, verifyAdmin } from "./session";

// Tutte le route /api/admin/* passano da qui: senza cookie admin valido -> 401.
export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  return verifyAdmin(store.get(ADMIN_COOKIE)?.value);
}
