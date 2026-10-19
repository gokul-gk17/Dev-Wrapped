require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.use("/api/wrapped", require("./routes/wrapped"));
app.use("/api/global", require("./routes/global"));
app.use("/api/events", require("./routes/events"));
app.use("/api/perf", require("./routes/perf"));

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    const port = process.env.PORT || 3000;

    app.listen(port, () => {
      console.log("API running at http://localhost:" + port);
    });
  })
  .catch((err) => {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  });