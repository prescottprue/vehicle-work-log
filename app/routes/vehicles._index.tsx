import { LoaderFunctionArgs, json } from "@remix-run/node";
import { Link, NavLink, useLoaderData } from "@remix-run/react";

import { getVehicleListItems } from "~/models/vehicle.server";
import { requireUserId } from "~/session.server";
import { getFileUrl } from "~/storage.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const userId = await requireUserId(request);
  const vehicles = await getVehicleListItems({ userId });
  const vehicleListItems = await Promise.all(vehicles.map(async (vehicle) => {
    if (!vehicle.avatarPath) {
      return { ...vehicle, avatarUrl: '' }
    }
    const avatarUrl = await getFileUrl(vehicle.avatarPath)
    return { ...vehicle, avatarUrl }
  }))
  return json({ vehicleListItems });
};

export default function VehiclesPage() {
  const data = useLoaderData<typeof loader>();
  return (
    <main className="flex h-full w-full flex-col gap-1 bg-white">
        <header className="m-6">
      <h1 className="text-3xl font-bold">Vehicles</h1>
      </header>
      <section className="relative min-h-screen bg-white flex w-full items-center justify-center flex flex-col">
        <div className="relative flex w-full justify-center flex flex-col text-gray-700 bg-white shadow-md w-96 rounded-xl bg-clip-border">
          {data.vehicleListItems.length === 0 ? (
            <p className="p-4">No vehicles yet</p>
          ) : (
            <ol>
              {data.vehicleListItems.map((vehicle) => (
                <li key={vehicle.id}>
                  {vehicle.avatarUrl ? <img src={vehicle.avatarUrl} /> : null}
                  <NavLink
                    className={({ isActive }) =>
                      `block border-b p-4 text-xl ${isActive ? "bg-white" : ""}`
                    }
                    to={vehicle.id}
                  >
                    {vehicle.name || `${vehicle.make} ${vehicle.model}`}
                  </NavLink>
                </li>
              ))}
            </ol>
          )}
        </div>
        <Link to="new">
          <button className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 focus:bg-blue-400 my-6">Create A New Vehicle</button>
        </Link>
      </section>
    </main>
  );
}
