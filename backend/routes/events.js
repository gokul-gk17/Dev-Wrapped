const router = require("express").Router();
const Event = require("../models/Event");

// Read events with optional filters and pagination
router.get("/", async (req, res) => {
  try {
    const { type, user, repo } = req.query;

    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 20, 1),
      100
    );

    const page = Math.max(
      parseInt(req.query.page, 10) || 1,
      1
    );

    const query = {};

    if (type) query.type = type;
    if (user) query["actor.login"] = user;
    if (repo) query["repo.name"] = repo;

    const docs = await Event.find(query, {
      type: 1,
      "actor.login": 1,
      "repo.name": 1,
      created_at: 1,
      id: 1
    })
      .sort({ created_at: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const total = await Event.countDocuments(query);

    res.json({ page, limit, total, docs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create an event
router.post("/", async (req, res) => {
  try {
    const doc = {
      ...req.body,
      created_at: new Date(req.body.created_at || Date.now())
    };

    if (doc.actor && typeof doc.actor.login === "string") {
      doc.is_bot = doc.actor.login.endsWith("[bot]");
    }

    await Event.collection.insertOne(doc);

    res.status(201).json({ inserted: doc.id });
  } catch (error) {
    if (error.code === 121) {
      return res.status(400).json({ error: "Schema validation failed" });
    }

    if (error.code === 11000) {
      return res.status(409).json({ error: "Event ID already exists" });
    }

    res.status(500).json({ error: error.message });
  }
});

// Update an event
router.put("/:id", async (req, res) => {
  try {
    const result = await Event.collection.updateOne(
      { id: req.params.id },
      { $set: req.body }
    );

    if (!result.matchedCount) {
      return res.status(404).json({ error: "Event not found" });
    }

    res.json({ modified: result.modifiedCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete an event
router.delete("/:id", async (req, res) => {
  try {
    const result = await Event.collection.deleteOne({
      id: req.params.id
    });

    if (!result.deletedCount) {
      return res.status(404).json({ error: "Event not found" });
    }

    res.json({ deleted: 1 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;