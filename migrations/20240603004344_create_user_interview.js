/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable("user_interviews", (table) => {
    table.increments("id").primary();
    // interview_id  foreign key
    table.integer("interview_id").unsigned().notNullable();
    table.foreign("interview_id").references("interviews.id");
    table.string("name");
    table.text("transcript");
    table.text("feedback");
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable("user_interviews");
};
