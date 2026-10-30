import { db } from "../database";
import type { YnabAccount, YnabCategory, YnabConnection, YnabPayee } from "../../contracts/types";
import type { YnabAccountWire, YnabCategoryGroupWire, YnabPayeeWire } from "../../ynab/types";

const CONNECTION_ID = "connection";

function byName<T extends { name: string }>(rows: T[]): T[] {
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** The YNAB connection and the lists cached from its budget. Each apply* takes a delta (rows YNAB marks deleted are removed) and the knowledge it is at. */
export class YnabRepository {
  async getConnection(): Promise<YnabConnection | undefined> {
    return db.ynabConnection.get(CONNECTION_ID);
  }

  async saveConnection(input: { budgetId: string; budgetName: string }): Promise<YnabConnection> {
    const connection: YnabConnection = {
      id: CONNECTION_ID,
      ...input,
      connectedAt: Date.now(),
      categoriesKnowledge: 0,
      accountsKnowledge: 0,
      payeesKnowledge: 0,
    };
    await db.ynabConnection.put(connection);
    return connection;
  }

  async applyCategories(groups: YnabCategoryGroupWire[], knowledge: number): Promise<void> {
    await db.transaction("rw", [db.ynabCategories, db.ynabConnection], async () => {
      for (const group of groups) {
        for (const c of group.categories) {
          if (group.deleted || c.deleted) {
            await db.ynabCategories.delete(c.id);
          } else {
            await db.ynabCategories.put({
              id: c.id,
              groupId: group.id,
              groupName: group.name,
              name: c.name,
              hidden: c.hidden || group.hidden,
              ...(typeof c.balance === "number" ? { balance: c.balance / 1000 } : {}),
            });
          }
        }
      }
      await db.ynabConnection.update(CONNECTION_ID, { categoriesKnowledge: knowledge });
    });
  }

  async applyAccounts(accounts: YnabAccountWire[], knowledge: number): Promise<void> {
    await db.transaction("rw", [db.ynabAccounts, db.ynabConnection], async () => {
      for (const a of accounts) {
        if (a.deleted) {
          await db.ynabAccounts.delete(a.id);
        } else {
          await db.ynabAccounts.put({ id: a.id, name: a.name, type: a.type, onBudget: a.on_budget, closed: a.closed });
        }
      }
      await db.ynabConnection.update(CONNECTION_ID, { accountsKnowledge: knowledge });
    });
  }

  async applyPayees(payees: YnabPayeeWire[], knowledge: number): Promise<void> {
    await db.transaction("rw", [db.ynabPayees, db.ynabConnection], async () => {
      for (const p of payees) {
        if (p.deleted) await db.ynabPayees.delete(p.id);
        else await db.ynabPayees.put({ id: p.id, name: p.name });
      }
      await db.ynabConnection.update(CONNECTION_ID, { payeesKnowledge: knowledge });
    });
  }

  async listCategories(): Promise<YnabCategory[]> {
    return byName(await db.ynabCategories.toArray());
  }

  async listAccounts(): Promise<YnabAccount[]> {
    return byName(await db.ynabAccounts.toArray());
  }

  async listPayees(): Promise<YnabPayee[]> {
    return byName(await db.ynabPayees.toArray());
  }

  /** Forgets the connection and every cached list. */
  async clearAll(): Promise<void> {
    await db.transaction("rw", [db.ynabConnection, db.ynabCategories, db.ynabAccounts, db.ynabPayees], async () => {
      await db.ynabConnection.clear();
      await db.ynabCategories.clear();
      await db.ynabAccounts.clear();
      await db.ynabPayees.clear();
    });
  }
}
