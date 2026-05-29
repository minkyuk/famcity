import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session)) redirect("/");

  const users = await prisma.user.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      credits: true,
      spaces: { select: { role: true, space: { select: { id: true, name: true } } } },
      _count: { select: { posts: true, comments: true } },
    },
  });

  const stuck = users.filter((u) => u.spaces.length === 0);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-semibold text-gray-800 mb-1">Users</h1>
      <p className="text-sm text-gray-500 mb-5">
        {users.length} total · {stuck.length} logged in but joined no space
      </p>

      {stuck.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800 mb-2">
            Logged in but not in any space (invite likely expired / one-time link already used)
          </p>
          <ul className="flex flex-col gap-1">
            {stuck.map((u) => (
              <li key={u.id} className="text-sm text-amber-900">
                {u.name ?? "(no name)"} — {u.email ?? "no email"}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="text-left font-medium px-3 py-2">User</th>
              <th className="text-left font-medium px-3 py-2">Email</th>
              <th className="text-right font-medium px-3 py-2">Credits</th>
              <th className="text-right font-medium px-3 py-2">Posts</th>
              <th className="text-right font-medium px-3 py-2">Comments</th>
              <th className="text-left font-medium px-3 py-2">Spaces</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-gray-100 align-top">
                <td className="px-3 py-2">
                  <Link href={`/profile/${u.id}`} className="text-gray-800 hover:underline font-medium">
                    {u.name ?? "(no name)"}
                  </Link>
                </td>
                <td className="px-3 py-2 text-gray-600">{u.email ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-700">{u.credits}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-700">{u._count.posts}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-700">{u._count.comments}</td>
                <td className="px-3 py-2 text-gray-600">
                  {u.spaces.length === 0 ? (
                    <span className="text-amber-600">none</span>
                  ) : (
                    u.spaces.map((s) => s.space.name).join(", ")
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
