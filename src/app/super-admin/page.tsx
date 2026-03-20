import AdminPortalClient from "@/components/admin/AdminPortalClient";
import {
    ADMIN_SESSION_COOKIE,
    getAdminUsernameFromToken,
    isSuperAdminToken,
} from "@/lib/adminAuth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function SuperAdminPortalPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const username = getAdminUsernameFromToken(token);

  if (!username) {
    redirect("/admin/signin");
  }

  if (!isSuperAdminToken(token)) {
    redirect("/admin");
  }

  return <AdminPortalClient username={username} portalMode="super-admin" />;
}
