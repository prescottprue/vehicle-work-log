import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  isRouteErrorResponse,
  useLoaderData,
  useRouteError,
} from "@remix-run/react";
import invariant from "tiny-invariant";

import { deleteLog, getLog } from "~/models/log.server";
import { requireUserId } from "~/session.server";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const userId = await requireUserId(request);
  invariant(params.logId, "logId not found");
  invariant(params.vehicleId, "vehicleId not found");

  const log = await getLog({
    id: params.logId,
    vehicleId: params.vehicleId,
    userId,
  });
  if (!log) {
    throw new Response("Not Found", { status: 404 });
  }
  return json({ log });
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const userId = await requireUserId(request);
  invariant(params.logId, "logId not found");
  invariant(params.vehicleId, "vehicleId not found");

  await deleteLog({ id: params.logId, userId, vehicleId: params.vehicleId });

  return redirect(`/vehicles/${params.vehicleId}/logs`);
};

export default function NoteDetailsPage() {
  const { log } = useLoaderData<typeof loader>();

  return (
    <div>
      <h3 className="text-2xl font-bold">{log.title}</h3>
      <p className="py-4">{log.notes}</p>
      <p className="py-4">Service Date: {log.createdAt}</p>
      <p className="py-4">Type: {log.type}</p>
      <p className="py-4">Odometer: {log.odometer}</p>
      <p className="py-4">Cost: {log.cost}</p>
      <hr className="my-4" />
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
