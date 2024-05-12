import { Link } from "@remix-run/react";

export default function LogsIndexPage() {
  return (
    <p>
      No log selected. Select a log on the left, or{" "}
      <Link to="new" className="text-blue-500 underline">
        create a new log.
      </Link>
    </p>
  );
}
