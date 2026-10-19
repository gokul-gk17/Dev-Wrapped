const router = require("express").Router();
const Event = require("../models/Event");

router.get("/user/:username", async (req, res) => {
  try {
    const query = {
      "actor.login": req.params.username
    };

    const withoutIndex = await Event.find(query)
      .sort({ created_at: -1 })
      .hint({ $natural: 1 })
      .explain("executionStats");

    const withIndex = await Event.find(query)
      .sort({ created_at: -1 })
      .hint("actor_time")
      .explain("executionStats");

    res.json({
      withoutIndex: {
        ms: withoutIndex.executionStats.executionTimeMillis,
        docsExamined: withoutIndex.executionStats.totalDocsExamined,
        returned: withoutIndex.executionStats.nReturned
      },
      withIndex: {
        ms: withIndex.executionStats.executionTimeMillis,
        docsExamined: withIndex.executionStats.totalDocsExamined,
        returned: withIndex.executionStats.nReturned
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;