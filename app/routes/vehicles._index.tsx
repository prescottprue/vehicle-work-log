import { LoaderFunctionArgs, json } from "@remix-run/node";
import { Link, NavLink, useLoaderData } from "@remix-run/react";

import { Breadcrumb, Breadcrumbs } from "~/components/Breadcrumbs";
import { getVehicleListItems } from "~/models/vehicle.server";
import { requireUserId } from "~/session.server";
import { getFileUrl } from "~/storage.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const userId = await requireUserId(request);
  const vehicles = await getVehicleListItems({ userId });
  const vehicleListItems = await Promise.all(
    vehicles.map(async (vehicle) => {
      if (!vehicle.avatarPath) {
        return {
          ...vehicle,
          avatarUrl: `https://placehold.co/701x738?text=${vehicle.name?.replace(" ", "+") || vehicle.model}`,
        };
      }
      const avatarUrl = await getFileUrl(vehicle.avatarPath);
      return { ...vehicle, avatarUrl };
    }),
  );
  return json({ vehicleListItems });
};

export default function VehiclesPage() {
  const data = useLoaderData<typeof loader>();
  return (
    <main className="flex h-full w-full flex-col gap-1 bg-white">
      <Breadcrumbs>
        <Breadcrumb to="/vehicles" label="Vehicles" lastChild />
      </Breadcrumbs>
      <section className="relative min-h-screen w-full">
        <div className="flex justify-end mr-10">
          <Link to="new">
            <button className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 focus:bg-blue-400 my-6">
              Create A New Vehicle
            </button>
          </Link>
        </div>
        <div className="static flex w-full justify-center mt-6">
          {data.vehicleListItems.length === 0 ? (
            <p className="p-4">No vehicles yet</p>
          ) : (
            <ul className="flex flex-row justify-center space-x-6">
              {data.vehicleListItems.map((vehicle) => (
                <li
                  key={vehicle.id}
                  className="max-w-sm bg-white border border-gray-200 rounded-lg shadow dark:bg-gray-800 dark:border-gray-700 min-w-24"
                >
                  <img
                    className="rounded-t-lg"
                    src={vehicle.avatarUrl}
                    alt=""
                  />
                  <div className="p-5">
                    <h5 className="mb-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                      {vehicle.name || `${vehicle.make} ${vehicle.model}`}
                    </h5>
                    <p className="mb-3 font-normal text-gray-700 dark:text-gray-400">{`${vehicle.year} ${vehicle.make} ${vehicle.model}`}</p>
                    <NavLink to={vehicle.id}>
                      <button
                        type="submit"
                        className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 focus:bg-blue-400"
                      >
                        Edit
                      </button>
                    </NavLink>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
