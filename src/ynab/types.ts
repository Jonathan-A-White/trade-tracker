// What api.ynab.com/v1 answers, as much of it as the app reads (snake_case, as YNAB writes it).

export interface YnabBudgetSummary {
  id: string;
  name: string;
}

export interface YnabCategoryWire {
  id: string;
  category_group_id: string;
  name: string;
  hidden: boolean;
  deleted: boolean;
}

export interface YnabCategoryGroupWire {
  id: string;
  name: string;
  hidden: boolean;
  deleted: boolean;
  categories: YnabCategoryWire[];
}

export interface YnabAccountWire {
  id: string;
  name: string;
  type: string;
  on_budget: boolean;
  closed: boolean;
  deleted: boolean;
}

export interface YnabPayeeWire {
  id: string;
  name: string;
  deleted: boolean;
}

/** A list read from YNAB: the rows and the server_knowledge to ask the next delta from. */
export interface YnabDelta<T> {
  rows: T[];
  serverKnowledge: number;
}

/** A transaction as YNAB reads and writes it (snake_case; `amount` in milliunits, negative for an outflow). No `import_id`: a transaction the app enters is matched by YNAB's own bank import. */
export interface YnabTransactionWire {
  id?: string;
  account_id: string;
  date: string;
  amount: number;
  payee_name?: string;
  category_id?: string | null;
  memo?: string | null;
  cleared?: "cleared" | "uncleared" | "reconciled";
  approved?: boolean;
  subtransactions?: { amount: number; category_id?: string | null; memo?: string | null }[];
  deleted?: boolean;
}
