import type { ActionFunctionArgs } from "@remix-run/node";
import {
  json,
  redirect,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
} from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";

import { Breadcrumb, Breadcrumbs } from "~/components/Breadcrumbs";
import { InputField } from "~/components/InputField";
import { createVehicle } from "~/models/vehicle.server";
import { requireUserId } from "~/session.server";
import { uploadFile } from "~/storage.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const userId = await requireUserId(request);

  const uploadHandler = unstable_createMemoryUploadHandler({
    maxPartSize: 500_000,
  });
  const formData = await unstable_parseMultipartFormData(
    request,
    uploadHandler,
  );
  // const formData = await request.formData();
  const name = formData.get("name");
  const model = formData.get("model");
  const make = formData.get("make");
  const yearInput = formData.get("year");
  const year = Number(yearInput);
  const file = formData.get("avatar");

  const defaultErrors = { name: null, model: null, make: null, year: null };
  let avatarPath = null;
  if (file) {
    const fileObj = file as File;
    avatarPath = `vehicle-avatars/${userId}/${Date.now()}`;
    try {
      const fileBuffer = await fileObj.arrayBuffer();
      await uploadFile(avatarPath, Buffer.from(fileBuffer), fileObj.size, {
        "Content-Type": fileObj.type,
      });
    } catch (err) {
      console.log("Error uploading file", { err });
      return json(
        { errors: { ...defaultErrors, avatar: "Error uploading Avatar" } },
        { status: 400 },
      );
    }
  }

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

  if (typeof year !== "number") {
    return json(
      { errors: { ...defaultErrors, year: "Year is required" } },
      { status: 400 },
    );
  }

  const vehicle = await createVehicle({
    name,
    make,
    model,
    year,
    userId,
    avatarPath,
  });

  return redirect(`/vehicles/${vehicle.id}`);
};

export default function NewVehiclePage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  const nameRef = useRef<HTMLInputElement>(null);
  const makeRef = useRef<HTMLInputElement>(null);
  const modelRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);

  const [avatarPreview, setAvatarUrl] = useState("");

  const isSubmitting = navigation.formAction === '/vehicles/new';

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
    <div>
      <Breadcrumbs>
        <Breadcrumb to="/vehicles" label="Vehicles" />
        <Breadcrumb to="/vehicles/new" label="New Vehicle" lastChild />
      </Breadcrumbs>

      <Form
        method="post"
        encType="multipart/form-data"
        className="max-w-md mx-auto flex flex-col"
        style={{
          gap: 8,
        }}
      >
        <label htmlFor="avatar">Choose a vehicle avatar:</label>
        {avatarPreview ? (
          <img src={avatarPreview} alt="Preview Avatar" />
        ) : null}

        <input
          type="file"
          id="avatar"
          name="avatar"
          accept="image/png, image/jpeg"
          onChange={(e) => {
            if (e.target.files) {
              setAvatarUrl(URL.createObjectURL(e.target.files[0]));
            }
          }}
        />
        <InputField name="name" label="Name" error={actionData?.errors?.name} />
        <InputField type="number" name="year" label="Year" error={actionData?.errors?.year} />
        <InputField name="make" label="Make" error={actionData?.errors?.make} />
        <InputField name="model" label="Model" error={actionData?.errors?.model} />

        <div className="text-right">
          <button
            type="submit"
            className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 focus:bg-blue-400 disabled:opacity-70"
            disabled={isSubmitting}
          >
            Save
          </button>
        </div>
      </Form>
    </div>
  );
}
