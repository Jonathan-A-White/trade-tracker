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
