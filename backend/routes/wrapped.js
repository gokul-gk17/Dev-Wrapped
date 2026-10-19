const router = require("express").Router();
const mongoose = require("mongoose");
const Event = require("../models/Event");

function persona(byType, total) {
  const share = (...types) =>
    types.reduce((sum, type) => sum + (byType[type] || 0), 0) / total;

  if (share("PullRequestReviewEvent", "PullRequestReviewCommentEvent") >= 0.25)
    return "Reviewer";

  if (share("IssuesEvent", "IssueCommentEvent") >= 0.25)
    return "Issue Hunter";

  if (share("PullRequestEvent") >= 0.25)
    return "Pull Request Pro";

  if (share("PushEvent") >= 0.6)
    return "Committer";

  return "All-Rounder";
}

router.get("/:username", async (req, res) => {
  try {
    const username = req.params.username;
    const cache = mongoose.connection.db.collection("wrapped_summaries");

    const cached = await cache.findOne({ _id: username });

    if (cached) {
      return res.json({ ...cached.data, cached: true });
    }

    const [result] = await Event.aggregate([
      { $match: { "actor.login": username } },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                events: { $sum: 1 },
                repos: { $addToSet: "$repo.name" },
                first: { $min: "$created_at" },
                last: { $max: "$created_at" },
                isBot: { $first: "$is_bot" }
              }
            },
            {
              $project: {
                _id: 0,
                events: 1,
                repoCount: { $size: "$repos" },
                first: 1,
                last: 1,
                isBot: 1
              }
            }
          ],
          byType: [
            { $group: { _id: "$type", n: { $sum: 1 } } },
            { $sort: { n: -1 } }
          ],
          topRepos: [
            { $group: { _id: "$repo.name", n: { $sum: 1 } } },
            { $sort: { n: -1 } },
            { $limit: 5 }
          ],
          byDay: [
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$created_at"
                  }
                },
                n: { $sum: 1 }
              }
            },
            { $sort: { _id: 1 } }
          ],
          byWeekday: [
            { $group: { _id: { $dayOfWeek: "$created_at" }, n: { $sum: 1 } } },
            { $sort: { _id: 1 } }
          ],
          bySlot: [
            { $group: { _id: { $hour: "$created_at" }, n: { $sum: 1 } } },
            { $sort: { _id: 1 } }
          ]
        }
      }
    ]);

    const totals = result?.totals[0];

    if (!totals) {
      return res.status(404).json({
        error: "No events found for this username in the sampled period"
      });
    }

    const byType = Object.fromEntries(
      result.byType.map(item => [item._id, item.n])
    );

    const data = {
      user: username,
      events: totals.events,
      repos: totals.repoCount,
      firstSeen: totals.first,
      lastSeen: totals.last,
      isBot: totals.isBot,
      persona: persona(byType, totals.events),
      byType: result.byType,
      topRepos: result.topRepos,
      byDay: result.byDay,
      byWeekday: result.byWeekday,
      bySlot: result.bySlot
    };

    await cache.updateOne(
      { _id: username },
      { $set: { data, generatedAt: new Date() } },
      { upsert: true }
    );

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;