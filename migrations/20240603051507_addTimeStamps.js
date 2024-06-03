/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  // add to user_interviews created at and updated at timestamps
  return knex.schema.alterTable("user_interviews", (table) => {
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.timestamp("updated_at").defaultTo(knex.fn.now());
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable("user_interviews", (table) => {
    table.dropColumn("created_at");
    table.dropColumn("updated_at");
  });
};
