import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData } from "@remix-run/react";
import { useEffect, useRef } from "react";

import { createVehicle } from "~/models/vehicle.server";
import { requireUserId } from "~/session.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const userId = await requireUserId(request);

  const formData = await request.formData();
  const name = formData.get("name");
  const model = formData.get("model");
  const make = formData.get("make");
  const year = formData.get("year");

  const defaultErrors = { name: null, model: null, make: null, year: null };
  if (typeof name !== "string" && typeof name !== "undefined") {
    return json(
      { errors: { ...defaultErrors, make: "Name must be a string" } },
      { status: 400 },
    );
  }

  if (typeof make !== "string" || make.length === 0) {
    return json(
      { errors: { ...defaultErrors, make: "Make is required" } },
      { status: 400 },
    );
  }

  if (typeof model !== "string" || model.length === 0) {
    return json(
      { errors: { ...defaultErrors, model: "Model is required" } },
      { status: 400 },
    );
  }

  if (typeof year !== "string" || year.length === 0) {
    return json(
      { errors: { ...defaultErrors, year: "Year is required" } },
      { status: 400 },
    );
  }

  const vehicle = await createVehicle({ name, make, model, year, userId });

  return redirect(`/vehicles/${vehicle.id}`);
};

export default function NewVehiclePage() {
  const actionData = useActionData<typeof action>();
  const nameRef = useRef<HTMLInputElement>(null);
  const makeRef = useRef<HTMLInputElement>(null);
  const modelRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (actionData?.errors?.make) {
      makeRef.current?.focus();
    } else if (actionData?.errors?.model) {
      modelRef.current?.focus();
    } else if (actionData?.errors?.year) {
      yearRef.current?.focus();
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
      <div>
        <label className="flex w-full flex-col gap-1">
          <span>Name: </span>
          <input
            ref={nameRef}
            name="name"
            className="flex-1 rounded-md border-2 border-blue-500 px-3 text-lg leading-loose"
            aria-invalid={actionData?.errors?.name ? true : undefined}
            aria-errormessage={
              actionData?.errors?.name ? "name-error" : undefined
            }
          />
        </label>
        {actionData?.errors?.name ? (
          <div className="pt-1 text-red-700" id="name-error">
            {actionData.errors.name}
          </div>
        ) : null}
      </div>

      <div>
        <label className="flex w-full flex-col gap-1">
          <span>Make: </span>
          <input
            ref={makeRef}
            name="make"
            className="w-full flex-1 rounded-md border-2 border-blue-500 px-3 py-2 text-lg leading-6"
            aria-invalid={actionData?.errors?.make ? true : undefined}
            aria-errormessage={
              actionData?.errors?.make ? "make-error" : undefined
            }
          />
        </label>
        {actionData?.errors?.make ? (
          <div className="pt-1 text-red-700" id="make-error">
            {actionData.errors.make}
          </div>
        ) : null}
      </div>

      <div>
        <label className="flex w-full flex-col gap-1">
          <span>Model: </span>
          <input
            ref={modelRef}
            name="model"
            className="w-full flex-1 rounded-md border-2 border-blue-500 px-3 py-2 text-lg leading-6"
            aria-invalid={actionData?.errors?.model ? true : undefined}
            aria-errormessage={
              actionData?.errors?.model ? "model-error" : undefined
            }
          />
        </label>
        {actionData?.errors?.model ? (
          <div className="pt-1 text-red-700" id="model-error">
            {actionData.errors.model}
          </div>
        ) : null}
      </div>

      <div>
        <label className="flex w-full flex-col gap-1">
          <span>Year: </span>
          <input
            ref={yearRef}
            name="year"
            className="w-full flex-1 rounded-md border-2 border-blue-500 px-3 py-2 text-lg leading-6"
            aria-invalid={actionData?.errors?.year ? true : undefined}
            aria-errormessage={
              actionData?.errors?.year ? "year-error" : undefined
            }
          />
        </label>
        {actionData?.errors?.year ? (
          <div className="pt-1 text-red-700" id="year-error">
            {actionData.errors.year}
          </div>
        ) : null}
      </div>

      <div className="text-right">
        <button
          type="submit"
          className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 focus:bg-blue-400"
        >
          Save
        </button>
      </div>
    </Form>
  );
}
