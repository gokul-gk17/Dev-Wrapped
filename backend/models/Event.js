const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {},
  {
    strict: false,
    versionKey: false,
    collection: "events"
  }
);

module.exports = mongoose.model("Event", schema);