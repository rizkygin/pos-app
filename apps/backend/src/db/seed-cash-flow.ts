import { db } from "./index";
import { cashInCategoryTable, cashOutCategoryTable } from "./schema";
import { CATEGORY_IN, CATEGORY_OUT } from "../lib/cashflow-categories";
const main = async () => {

    CATEGORY_IN.forEach(async (category) => {
        await db.insert(cashInCategoryTable).values(
            {
                category: category,
            }
        )
    })
    CATEGORY_OUT.forEach(async (category) => {
        await db.insert(cashOutCategoryTable).values(
            {
                category: category,
            }
        )
    })
}

main();