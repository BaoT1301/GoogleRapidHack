"use client";

import { notFound, useParams, useSearchParams } from "next/navigation";
import { Workspace } from "@/components/canvas/Workspace";

// Graph ids in this app are Mongoose-default ObjectIds (24 hex). Some adjacent
// resources (projects, plans) are ULIDs, so we also accept that shape for
// forward-compat. Anything else hitting this catch-all is a stale link /
// bookmark / typo (e.g. `/dashboard/project`); rejecting it here avoids
// shipping a nonsense `id` to the BFF where Mongo would 500. See
// auth-bff data.graphs.getById.
const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

function isValidGraphId(id: string): boolean {
  return OBJECT_ID_RE.test(id) || ULID_RE.test(id);
}

export default function GraphPage() {
  const params = useParams<{ graphId: string }>();
  const persona = useSearchParams().get("persona") ?? undefined;
  const graphId = String(params.graphId ?? "");
  if (!isValidGraphId(graphId)) {
    notFound();
  }
  return <Workspace graphId={graphId} defaultPersona={persona} />;
}
