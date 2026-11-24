import "server-only";
import { getProfile } from "@/features/profile/queries";
import { defineTool } from "@/lib/mcp/tool";
import { getSalaryStatus } from "./queries";

export const salaryTools = [
  defineTool({
    name: "salary_status_get",
    title: "Get salary status",
    description:
      "Whether salary has been received: the latest salary entry's date (`lastReceivedOn`) and whether it falls in the current month. " +
      "Use profile_get for the saved salary amount.",
    kind: "read",
    run: async () => getSalaryStatus((await getProfile()).timezone),
  }),
];
