import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  useLoaderData,
  Link,
  Form,
  isRouteErrorResponse,
  useRouteError,
} from "@remix-run/react";
import invariant from "tiny-invariant";

import { deleteVehicle, getVehicle } from "~/models/vehicle.server";
import { requireUserId } from "~/session.server";
import { getFileUrl } from "~/storage.server";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const userId = await requireUserId(request);
  invariant(params.vehicleId, "vehicleId not found");

  const vehicle = await getVehicle({ id: params.vehicleId, userId });
  if (!vehicle) {
    throw new Response("Not Found", { status: 404 });
  }

  return json({
    vehicle: {
      ...vehicle,
      avatarUrl: vehicle.avatarPath
        ? await getFileUrl(vehicle.avatarPath)
        : `https://placehold.co/701x738?text=${vehicle.name?.replace(" ", "+") || vehicle.model}`,
    },
  });
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const userId = await requireUserId(request);
  invariant(params.vehicleId, "vehicleId not found");

  await deleteVehicle({ id: params.vehicleId, userId });

  return redirect("/vehicles");
};

export default function VehicleDetailPage() {
  const data = useLoaderData<typeof loader>();
  return (
    <div className="flex w-full flex-col gap-1 max-w-md mx-auto flex flex-col">
      <h3 className="text-2xl font-bold">
        {data.vehicle.name || `${data.vehicle.make} ${data.vehicle.model}`}
      </h3>
      <img src={data.vehicle.avatarUrl} alt="Vehicle Avatar" />
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
