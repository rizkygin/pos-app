"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("./index");
const schema_1 = require("./schema");
const cashflow_categories_1 = require("../lib/cashflow-categories");
const main = async () => {
    cashflow_categories_1.CATEGORY_IN.forEach(async (category) => {
        await index_1.db.insert(schema_1.cashInCategoryTable).values({
            category: category,
        });
    });
    cashflow_categories_1.CATEGORY_OUT.forEach(async (category) => {
        await index_1.db.insert(schema_1.cashOutCategoryTable).values({
            category: category,
        });
    });
};
main();
