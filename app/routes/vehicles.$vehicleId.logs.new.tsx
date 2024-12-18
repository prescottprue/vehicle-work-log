import type { ActionFunctionArgs } from "@remix-run/node";
import {
  json,
  redirect,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
} from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { useEffect, useRef } from "react";
import invariant from "tiny-invariant";
import { InputField } from "~/components/InputField";

import { createLog, updateLog } from "~/models/log.server";
import { requireUserId } from "~/session.server";
import { uploadFile } from "~/storage.server";
import { toLocalISOString } from "~/utils";

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const userId = await requireUserId(request);

  invariant(params.vehicleId);
  const uploadHandler = unstable_createMemoryUploadHandler({
    maxPartSize: 500_000,
  });
  const formData = await unstable_parseMultipartFormData(
    request,
    uploadHandler,
  );
  // const formData = await request.formData();
  const title = formData.get("title");
  const notes = formData.get("notes");
  const type = formData.get("type");
  const costInput = formData.get("cost");
  const cost = Number(costInput);
  const odometerInput = formData.get("odometer");
  const odometer = Number(odometerInput);
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

  if (typeof notes !== "string" && notes !== null) {
    return json(
      { errors: { ...defaultErrors, notes: "Title is required" } },
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

  if (typeof selfService !== "string" && selfService !== null) {
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

  // TODO: Add mechanic, tags and parts

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
  const attachmentsInput = formData.getAll("attachments");

  let attachmentsPaths: string[] = [];
  if (attachmentsInput) {
    const attachments = attachmentsInput as File[]
    try {
      await Promise.all(attachments.map(async (attachment) => {
        const attachmentPath = `log-attachments/${params.vehicleId}/${log.id}/${attachment.name}`;
        const fileBuffer = await attachment.arrayBuffer();
        await uploadFile(attachmentPath, Buffer.from(fileBuffer), attachment.size, {
          "Content-Type": attachment.type,
        });
        attachmentsPaths.push(attachmentPath)
      }))
    } catch (err) {
      console.log("Error uploading attachments", { err });
      return json(
        { errors: { ...defaultErrors, avatar: "Error uploading attachments" } },
        { status: 400 },
      );
    }
  }
  // Save attachment paths
  if (attachmentsPaths.length) {
    await updateLog({
      id: log.id,
      attachmentsPaths,
      userId,
      vehicleId: params.vehicleId,
    });
  }

  return redirect(`/vehicles/${params.vehicleId}/logs/${log.id}`);
};

export default function NewNotePage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  const titleRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  const isSubmitting = navigation.formAction?.endsWith("/logs/new");

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
      encType="multipart/form-data"
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
          className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 focus:bg-blue-400 disabled:opacity-70 text-center inline-flex items-center"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <div className="px-2">
              <svg
                className="animate-spin -ml-1 h-5 w-5 text-white"
                style={{ lineHeight: 1 }}
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
            </div>
          ) : (
            <>Save</>
          )}
        </button>
      </div>
      <InputField
        name="title"
        label="Title"
        error={actionData?.errors?.title}
      />
      <div className="flex w-full flex-col">
        <label className="flex w-full flex-col gap-1">
          <span>Notes: </span>
          <textarea
            ref={notesRef}
            name="notes"
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
      <InputField name="type" label="Type" error={actionData?.errors?.type} />
      <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
        <InputField type="number" name="cost" label="Cost" error={actionData?.errors?.cost} />
        <InputField type="number" name="odometer" label="Odometer" error={actionData?.errors?.odometer} />
      </div>
      <InputField type="datetime-local" name="servicedAt" label="Service Date/Time" error={actionData?.errors?.servicedAt} defaultValue={toLocalISOString(new Date())} />
      <div>
        <label>
          <span>Self Service: </span>
          <input
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
      <h3>Attachments</h3>
      <input
          type="file"
          id="attachments"
          name="attachments"
          multiple
          onChange={(e) => {
            console.log("e", e);
            // if (e.target.files) {
            //   setAvatarUrl(URL.createObjectURL(e.target.files[0]));
            // }
          }}
        />
      {/* <h3>Parts</h3>
      <table className="table-auto">
  <thead>
    <tr>
      <th>Name</th>
      <th>Manufacturer</th>
      <th>Price</th>
      <th>Link</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>The Sliding Mr. Bones (Next Stop, Pottersville)</td>
      <td>Malcolm Lockyer</td>
      <td>1961</td>
    </tr>
    <tr>
      <td>Witchy Woman</td>
      <td>The Eagles</td>
      <td>1972</td>
    </tr>
    <tr>
      <td>Shining Star</td>
      <td>Earth, Wind, and Fire</td>
      <td>1975</td>
    </tr>
  </tbody>
</table> */}
    </Form>
  );
}
