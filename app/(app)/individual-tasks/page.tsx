"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { Card, EmptyState } from "@/components/ui/primitives";

/**
 * Individual tasks moved under /tasks, behind its "Individual tasks" filter.
 * Notifications written before the move still point here — and task_href only
 * changed for rows written from now on — so this keeps those links working.
 */
export default function IndividualTasksRedirect() {
  const router = useRouter();
  const params = useSearchParams();
  const task = params.get("task");

  useEffect(() => {
    router.replace(`/tasks?type=individual${task ? `&task=${task}` : ""}`);
  }, [router, task]);

  return (
    <Card>
      <EmptyState
        title="Individual tasks now live under Tasks"
        body="Taking you there…"
      />
    </Card>
  );
}
