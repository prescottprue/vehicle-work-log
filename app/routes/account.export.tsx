import { createFileRoute } from "@tanstack/react-router";

import { useAppSession } from "~/auth/session.server";
import { buildUserExport } from "~/models/export.server";

export const Route = createFileRoute("/account/export")({
  server: {
    handlers: {
      GET: async () => {
        const session = await useAppSession();
        const userId = session.data.userId;
        if (!userId) return new Response("Unauthorized", { status: 401 });

        const body = await buildUserExport(userId);
        if (!body) return new Response("Not found", { status: 404 });

        return Response.json(body, {
          headers: {
            "content-disposition": `attachment; filename="logbook-${body.user.email}.json"`,
          },
        });
      },
    },
  },
});
