import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  Link,
  Outlet,
  isRouteErrorResponse,
  useLoaderData,
  useRouteError,
} from "@remix-run/react";
import invariant from "tiny-invariant";

import { deleteVehicle, getVehicle } from "~/models/vehicle.server";
import { requireUserId } from "~/session.server";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const userId = await requireUserId(request);
  invariant(params.vehicleId, "vehicleId not found");

  const vehicle = await getVehicle({ id: params.vehicleId, userId });
  if (!vehicle) {
    throw new Response("Not Found", { status: 404 });
  }
  return json({ vehicle });
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const userId = await requireUserId(request);
  invariant(params.vehicleId, "vehicleId not found");

  await deleteVehicle({ id: params.vehicleId, userId });

  return redirect("/vehicles");
};

export default function VehicleDetailsPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <div>
      <h3 className="text-2xl font-bold">{data.vehicle.name}</h3>
      <p className="py-6">Make: {data.vehicle.make}</p>
      <p className="py-6">Model: {data.vehicle.model}</p>
      <p className="py-6">Year: {data.vehicle.year}</p>
      <hr className="my-4" />
      <Link to="logs" className="text-blue-500 underline">
        Vehicle Logs
      </Link>
      <Form method="post">
        <button
          type="submit"
          className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 focus:bg-blue-400"
        >
          Delete
        </button>
      </Form>
      <div className="flex-1 p-6">
        <Outlet />
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (error instanceof Error) {
    return <div>An unexpected error occurred: {error.message}</div>;
  }

  if (!isRouteErrorResponse(error)) {
    return <h1>Unknown Error</h1>;
  }

  if (error.status === 404) {
    return <div>Note not found</div>;
  }

  return <div>An unexpected error occurred: {error.statusText}</div>;
}
