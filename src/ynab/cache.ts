import { db } from "@/db/database";
import { YnabRepository } from "@/db/repositories/ynab-repository";
import type { YnabClient } from "./api";
import type { YnabBudgetSummary } from "./types";

const repo = new YnabRepository();
const TABLES = [db.ynabConnection, db.ynabCategories, db.ynabAccounts, db.ynabPayees];

/**
 * Connects to a budget: reads its categories, accounts and payees and, only when all three were read, replaces what was cached
 * (of this budget or another) with them in one step. A failed read keeps nothing.
 */
export async function connectBudget(client: YnabClient, budget: YnabBudgetSummary): Promise<void> {
  const categories = await client.categoryGroups(budget.id);
  const accounts = await client.accounts(budget.id);
  const payees = await client.payees(budget.id);
  await db.transaction("rw", TABLES, async () => {
    await repo.clearAll();
    await repo.saveConnection({ budgetId: budget.id, budgetName: budget.name });
    await repo.applyCategories(categories.rows, categories.serverKnowledge);
    await repo.applyAccounts(accounts.rows, accounts.serverKnowledge);
    await repo.applyPayees(payees.rows, payees.serverKnowledge);
  });
}

/** Reads what changed in the connected budget since the last read (a delta by last_knowledge_of_server). Nothing without a connection. */
export async function refreshCache(client: YnabClient): Promise<void> {
  const connection = await repo.getConnection();
  if (!connection) return;
  const { budgetId } = connection;
  const categories = await client.categoryGroups(budgetId, connection.categoriesKnowledge);
  const accounts = await client.accounts(budgetId, connection.accountsKnowledge);
  const payees = await client.payees(budgetId, connection.payeesKnowledge);
  await repo.applyCategories(categories.rows, categories.serverKnowledge);
  await repo.applyAccounts(accounts.rows, accounts.serverKnowledge);
  await repo.applyPayees(payees.rows, payees.serverKnowledge);
}
