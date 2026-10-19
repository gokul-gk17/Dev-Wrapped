const router = require("express").Router();
const Event = require("../models/Event");

const cache = {};

async function cached(key, query, ttl = 600000) {
  const item = cache[key];

  if (item && Date.now() - item.time < ttl) {
    return item.data;
  }

  const data = await query();
  cache[key] = { time: Date.now(), data };

  return data;
}

router.get("/overview", async (req, res) => {
  try {
    const data = await cached("overview", async () => {
      const split = await Event.aggregate([
        {
          $group: {
            _id: { bot: "$is_bot", login: "$actor.login" },
            n: { $sum: 1 }
          }
        },
        {
          $group: {
            _id: "$_id.bot",
            actors: { $sum: 1 },
            events: { $sum: "$n" }
          }
        }
      ]).allowDiskUse(true);

      const daily = await Event.aggregate([
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
      ]);

      const byType = await Event.aggregate([
        { $group: { _id: "$type", n: { $sum: 1 } } },
        { $sort: { n: -1 } }
      ]);

      return {
        bots: split.find(item => item._id === true) || { events: 0, actors: 0 },
        humans: split.find(item => item._id === false) || { events: 0, actors: 0 },
        daily,
        byType
      };
    });

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/trending", async (req, res) => {
  try {
    const data = await cached("trending", () =>
      Event.aggregate([
        { $match: { is_bot: false } },
        {
          $group: {
            _id: { repo: "$repo.name", actor: "$actor.login" },
            n: { $sum: 1 }
          }
        },
        {
          $group: {
            _id: "$_id.repo",
            actors: { $sum: 1 },
            events: { $sum: "$n" }
          }
        },
        { $sort: { actors: -1, events: -1 } },
        { $limit: 10 }
      ]).allowDiskUse(true)
    );

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/orgs", async (req, res) => {
  try {
    const data = await cached("orgs", () =>
      Event.aggregate([
        { $match: { "org.login": { $exists: true }, is_bot: false } },
        { $group: { _id: "$org.login", events: { $sum: 1 } } },
        { $sort: { events: -1 } },
        { $limit: 10 }
      ])
    );

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/automation", async (req, res) => {
  try {
    const data = await cached("automation", () =>
      Event.aggregate([
        { $match: { is_bot: false } },
        {
          $group: {
            _id: "$actor.login",
            events: { $sum: 1 },
            repos: { $addToSet: "$repo.name" },
            types: { $addToSet: "$type" }
          }
        },
        { $match: { events: { $gte: 500 } } },
        {
          $project: {
            events: 1,
            nRepos: { $size: "$repos" },
            nTypes: { $size: "$types" }
          }
        },
        { $match: { nRepos: { $lte: 2 } } },
        { $sort: { events: -1 } },
        { $limit: 25 }
      ]).allowDiskUse(true)
    );

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/people", async (req, res) => {
  try {
    const data = await cached("people", () =>
      Event.aggregate([
        { $match: { is_bot: false } },
        {
          $group: {
            _id: "$actor.login",
            events: { $sum: 1 },
            repos: { $addToSet: "$repo.name" },
            types: { $addToSet: "$type" },
            days: {
              $addToSet: {
                $dateToString: { format: "%Y-%m-%d", date: "$created_at" }
              }
            },
            push: { $sum: { $cond: [{ $eq: ["$type", "PushEvent"] }, 1, 0] } },
            prs: { $sum: { $cond: [{ $eq: ["$type", "PullRequestEvent"] }, 1, 0] } },
            review: {
              $sum: {
                $cond: [
                  {
                    $in: [
                      "$type",
                      ["PullRequestReviewEvent", "PullRequestReviewCommentEvent"]
                    ]
                  },
                  1,
                  0
                ]
              }
            },
            issues: {
              $sum: {
                $cond: [
                  { $in: ["$type", ["IssuesEvent", "IssueCommentEvent"]] },
                  1,
                  0
                ]
              }
            }
          }
        },
        {
          $project: {
            events: 1,
            nRepos: { $size: "$repos" },
            nTypes: { $size: "$types" },
            nDays: { $size: "$days" },
            persona: {
              $switch: {
                branches: [
                  {
                    case: { $gte: [{ $divide: ["$review", "$events"] }, 0.25] },
                    then: "Reviewer"
                  },
                  {
                    case: { $gte: [{ $divide: ["$issues", "$events"] }, 0.25] },
                    then: "Issue Hunter"
                  },
                  {
                    case: { $gte: [{ $divide: ["$prs", "$events"] }, 0.25] },
                    then: "Pull Request Pro"
                  },
                  {
                    case: { $gte: [{ $divide: ["$push", "$events"] }, 0.6] },
                    then: "Committer"
                  }
                ],
                default: "All-Rounder"
              }
            }
          }
        },
        {
          $match: {
            events: { $gte: 25, $lte: 600 },
            nRepos: { $gte: 2 },
            nTypes: { $gte: 3 },
            nDays: { $gte: 3 }
          }
        },
        { $limit: 120 }
      ]).allowDiskUse(true)
    );

    let list = data;
    if (req.query.persona) {
      list = list.filter(item => item.persona === req.query.persona);
    }
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;