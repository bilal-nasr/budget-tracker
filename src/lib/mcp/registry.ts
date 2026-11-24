import "server-only";
import { budgetTools } from "@/features/budgets/mcp";
import { categoryTools } from "@/features/categories/mcp";
import { currencyTools } from "@/features/currencies/mcp";
import { fixedTools } from "@/features/fixed/mcp";
import { installmentTools } from "@/features/installments/mcp";
import { invoiceTools } from "@/features/invoices/mcp";
import { itemTools } from "@/features/items/mcp";
import { loanTools } from "@/features/loans/mcp";
import { pendingPaymentTools } from "@/features/pending-payments/mcp";
import { profileTools } from "@/features/profile/mcp";
import { salaryTools } from "@/features/salary/mcp";
import { transactionTools } from "@/features/transactions/mcp";
import { walletTools } from "@/features/wallets/mcp";
import type { ToolDef } from "./tool";

/**
 * Every connector tool. A feature declares its tools in `src/features/<feature>/mcp.ts`
 * (with `defineTool`) and adds its array here; `/mcp` registers exactly this list.
 */
export const allTools: ToolDef[] = [
  ...profileTools,
  ...currencyTools,
  ...walletTools,
  ...categoryTools,
  ...transactionTools,
  ...budgetTools,
  ...fixedTools,
  ...installmentTools,
  ...salaryTools,
  ...loanTools,
  ...pendingPaymentTools,
  ...itemTools,
  ...invoiceTools,
];
