import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData } from "@remix-run/react";
import { useEffect, useRef } from "react";
import invariant from "tiny-invariant";

import { createLog } from "~/models/log.server";
import { requireUserId } from "~/session.server";

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const userId = await requireUserId(request);

  invariant(params.vehicleId);

  const formData = await request.formData();
  const title = formData.get("title");
  const body = formData.get("body");
  const type = formData.get("type");
  const costInput = formData.get("cost");
  const cost = Number(costInput);
  const odometerInput = formData.get("odometer");
  const odometer = Number(odometerInput);
  console.log({ odometer, typeof: typeof odometer });
  const servicedAt = formData.get("servicedAt");
  const selfService = formData.get("selfService");

  const defaultErrors = {
    title: null,
    notes: null,
    type: null,
    cost: null,
    odometer: null,
    servicedAt: null,
    selfService: null,
  };
  if (typeof title !== "string" || title.length === 0) {
    return json(
      { errors: { ...defaultErrors, title: "Title is required" } },
      { status: 400 },
    );
  }

  if (typeof type !== "string" || type.length === 0) {
    return json(
      { errors: { ...defaultErrors, type: "Type is required" } },
      { status: 400 },
    );
  }

  if (typeof odometer !== "number" && odometer !== null) {
    return json(
      { errors: { ...defaultErrors, odometer: "Odometer must be a number" } },
      { status: 400 },
    );
  }

  if (typeof cost !== "number" && cost !== null) {
    return json(
      { errors: { ...defaultErrors, cost: "Cost must be a number" } },
      { status: 400 },
    );
  }

  if (typeof servicedAt !== "string" || servicedAt === null) {
    return json(
      {
        errors: { ...defaultErrors, servicedAt: "Serviced At must be a date" },
      },
      { status: 400 },
    );
  }

  if (typeof selfService !== "string" || selfService === null) {
    return json(
      {
        errors: {
          ...defaultErrors,
          selfService: "Self service must be a boolean",
        },
      },
      { status: 400 },
    );
  }

  // TODO: Add mechanic and tags

  const log = await createLog({
    notes,
    title,
    type,
    cost,
    odometer,
    servicedAt: new Date(servicedAt),
    selfService: Boolean(selfService),
    userId,
    vehicleId: params.vehicleId,
  });
  console.log("new log", { log });
  return redirect(`/vehicles/${params.vehicleId}/logs/${log.id}`);
};

export default function NewNotePage() {
  const actionData = useActionData<typeof action>();
  const titleRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const typeRef = useRef<HTMLInputElement>(null);
  const costRef = useRef<HTMLInputElement>(null);
  const odometerRef = useRef<HTMLInputElement>(null);
  const selfServiceRef = useRef<HTMLInputElement>(null);
  const servicedAtRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (actionData?.errors?.title) {
      titleRef.current?.focus();
    } else if (actionData?.errors?.notes) {
      notesRef.current?.focus();
    }
  }, [actionData]);

  return (
    <Form
      method="post"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        width: "100%",
      }}
    >
      <div className="text-right">
        <button
          type="submit"
          className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 focus:bg-blue-400"
        >
          Save
        </button>
      </div>
      <div>
        <label className="flex w-full flex-col gap-1">
          <span>Title: </span>
          <input
            ref={titleRef}
            name="title"
            className="flex-1 rounded-md border-2 border-blue-500 px-3 text-lg leading-loose"
            aria-invalid={actionData?.errors?.title ? true : undefined}
            aria-errormessage={
              actionData?.errors?.title ? "title-error" : undefined
            }
          />
        </label>
        {actionData?.errors?.title ? (
          <div className="pt-1 text-red-700" id="title-error">
            {actionData.errors.title}
          </div>
        ) : null}
      </div>

      <div className="flex w-full flex-col">
        <label className="flex w-full flex-col gap-1">
          <span>Notes: </span>
          <textarea
            ref={notesRef}
            name="body"
            rows={8}
            className="w-full flex-1 rounded-md border-2 border-blue-500 px-3 py-2 text-lg leading-6"
            aria-invalid={actionData?.errors?.notes ? true : undefined}
            aria-errormessage={
              actionData?.errors?.notes ? "notes-error" : undefined
            }
          />
        </label>
        {actionData?.errors?.notes ? (
          <div className="pt-1 text-red-700" id="notes-error">
            {actionData.errors.notes}
          </div>
        ) : null}
      </div>

      <div>
        <label className="flex w-full flex-col gap-1">
          <span>Type: </span>
          <input
            ref={typeRef}
            name="type"
            className="flex-1 rounded-md border-2 border-blue-500 px-3 text-lg leading-loose"
            aria-invalid={actionData?.errors?.type ? true : undefined}
            aria-errormessage={
              actionData?.errors?.type ? "type-error" : undefined
            }
          />
        </label>
        {actionData?.errors?.type ? (
          <div className="pt-1 text-red-700" id="type-error">
            {actionData.errors.type}
          </div>
        ) : null}
      </div>

      <div>
        <label className="flex w-full flex-col gap-1">
          <span>Cost: </span>
          <input
            ref={costRef}
            name="cost"
            type="number"
            className="flex-1 rounded-md border-2 border-blue-500 px-3 text-lg leading-loose"
            aria-invalid={actionData?.errors?.cost ? true : undefined}
            aria-errormessage={
              actionData?.errors?.cost ? "cost-error" : undefined
            }
          />
        </label>
        {actionData?.errors?.cost ? (
          <div className="pt-1 text-red-700" id="cost-error">
            {actionData.errors.cost}
          </div>
        ) : null}
      </div>

      <div>
        <label className="flex w-full flex-col gap-1">
          <span>Odometer: </span>
          <input
            ref={odometerRef}
            name="odometer"
            type="number"
            className="flex-1 rounded-md border-2 border-blue-500 px-3 text-lg leading-loose"
            aria-invalid={actionData?.errors?.odometer ? true : undefined}
            aria-errormessage={
              actionData?.errors?.odometer ? "odometer-error" : undefined
            }
          />
        </label>
        {actionData?.errors?.odometer ? (
          <div className="pt-1 text-red-700" id="odometer-error">
            {actionData.errors.odometer}
          </div>
        ) : null}
      </div>

      <div>
        <label className="flex w-full flex-col gap-1">
          <span>Service Date/Time: </span>
          <input
            ref={servicedAtRef}
            name="servicedAt"
            type="date"
            className="flex-1 rounded-md border-2 border-blue-500 px-3 text-lg leading-loose"
            aria-invalid={actionData?.errors?.servicedAt ? true : undefined}
            aria-errormessage={
              actionData?.errors?.servicedAt ? "servicedAt-error" : undefined
            }
          />
        </label>
        {actionData?.errors?.servicedAt ? (
          <div className="pt-1 text-red-700" id="servicedAt-error">
            {actionData.errors.servicedAt}
          </div>
        ) : null}
      </div>

      <div>
        <label>
          <span>Self Service: </span>
          <input
            ref={selfServiceRef}
            name="selfService"
            type="checkbox"
            className="flex-1 rounded-md border-2 border-blue-500 px-3 text-lg leading-loose"
            aria-invalid={actionData?.errors?.selfService ? true : undefined}
            aria-errormessage={
              actionData?.errors?.selfService ? "selfService-error" : undefined
            }
          />
        </label>
        {actionData?.errors?.selfService ? (
          <div className="pt-1 text-red-700" id="selfService-error">
            {actionData.errors.selfService}
          </div>
        ) : null}
      </div>
      <h3>Parts</h3>

    </Form>
  );
}
