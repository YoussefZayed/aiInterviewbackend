/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable("interviews", (table) => {
    table.increments("id").primary();
    table.string("title");
    table.text("system_prompt");
    table.text("feedback_prompt");
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable("interviews");
};
