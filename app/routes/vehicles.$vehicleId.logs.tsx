import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, NavLink, Outlet, useLoaderData } from "@remix-run/react";
import invariant from "tiny-invariant";

import { getLogListItems } from "~/models/log.server";
import { requireUserId } from "~/session.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const userId = await requireUserId(request);
  invariant(params.vehicleId, "vehicleId not found");
  const logListItems = await getLogListItems({
    userId,
    vehicleId: params.vehicleId,
  });
  return json({ logListItems });
};

export default function LogsPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <main className="flex h-full w-full bg-white">
      <div className="h-full w-80 border-r bg-gray-50">
        <Link to="new" className="block p-4 text-xl text-blue-500">
          + New Log
        </Link>

        <hr />

        {data.logListItems.length === 0 ? (
          <p className="p-4">No vehicle logs yet</p>
        ) : (
          <ol>
            {data.logListItems.map((log) => (
              <li key={log.id}>
                <NavLink
                  className={({ isActive }) =>
                    `block border-b p-4 text-xl ${isActive ? "bg-white" : ""}`
                  }
                  to={log.id}
                >
                  {log.title}
                </NavLink>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="flex-1 p-6">
        <Outlet />
      </div>
    </main>
  );
}
