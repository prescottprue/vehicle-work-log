import { LoaderFunctionArgs, json } from "@remix-run/node";
import { Link, NavLink, useLoaderData } from "@remix-run/react";

import { getVehicleListItems } from "~/models/vehicle.server";
import { requireUserId } from "~/session.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const userId = await requireUserId(request);
  const vehicleListItems = await getVehicleListItems({ userId });
  return json({ vehicleListItems });
};

export default function VehiclesPage() {
  const data = useLoaderData<typeof loader>();
  return (
    <p>
      {data.vehicleListItems.length === 0 ? (
        <p className="p-4">No vehicles yet</p>
      ) : (
        <ol>
          {data.vehicleListItems.map((vehicle) => (
            <li key={vehicle.id}>
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
      <Link to="new" className="text-blue-500 underline">
        create a new vehicle.
      </Link>
    </p>
  );
}
