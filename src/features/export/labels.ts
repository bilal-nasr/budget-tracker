import type { ExportLocale } from "./model";

export const SHEET_KEYS = [
  "cover", "summary", "reconciliation", "monthlyActivity", "walletLedger", "budgetActual",
  "transactions", "expenseItems", "wallets", "categories", "salary", "fixedExpenses", "installments",
  "installmentPayments", "loans", "loanPayments", "receivables", "receipts", "checks",
] as const;
export type SheetKey = (typeof SHEET_KEYS)[number];

type ExportLabels = {
  sheets: Record<SheetKey, string>;
  columns: Record<
    "date" | "month" | "id" | "transactionId" | "type" | "leg" | "walletId" | "walletName" | "walletKind" |
    "currency" | "amount" | "inflow" | "outflow" | "categoryId" | "categoryName" | "categoryKind" |
    "parentCategory" | "note" | "source" | "fixedExpenseId" | "installmentId" | "loanId" | "receivableId" |
    "archived" | "openingBalance" | "calculatedClosing" | "appClosing" | "difference" | "operatingIncome" |
    "operatingExpense" | "loanIn" | "loanOut" | "transferIn" | "transferOut" | "netActivity" | "budget" |
    "actual" | "variance" | "variancePercent" | "status" | "description" | "position" | "dueDay" |
    "dueDate" | "total" | "received" | "remaining" | "paidBefore" | "paid" | "monthlyPayment" | "direction" |
    "principal" | "feeRate" | "fee" | "totalDue" | "openedOn" | "client" | "project" | "revision" |
    "borrowedOutstanding" | "lentOutstanding" | "installmentOutstanding" | "receivableOutstanding" |
    "metric" | "value" | "definition",
    string
  >;
  enums: Record<string, string>;
  values: Record<
    "yes" | "no" | "under" | "over" | "on" | "unbudgeted" | "notAvailable" | "cashBasis" |
    "sourceDescription" | "currencyRule" | "limitation" | "exportedAt" | "cutoff" | "timezone" |
    "workbookTitle" | "recordCounts" | "records" | "reconciliationChecks" | "walletDifference" | "definitions",
    string
  >;
};

const en: ExportLabels = {
  sheets: {
    cover: "Cover", summary: "Financial Summary", reconciliation: "Reconciliation", monthlyActivity: "Monthly Activity",
    walletLedger: "Wallet Ledger", budgetActual: "Budget vs Actual", transactions: "Transactions", expenseItems: "Expense Items",
    wallets: "Wallets", categories: "Categories", salary: "Salary", fixedExpenses: "Fixed Expenses", installments: "Installments",
    installmentPayments: "Installment Payments", loans: "Loans", loanPayments: "Loan Payments", receivables: "Receivables",
    receipts: "Receipts", checks: "Checks & Definitions",
  },
  columns: {
    date: "Date", month: "Month", id: "ID", transactionId: "Transaction ID", type: "Type", leg: "Ledger entry",
    walletId: "Wallet ID", walletName: "Wallet", walletKind: "Wallet type", currency: "Currency", amount: "Amount",
    inflow: "Inflow", outflow: "Outflow", categoryId: "Category ID", categoryName: "Category", categoryKind: "Category type",
    parentCategory: "Parent category", note: "Note", source: "Source", fixedExpenseId: "Fixed expense ID",
    installmentId: "Installment ID", loanId: "Loan ID", receivableId: "Receivable ID", archived: "Archived",
    openingBalance: "Opening balance", calculatedClosing: "Calculated closing balance", appClosing: "App closing balance",
    difference: "Difference", operatingIncome: "Cash income", operatingExpense: "Cash expenses", loanIn: "Loan cash in",
    loanOut: "Loan cash out", transferIn: "Transfers in", transferOut: "Transfers out", netActivity: "Net wallet activity",
    budget: "Budget", actual: "Actual expense", variance: "Variance", variancePercent: "Variance %", status: "Status",
    description: "Description", position: "Position", dueDay: "Due day", dueDate: "Due date", total: "Total",
    received: "Received", remaining: "Remaining", paidBefore: "Paid before app", paid: "Paid", monthlyPayment: "Monthly payment",
    direction: "Direction", principal: "Principal", feeRate: "Fee rate", fee: "Fee", totalDue: "Total due",
    openedOn: "Opened on", client: "Client", project: "Project", revision: "Revision", metric: "Metric", value: "Value",
    definition: "Definition", borrowedOutstanding: "Borrowed loans outstanding", lentOutstanding: "Lent loans outstanding",
    installmentOutstanding: "Installments outstanding", receivableOutstanding: "Receivables outstanding",
  },
  enums: {
    income: "Income", expense: "Expense", transfer: "Transfer", loan: "Loan", "loan-in": "Loan cash in",
    "loan-out": "Loan cash out", "transfer-in": "Transfer in", "transfer-out": "Transfer out",
    "cash-change": "Cash change", salary: "Salary", fixed: "Fixed expense", installment: "Installment",
    cash: "Cash", bank: "Bank", card: "Card", paidOff: "Paid off", unpaid: "Unpaid", partial: "Partially paid",
    paid: "Paid", borrowed: "Borrowed", lent: "Lent", disbursement: "Disbursement", repayment: "Repayment",
  },
  values: {
    yes: "Yes", no: "No", under: "Under budget", over: "Over budget", on: "On budget", unbudgeted: "No budget",
    notAvailable: "n.a.", cashBasis: "Cash basis. Transactions are reported when money enters or leaves a wallet.",
    sourceDescription: "Source: Budget Tracker export for the signed-in account.",
    currencyRule: "USD, LBP and SYP remain separate. No exchange rate is applied.",
    limitation: "This workbook is not a double-entry general ledger, trial balance, tax return or financial statement.",
    exportedAt: "Exported at", cutoff: "Reporting cutoff", timezone: "Timezone", workbookTitle: "Budget Tracker accounting export",
    recordCounts: "Record counts", records: "records", reconciliationChecks: "Wallet reconciliation checks",
    walletDifference: "Wallet reconciliation difference", definitions: "Definitions",
  },
};

const ar: ExportLabels = {
  sheets: {
    cover: "الغلاف", summary: "الملخص المالي", reconciliation: "التسوية", monthlyActivity: "النشاط الشهري",
    walletLedger: "دفتر المحافظ", budgetActual: "الميزانية والفعلية", transactions: "المعاملات", expenseItems: "تفاصيل المصروفات",
    wallets: "المحافظ", categories: "الفئات", salary: "الراتب", fixedExpenses: "المصاريف الثابتة", installments: "الأقساط",
    installmentPayments: "دفعات الأقساط", loans: "القروض", loanPayments: "دفعات القروض", receivables: "المبالغ المستحقة",
    receipts: "التحصيلات", checks: "الفحوص والتعريفات",
  },
  columns: {
    date: "التاريخ", month: "الشهر", id: "المعرّف", transactionId: "معرّف المعاملة", type: "النوع", leg: "قيد المحفظة",
    walletId: "معرّف المحفظة", walletName: "المحفظة", walletKind: "نوع المحفظة", currency: "العملة", amount: "المبلغ",
    inflow: "داخل", outflow: "خارج", categoryId: "معرّف الفئة", categoryName: "الفئة", categoryKind: "نوع الفئة",
    parentCategory: "الفئة الأم", note: "ملاحظة", source: "المصدر", fixedExpenseId: "معرّف المصروف الثابت",
    installmentId: "معرّف القسط", loanId: "معرّف القرض", receivableId: "معرّف المبلغ المستحق", archived: "مؤرشف",
    openingBalance: "الرصيد الافتتاحي", calculatedClosing: "الرصيد الختامي المحسوب", appClosing: "الرصيد الختامي في التطبيق",
    difference: "الفرق", operatingIncome: "الدخل النقدي", operatingExpense: "المصروفات النقدية", loanIn: "نقد داخل من القروض",
    loanOut: "نقد خارج للقروض", transferIn: "تحويلات داخلة", transferOut: "تحويلات خارجة", netActivity: "صافي نشاط المحافظ",
    budget: "الميزانية", actual: "المصروف الفعلي", variance: "الفرق عن الميزانية", variancePercent: "نسبة الفرق", status: "الحالة",
    description: "الوصف", position: "الترتيب", dueDay: "يوم الاستحقاق", dueDate: "تاريخ الاستحقاق", total: "الإجمالي",
    received: "المحصّل", remaining: "المتبقي", paidBefore: "مدفوع قبل التطبيق", paid: "المدفوع", monthlyPayment: "الدفعة الشهرية",
    direction: "الاتجاه", principal: "أصل القرض", feeRate: "نسبة الرسوم", fee: "الرسوم", totalDue: "إجمالي المستحق",
    openedOn: "تاريخ البدء", client: "العميل", project: "المشروع", revision: "المراجعة", metric: "البند", value: "القيمة",
    definition: "التعريف", borrowedOutstanding: "رصيد القروض المقترضة", lentOutstanding: "رصيد القروض المُقرضة",
    installmentOutstanding: "رصيد الأقساط", receivableOutstanding: "رصيد المبالغ المستحقة",
  },
  enums: {
    income: "دخل", expense: "مصروف", transfer: "تحويل", loan: "قرض", "loan-in": "نقد داخل من قرض",
    "loan-out": "نقد خارج لقرض", "transfer-in": "تحويل داخل", "transfer-out": "تحويل خارج",
    "cash-change": "باقي نقدي", salary: "راتب", fixed: "مصروف ثابت", installment: "قسط",
    cash: "نقدية", bank: "مصرفية", card: "بطاقة", paidOff: "مسدّد بالكامل", unpaid: "غير مدفوع",
    partial: "مدفوع جزئياً", paid: "مدفوع", borrowed: "مقترض", lent: "مُقرض", disbursement: "صرف",
    repayment: "سداد",
  },
  values: {
    yes: "نعم", no: "لا", under: "أقل من الميزانية", over: "أعلى من الميزانية", on: "مطابق للميزانية", unbudgeted: "بلا ميزانية",
    notAvailable: "غير متاح", cashBasis: "الأساس النقدي. تُعرض المعاملات عند دخول المال إلى المحفظة أو خروجه منها.",
    sourceDescription: "المصدر: تصدير Budget Tracker للحساب المسجّل دخوله.",
    currencyRule: "تبقى عملات USD وLBP وSYP منفصلة. لا يُطبّق أي سعر صرف.",
    limitation: "هذا المصنف ليس دفتر أستاذ مزدوج القيد ولا ميزان مراجعة ولا إقراراً ضريبياً ولا قوائم مالية.",
    exportedAt: "وقت التصدير", cutoff: "تاريخ القطع", timezone: "المنطقة الزمنية", workbookTitle: "تصدير محاسبي من Budget Tracker",
    recordCounts: "أعداد السجلات", records: "سجلات", reconciliationChecks: "فحوص تسوية المحافظ",
    walletDifference: "فرق تسوية المحافظ", definitions: "التعريفات",
  },
};

export function getExportLabels(locale: ExportLocale): ExportLabels {
  return locale === "ar" ? ar : en;
}

