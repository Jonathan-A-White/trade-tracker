import { db } from "@/db/database";
import { YnabRepository, namedLikeTransfer } from "@/db/repositories/ynab-repository";
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
  // A category cached before its balance was kept has none, and a delta never repeats an unchanged category: read them all again.
  const categories = await client.categoryGroups(budgetId, (await hasCategoryWithoutBalance()) ? undefined : connection.categoriesKnowledge);
  const accounts = await client.accounts(budgetId, connection.accountsKnowledge);
  // A transfer payee cached before its account id was kept has no id, and a delta never repeats an unchanged payee: read them all again.
  const payees = await client.payees(budgetId, (await hasTransferPayeeWithoutId()) ? undefined : connection.payeesKnowledge);
  await repo.applyCategories(categories.rows, categories.serverKnowledge);
  await repo.applyAccounts(accounts.rows, accounts.serverKnowledge);
  await repo.applyPayees(payees.rows, payees.serverKnowledge);
}

/**
 * Whether a cached payee is named like YNAB's "Transfer : <account>" payee yet was cached before its transfer account id was kept
 * (the field is absent; a payee YNAB gave no id, such as one a user named that way, holds null and is not read again).
 */
async function hasTransferPayeeWithoutId(): Promise<boolean> {
  return (await repo.listPayees()).some((p) => p.transferAccountId === undefined && namedLikeTransfer(p.name));
}

/** Whether a cached category holds no balance (it was cached before the balance was kept). */
async function hasCategoryWithoutBalance(): Promise<boolean> {
  return (await repo.listCategories()).some((c) => typeof c.balance !== "number");
}
