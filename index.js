const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ObjectId } = require("mongodb");
const dotenv = require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  console.log(`🛰️ [${req.method}] ${req.originalUrl}`);
  next();
});

// MongoDB setup
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is not defined");
  process.exit(1);
}

const client = new MongoClient(uri, {
  connectTimeoutMS: 5000,
  serverSelectionTimeoutMS: 5000,
});

let usersCollection, mealsCollection, reviewsCollection, upcomingMealsCollection, ordersCollection, paymentsCollection;

async function connectToMongo() {
  if (!usersCollection) {
    try {
      await client.connect();
      const db = client.db("hostel");
      usersCollection = db.collection("users");
      mealsCollection = db.collection("meals");
      reviewsCollection = db.collection("reviews");
      upcomingMealsCollection = db.collection("upcomingMeals");
      ordersCollection = db.collection("orders");
      paymentsCollection = db.collection("payments");
      console.log("✅ Connected to MongoDB");
    } catch (err) {
      console.error("❌ MongoDB connection error:", err.message, err.stack);
      throw err;
    }
  }
  return client;
}

// JWT Middleware
const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "Unauthorized access: No token provided" });
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ message: "Forbidden access: Invalid token" });
    req.user = { email: decoded.email.toLowerCase() };
    next();
  });
};

// Admin Middleware
const verifyAdmin = async (req, res, next) => {
  try {
    await connectToMongo();
    const user = await usersCollection.findOne({ email: req.user.email });
    if (!user || user.role !== "admin") return res.status(403).json({ message: "Admin access only" });
    next();
  } catch (error) {
    console.error("verifyAdmin error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Duplicate review
const restrictDuplicateReview = async (req, res, next) => {
  try {
    await connectToMongo();
    const { mealId, userEmail } = req.body;
    if (!ObjectId.isValid(mealId)) return res.status(400).json({ message: "Invalid meal ID format" });
    const exists = await reviewsCollection.findOne({ mealId, userEmail: userEmail.toLowerCase() });
    if (exists) return res.status(400).json({ message: "Duplicate review detected" });
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Duplicate request
const restrictDuplicateRequest = async (req, res, next) => {
  try {
    await connectToMongo();
    const { mealId } = req.body;
    const userEmail = req.user.email;
    if (!ObjectId.isValid(mealId)) return res.status(400).json({ message: "Invalid meal ID format" });
    const exists = await ordersCollection.findOne({ mealId, userEmail, status: { $in: ["pending", "paid"] } });
    if (exists) return res.status(400).json({ message: "Duplicate request detected" });
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Utility
const isValidUrl = (url) => {
  try { new URL(url); return true; } catch { return false; }
};

// Routes
app.post("/jwt", (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Email required" });
  const token = jwt.sign({ email: email.toLowerCase() }, process.env.JWT_SECRET, { expiresIn: "70d" });
  res.json({ token });
});

app.post("/login", async (req, res) => {
  try {
    await connectToMongo();
    const { idToken, email } = req.body;
    if (!idToken || !email) return res.status(400).json({ message: "ID token and email required" });
    const normalizedEmail = email.toLowerCase();
    let user = await usersCollection.findOne({ email: normalizedEmail });
    if (!user) {
      const result = await usersCollection.insertOne({
        name: email.split("@")[0],
        email: normalizedEmail,
        photoURL: null,
        role: "user",
        googleAuth: false,
        createdAt: new Date(),
      });
      user = { ...user, _id: result.insertedId };
    }
    const token = jwt.sign({ email: normalizedEmail }, process.env.JWT_SECRET, { expiresIn: "70d" });
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/users", async (req, res) => {
      try {
        const user = req.body;
        if (!user?.email || !user?.name) {
          console.log(`Missing required fields: email=${user?.email}, name=${user?.name}`);
          return res.status(400).json({ message: "Name and email are required" });
        }
        const exists = await usersCollection.findOne(
          { email: user.email.toLowerCase() },
          { collation: { locale: "en", strength: 2 } }
        );
        if (exists) {
          console.log(`User already exists: ${user.email.toLowerCase()}`);
          return res.status(409).json({ message: "User exists" });
        }
        const result = await usersCollection.insertOne({
          name: user.name,
          email: user.email.toLowerCase(),
          photoURL: user.photoURL || null,
          role: user.role || "user",
          googleAuth: user.googleAuth || false,
          createdAt: new Date(),
        });
        console.log(`User created: ${user.email.toLowerCase()}, Google: ${user.googleAuth || false}`);
        res.status(201).json({ success: true, insertedId: result.insertedId });
      } catch (err) {
        console.error("Error creating user:", { message: err.message, stack: err.stack });
        res.status(500).json({ message: "Server error" });
      }
    });

    app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const users = await usersCollection.find().toArray();
        res.json(users);
      } catch (err) {
        console.error("Error fetching users:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    app.get("/users/:email", verifyJWT, async (req, res) => {
      try {
        const user = await usersCollection.findOne(
          { email: req.params.email.toLowerCase() },
          { collation: { locale: "en", strength: 2 } }
        );
        if (!user) return res.status(404).json({ message: "User not found" });
        res.json(user);
      } catch (err) {
        console.error("Error fetching user:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    app.get("/users/admin/:email", verifyJWT, async (req, res) => {
      try {
        const user = await usersCollection.findOne(
          { email: req.params.email.toLowerCase() },
          { collation: { locale: "en", strength: 2 } }
        );
        res.json({ isAdmin: user?.role === "admin" });
      } catch (err) {
        console.error("Error checking admin status:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    app.patch("/users/admin/:id", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        if (!ObjectId.isValid(req.params.id)) {
          console.log(`Invalid user ID: ${req.params.id}`);
          return res.status(400).json({ message: "Invalid user ID" });
        }
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { role: "admin" } }
        );
        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "User not found" });
        }
        res.json(result);
      } catch (err) {
        console.error("Error updating admin role:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    app.delete("/users/:id", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        if (!ObjectId.isValid(req.params.id)) {
          console.log(`Invalid user ID: ${req.params.id}`);
          return res.status(400).json({ message: "Invalid user ID" });
        }
        const result = await usersCollection.deleteOne({
          _id: new ObjectId(req.params.id),
        });
        if (result.deletedCount === 0) {
          return res.status(404).json({ message: "User not found" });
        }
        res.json(result);
      } catch (err) {
        console.error("Error deleting user:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Meals
    app.get("/meals", async (req, res) => {
      try {
        const { category, minPrice, maxPrice, search, page = 1, limit = 6 } = req.query;
        const query = {};

        if (category && category !== "All") {
          query.category = category;
        }

        if (minPrice || maxPrice) {
          query.price = {};
          if (minPrice) query.price.$gte = Number(minPrice);
          if (maxPrice) query.price.$lte = Number(maxPrice);
        }

        if (search) {
          query.title = { $regex: search, $options: "i" };
        }

        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 6;
        const skip = (pageNum - 1) * limitNum;

        const meals = await mealsCollection
          .find(query)
          .skip(skip)
          .limit(limitNum)
          .toArray();

        const total = await mealsCollection.countDocuments(query);

        res.json({
          meals,
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        });
      } catch (err) {
        console.error("Error fetching meals:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    app.post("/meals", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const meal = req.body;
        const requiredFields = ["title", "category", "price", "description", "ingredients"];
        const missingFields = requiredFields.filter((field) => !meal[field]);
        if (missingFields.length > 0) {
          return res.status(400).json({ message: `Missing required fields: ${missingFields.join(", ")}` });
        }
        meal.distributorName = meal.distributorName || "Hostel Kitchen";
        if (meal.photoUrl && !isValidUrl(meal.photoUrl)) {
          return res.status(400).json({ message: "Invalid photoUrl" });
        }
        meal.ingredients = Array.isArray(meal.ingredients) ? meal.ingredients : [];
        meal.price = Number(meal.price);
        meal.likedBy = meal.likedBy || [];
        meal.rating = meal.rating || 0;
        meal.reviews_count = meal.reviews_count || 0;
        meal.postTime = meal.postTime ? new Date(meal.postTime) : new Date();
        const result = await mealsCollection.insertOne(meal);
        console.log(`Meal created: ${meal.title}, ID: ${result.insertedId}`);
        res.status(201).json(result);
      } catch (err) {
        console.error("Error creating meal:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Meals Stats
    app.get("/meals/stats", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        console.log("Fetching meal stats for admin", { userEmail: req.user.email });

        const validMealIds = await mealsCollection
          .find({}, { projection: { _id: 1 } })
          .toArray()
          .then((meals) => meals.map((m) => m._id.toString()));

        console.log("Valid meal IDs:", { count: validMealIds.length, ids: validMealIds });

        const invalidReviews = await reviewsCollection
          .find(
            { mealId: { $not: { $regex: /^[0-9a-fA-F]{24}$/ } } },
            { projection: { _id: 1, mealId: 1, userEmail: 1 } }
          )
          .toArray();
        if (invalidReviews.length > 0) {
          console.warn("Found invalid mealIds in reviewsCollection:", {
            count: invalidReviews.length,
            invalidIds: invalidReviews.map((r) => ({ _id: r._id.toString(), mealId: r.mealId, userEmail: r.userEmail })),
          });
        }

        const invalidOrders = await ordersCollection
          .find(
            { mealId: { $not: { $regex: /^[0-9a-fA-F]{24}$/ } } },
            { projection: { _id: 1, mealId: 1, userEmail: 1 } }
          )
          .toArray();
        if (invalidOrders.length > 0) {
          console.warn("Found invalid mealIds in ordersCollection:", {
            count: invalidOrders.length,
            invalidIds: invalidOrders.map((o) => ({ _id: o._id.toString(), mealId: o.mealId, userEmail: o.userEmail })),
          });
        }

        const stats = await mealsCollection
          .aggregate([
            {
              $lookup: {
                from: "reviews",
                let: { mealId: "$_id" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ["$mealId", { $toString: "$$mealId" }] },
                          { $regexMatch: { input: "$mealId", regex: /^[0-9a-fA-F]{24}$/ } },
                          { $in: ["$mealId", validMealIds] },
                        ],
                      },
                    },
                  },
                ],
                as: "reviews",
              },
            },
            {
              $addFields: {
                likes: { $size: { $ifNull: ["$likedBy", []] } },
              },
            },
            {
              $project: {
                _id: 1,
                title: 1,
                likes: 1,
                reviewCount: { $size: "$reviews" },
                rating: { $avg: "$reviews.rating" },
              },
            },
          ])
          .toArray();

        console.log(`Fetched meal stats, count: ${stats.length}`, {
          titles: stats.map((s) => s.title),
          ids: stats.map((s) => s._id.toString()),
        });
        res.json(stats);
      } catch (err) {
        console.error("Error fetching meal stats:", {
          message: err.message,
          stack: err.stack,
        });
        if (err.name === "BSONError") {
          return res.status(400).json({ message: "Invalid meal ID format in database" });
        }
        res.status(500).json({ message: "Server error", error: err.message });
      }
    });

    // Unserved Meals with Search
    app.get("/meals/unserved", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const { search, page = 1, limit = 10 } = req.query;
        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 10;
        const skip = (pageNum - 1) * limitNum;

        console.log(`🛰️ [GET] /meals/unserved`, { search, page: pageNum, limit: limitNum, userEmail: req.user.email });

        // Get valid meal IDs from mealsCollection
        const validMealIds = await mealsCollection
          .find({}, { projection: { _id: 1 } })
          .toArray()
          .then((meals) => meals.map((m) => m._id.toString()));
        console.log("Valid meal IDs:", { count: validMealIds.length, mealIds: validMealIds });

        // Clean up invalid orders
        const invalidOrders = await ordersCollection
          .find(
            {
              $or: [
                { mealId: { $not: { $regex: /^[0-9a-fA-F]{24}$/ } } },
                { mealId: { $not: { $type: "string" } } },
                { mealId: { $nin: validMealIds } },
              ],
            },
            { projection: { _id: 1, mealId: 1, userEmail: 1, status: 1 } }
          )
          .toArray();
        if (invalidOrders.length > 0) {
          console.warn("Found invalid mealIds in ordersCollection:", {
            count: invalidOrders.length,
            invalidIds: invalidOrders.map((o) => ({
              _id: o._id.toString(),
              mealId: o.mealId,
              mealIdType: typeof o.mealId,
              userEmail: o.userEmail,
              status: o.status,
            })),
          });
          await ordersCollection.deleteMany({
            $or: [
              { mealId: { $not: { $regex: /^[0-9a-fA-F]{24}$/ } } },
              { mealId: { $not: { $type: "string" } } },
              { mealId: { $nin: validMealIds } },
            ],
          });
          console.log(`Deleted ${invalidOrders.length} invalid orders`);
        }

        // Define match stage with strict validation
        let matchStage = {
          status: { $in: ["pending", "paid"] },
          mealId: { $type: "string", $regex: /^[0-9a-fA-F]{24}$/, $in: validMealIds },
        };

        if (search) {
          const users = await usersCollection
            .find(
              {
                $or: [
                  { name: { $regex: search, $options: "i" } },
                  { email: { $regex: search, $options: "i" } },
                ],
              },
              { collation: { locale: "en", strength: 2 } }
            )
            .toArray();
          const userEmails = users.map((user) => user.email.toLowerCase());
          if (userEmails.length === 0) {
            console.log(`No users found for search term: ${search}`);
            return res.json({
              meals: [],
              total: 0,
              page: pageNum,
              limit: limitNum,
              totalPages: 0,
            });
          }
          matchStage.userEmail = { $in: userEmails };
        }

        const matchingOrdersCount = await ordersCollection.countDocuments(matchStage);
        if (matchingOrdersCount === 0) {
          console.log(`No unserved orders found matching criteria`, { search, page: pageNum, limit: limitNum });
          return res.json({
            meals: [],
            total: 0,
            page: pageNum,
            limit: limitNum,
            totalPages: 0,
          });
        }

        const pipeline = [
          { $match: matchStage },
          {
            $lookup: {
              from: "meals",
              let: { mealId: { $toObjectId: "$mealId" } },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ["$_id", "$$mealId"] },
                  },
                },
              ],
              as: "mealData",
            },
          },
          { $unwind: { path: "$mealData", preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: "users",
              localField: "userEmail",
              foreignField: "email",
              as: "userData",
            },
          },
          {
            $unwind: {
              path: "$userData",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $project: {
              _id: 1,
              mealTitle: { $ifNull: ["$mealData.title", "Unknown Meal"] },
              userEmail: 1,
              userName: { $ifNull: ["$userData.name", "Unknown User"] },
              status: 1,
              price: 1,
            },
          },
          { $skip: skip },
          { $limit: limitNum },
        ];

        const unserved = await ordersCollection.aggregate(pipeline).toArray();
        console.log(
          `Fetched ${unserved.length} unserved meals:`,
          unserved.map((o) => ({
            _id: o._id.toString(),
            mealTitle: o.mealTitle,
            userEmail: o.userEmail,
            status: o.status,
          }))
        );

        res.json({
          meals: unserved,
          total: matchingOrdersCount,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(matchingOrdersCount / limitNum),
        });
      } catch (err) {
        console.error("Error fetching unserved meals:", {
          message: err.message,
          stack: err.stack,
          query: req.query,
          userEmail: req.user.email,
        });
        if (err.name === "BSONError") {
          return res.status(400).json({ message: "Invalid meal ID format in database" });
        }
        res.status(500).json({ message: "Server error" });
      }
    });

    app.get("/meals/:id", async (req, res) => {
      try {
        const mealId = req.params.id;
        console.log(`Fetching meal with ID: ${mealId}`);
        if (!ObjectId.isValid(mealId)) {
          console.log(`Invalid meal ID: ${mealId}`);
          return res.status(400).json({ message: "Invalid meal ID format" });
        }
        const meal = await mealsCollection.findOne({
          _id: new ObjectId(mealId),
        });
        if (!meal) {
          console.log(`Meal not found: ${mealId}`);
          return res.status(404).json({ message: "Meal not found" });
        }
        const reviewsCount = await reviewsCollection.countDocuments({
          mealId: meal._id.toString(),
        });
        res.json({ ...meal, reviews_count: reviewsCount });
      } catch (err) {
        console.error("Error fetching meal:", {
          error: err.message,
          stack: err.stack,
          mealId: req.params.id,
        });
        if (err.name === "BSONError") {
          return res.status(400).json({ message: "Invalid meal ID format" });
        }
        res.status(500).json({ message: "Server error" });
      }
    });

    app.patch("/meals/like/:id", verifyJWT, async (req, res) => {
      try {
        const userEmail = req.user.email;
        const mealId = req.params.id;

        console.log(`Processing like for mealId: ${mealId}, userEmail: ${userEmail}`);
        if (!ObjectId.isValid(mealId)) {
          console.log(`Invalid meal ID: ${mealId}`);
          return res.status(400).json({ message: "Invalid meal ID format" });
        }

        const meal = await mealsCollection.findOne({
          _id: new ObjectId(mealId),
        });
        if (!meal) return res.status(404).json({ message: "Meal not found" });

        const likedBy = Array.isArray(meal.likedBy) ? meal.likedBy : [];
        const alreadyLiked = likedBy.includes(userEmail);

        const update = alreadyLiked
          ? { $pull: { likedBy: userEmail } }
          : { $addToSet: { likedBy: userEmail } };

        const result = await mealsCollection.updateOne(
          { _id: new ObjectId(mealId) },
          update
        );

        console.log(`Like ${alreadyLiked ? "removed" : "added"} for mealId: ${mealId}, result:`, result);

        res.json({ success: true, modifiedCount: result.modifiedCount });
      } catch (err) {
        console.error("Error liking meal:", {
          error: err.message,
          mealId: req.params.id,
          userEmail: req.user.email,
        });
        if (err.name === "BSONError") {
          return res.status(400).json({ message: "Invalid meal ID format" });
        }
        res.status(500).json({ message: "Server error" });
      }
    });

    app.get("/my-likes", verifyJWT, async (req, res) => {
      try {
        const userEmail = req.query.email.toLowerCase();
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        if (userEmail !== req.user.email) {
          console.log(`Forbidden access: query email ${userEmail} does not match token email ${req.user.email}`);
          return res.status(403).json({ message: "Forbidden" });
        }

        const likedMeals = await mealsCollection
          .find({ likedBy: userEmail }, { collation: { locale: "en", strength: 2 } })
          .skip(skip)
          .limit(limit)
          .toArray();
        const total = await mealsCollection.countDocuments(
          { likedBy: userEmail },
          { collation: { locale: "en", strength: 2 } }
        );

        res.json({
          meals: likedMeals,
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        });
      } catch (err) {
        console.error("Error fetching liked meals:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Admin Meals Endpoint with Sorting
    app.get("/admin/meals", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const { sortBy, sortOrder, page = 1, limit = 10 } = req.query;
        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 10;
        const skip = (pageNum - 1) * limitNum;

        const validSortFields = ["likes", "reviews_count"];
        const sortField = validSortFields.includes(sortBy) ? sortBy : "title";
        const sortDirection = sortOrder === "desc" ? -1 : 1;

        console.log(`Fetching admin meals with params:`, { sortBy: sortField, sortOrder, page: pageNum, limit: limitNum });

        const meals = await mealsCollection
          .aggregate([
            {
              $addFields: {
                likes: { $size: { $ifNull: ["$likedBy", []] } },
                reviews_count: { $ifNull: ["$reviews_count", 0] },
              },
            },
            {
              $sort: {
                [sortField]: sortDirection,
                title: 1,
              },
            },
            { $skip: skip },
            { $limit: limitNum },
            {
              $project: {
                _id: 1,
                title: 1,
                likes: 1,
                reviews_count: 1,
                rating: { $ifNull: ["$rating", 0] },
                distributorName: { $ifNull: ["$distributorName", "Unknown"] },
              },
            },
          ])
          .toArray();

        const total = await mealsCollection.countDocuments();

        console.log(`Fetched ${meals.length} meals, total: ${total}`);
        res.json({
          meals,
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        });
      } catch (err) {
        console.error("Error fetching admin meals:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    app.delete("/meals/:id", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const mealId = req.params.id;
        console.log(`🛰️ [DELETE] /meals/${mealId}`);
        if (!ObjectId.isValid(mealId)) {
          console.log(`Invalid meal ID: ${mealId}`);
          return res.status(400).json({ message: "Invalid meal ID format" });
        }
        const result = await mealsCollection.deleteOne({
          _id: new ObjectId(mealId),
        });
        if (result.deletedCount === 0) {
          console.log(`Meal not found: ${mealId}`);
          return res.status(404).json({ message: "Meal not found" });
        }
        await reviewsCollection.deleteMany({ mealId });
        await ordersCollection.deleteMany({ mealId });
        console.log(`Meal deleted: ${mealId}`);
        res.json({ success: true, deletedCount: result.deletedCount });
      } catch (err) {
        console.error("Error deleting meal:", {
          error: err.message,
          mealId: req.params.id,
        });
        if (err.name === "BSONError") {
          return res.status(400).json({ message: "Invalid meal ID format" });
        }
        res.status(500).json({ message: "Server error" });
      }
    });

    app.patch("/meals/:id", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const mealId = req.params.id;
        const updates = req.body;
        console.log(`🛰️ [PATCH] /meals/${mealId}`, updates);
        if (!ObjectId.isValid(mealId)) {
          console.log(`Invalid meal ID: ${mealId}`);
          return res.status(400).json({ message: "Invalid meal ID format" });
        }
        const meal = await mealsCollection.findOne({
          _id: new ObjectId(mealId),
        });
        if (!meal) {
          console.log(`Meal not found: ${mealId}`);
          return res.status(404).json({ message: "Meal not found" });
        }
        const allowedFields = ["title", "category", "price", "description", "ingredients", "distributorName", "photoUrl"];
        const updateFields = {};
        allowedFields.forEach((field) => {
          if (updates[field] !== undefined) {
            if (field === "price") {
              updateFields[field] = Number(updates[field]);
            } else if (field === "photoUrl" && updates[field] && !isValidUrl(updates[field])) {
              throw new Error("Invalid photoUrl");
            } else {
              updateFields[field] = updates[field];
            }
          }
        });
        if (Object.keys(updateFields).length === 0) {
          return res.status(400).json({ message: "No valid fields to update" });
        }
        const result = await mealsCollection.updateOne(
          { _id: new ObjectId(mealId) },
          { $set: updateFields }
        );
        console.log(`Meal updated: ${mealId}, result:`, result);
        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Meal not found" });
        }
        res.json({ success: true, modifiedCount: result.modifiedCount });
      } catch (err) {
        console.error("Error updating meal:", {
          error: err.message,
          mealId: req.params.id,
        });
        if (err.message === "Invalid photoUrl") {
          return res.status(400).json({ message: "Invalid photoUrl" });
        }
        if (err.name === "BSONError") {
          return res.status(400).json({ message: "Invalid meal ID format" });
        }
        res.status(500).json({ message: "Server error" });
      }
    });

    // Meal Requests
    app.post("/meal-request", verifyJWT, restrictDuplicateRequest, async (req, res) => {
      try {
        const { mealId } = req.body;
        const userEmail = req.user.email;
        console.log(`🛰️ [POST] /meal-request`, { mealId, userEmail, mealIdType: typeof mealId });

        if (!mealId || !userEmail) {
          console.log(`Missing required fields: mealId=${mealId}, userEmail=${userEmail}`);
          return res.status(400).json({ success: false, message: "mealId and userEmail are required" });
        }

        if (typeof mealId !== "string" || !ObjectId.isValid(mealId) || !/^[0-9a-fA-F]{24}$/.test(mealId)) {
          console.log(`Invalid meal ID format: ${mealId} (type: ${typeof mealId})`);
          return res.status(400).json({ success: false, message: "Invalid meal ID format" });
        }

        const mealExists = await mealsCollection.findOne({
          _id: new ObjectId(mealId),
          postTime: { $lte: new Date() },
        });
        if (!mealExists) {
          console.log(`Meal not found or not available: ${mealId}`);
          return res.status(404).json({ success: false, message: "Meal not found or not available" });
        }

        const newRequest = {
          mealId,
          userEmail,
          status: "pending",
          requestedAt: new Date(),
          price: mealExists.price,
        };

        const result = await ordersCollection.insertOne(newRequest);
        console.log(`Meal request created: ${result.insertedId} for user: ${userEmail}, mealId: ${mealId}`);
        res.status(201).json({ success: true, insertedId: result.insertedId });
      } catch (err) {
        console.error("Error requesting meal:", {
          error: err.message,
          mealId: req.body.mealId,
          userEmail: req.user.email,
        });
        if (err.name === "BSONError") {
          return res.status(400).json({ success: false, message: "Invalid meal ID format" });
        }
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    app.get("/requested-meals", verifyJWT, async (req, res) => {
      try {
        const userEmail = req.query.email?.toLowerCase();
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        if (!userEmail || userEmail !== req.user.email) {
          console.log(`Forbidden access: query email ${userEmail} does not match token email ${req.user.email}`);
          return res.status(403).json({ success: false, message: `Forbidden: Email mismatch (query: ${userEmail}, token: ${req.user.email})` });
        }

        const requests = await ordersCollection
          .find({ userEmail }, { collation: { locale: "en", strength: 2 } })
          .skip(skip)
          .limit(limit)
          .toArray();
        const total = await ordersCollection.countDocuments(
          { userEmail },
          { collation: { locale: "en", strength: 2 } }
        );

        const detailedRequests = await Promise.all(
          requests.map(async (reqItem) => {
            let meal = null;
            try {
              if (ObjectId.isValid(reqItem.mealId)) {
                meal = await mealsCollection.findOne({
                  _id: new ObjectId(reqItem.mealId),
                });
              } else {
                console.warn(`Invalid mealId in order ${reqItem._id}: ${reqItem.mealId}`);
              }
            } catch (err) {
              console.error(`Error fetching meal for request ${reqItem._id}:`, err.message);
            }
            return {
              ...reqItem,
              mealTitle: meal?.title || "Unknown Meal",
              mealDescription: meal?.description || "",
              mealPhotoUrl: meal?.photoUrl || "",
            };
          })
        );

        console.log(`Fetched ${detailedRequests.length} requested meals for ${userEmail}, total: ${total}`);
        res.json({
          meals: detailedRequests,
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        });
      } catch (err) {
        console.error("Error fetching requested meals:", {
          error: err.message,
          userEmail: req.query.email,
        });
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    app.delete("/requested-meals/:id", verifyJWT, async (req, res) => {
      try {
        const requestId = req.params.id;
        const userEmail = req.user.email;

        console.log(`🛰️ [DELETE] /requested-meals/${requestId} for user ${userEmail}`);

        if (!ObjectId.isValid(requestId)) {
          console.log(`Invalid request ID: ${requestId}`);
          return res.status(400).json({ success: false, message: "Invalid request ID" });
        }

        const request = await ordersCollection.findOne({
          _id: new ObjectId(requestId),
        });
        if (!request) {
          console.log(`Request not found: ${requestId}`);
          return res.status(404).json({ success: false, message: "Request not found" });
        }

        if (request.userEmail.toLowerCase() !== userEmail) {
          console.log(`Forbidden: request userEmail ${request.userEmail} does not match token email ${userEmail}`);
          return res.status(403).json({ success: false, message: `Forbidden: You can only delete your own requests (request email: ${request.userEmail})` });
        }

        const result = await ordersCollection.deleteOne({
          _id: new ObjectId(requestId),
        });
        console.log(`Delete result for request ${requestId}:`, result);

        if (result.deletedCount === 0) {
          console.log(`No request deleted for ID: ${requestId}`);
          return res.status(404).json({ success: false, message: "Request not found or already deleted" });
        }

        res.json({ success: true, deletedCount: result.deletedCount });
      } catch (err) {
        console.error("Error deleting request:", {
          error: err.message,
          requestId: req.params.id,
          userEmail: req.user.email,
        });
        if (err.name === "BSONError") {
          return res.status(400).json({ success: false, message: "Invalid request ID" });
        }
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    // Serve Meal
    app.patch("/meals/serve/:id", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const orderId = req.params.id;
        console.log(`🛰️ [PATCH] /meals/serve/${orderId}`);

        if (!ObjectId.isValid(orderId)) {
          console.log(`Invalid order ID: ${orderId}`);
          return res.status(400).json({ success: false, message: "Invalid order ID" });
        }

        const order = await ordersCollection.findOne({
          _id: new ObjectId(orderId),
        });
        if (!order) {
          console.log(`Order not found: ${orderId}`);
          return res.status(404).json({ success: false, message: "Order not found" });
        }

        if (!["pending", "paid"].includes(order.status)) {
          console.log(`Order cannot be served: current status is ${order.status}`);
          return res.status(400).json({ success: false, message: `Order cannot be served: current status is ${order.status}` });
        }

        if (!ObjectId.isValid(order.mealId)) {
          console.log(`Invalid meal ID in order ${orderId}: ${order.mealId}`);
          await ordersCollection.deleteOne({ _id: new ObjectId(orderId) });
          console.log(`Deleted order ${orderId} due to invalid mealId`);
          return res.status(400).json({ success: false, message: "Order removed due to invalid meal ID" });
        }

        const meal = await mealsCollection.findOne({
          _id: new ObjectId(order.mealId),
        });
        if (!meal) {
          console.log(`Meal not found for order ${orderId}, mealId: ${order.mealId}`);
          await ordersCollection.deleteOne({ _id: new ObjectId(orderId) });
          console.log(`Deleted order ${orderId} due to non-existent mealId`);
          return res.status(400).json({ success: false, message: "Order removed due to non-existent meal" });
        }

        const result = await ordersCollection.updateOne(
          { _id: new ObjectId(orderId) },
          { $set: { status: "delivered", servedAt: new Date() } }
        );

        if (result.matchedCount === 0) {
          console.log(`No order matched for ID: ${orderId}`);
          return res.status(404).json({ success: false, message: "Order not found" });
        }

        console.log(`Order served: ${orderId}, modified: ${result.modifiedCount}`);
        res.json({ success: true, modifiedCount: result.modifiedCount });
      } catch (err) {
        console.error("Error serving meal:", {
          error: err.message,
          orderId: req.params.id,
        });
        if (err.name === "BSONError") {
          return res.status(400).json({ success: false, message: "Invalid order ID or meal ID" });
        }
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    // Admin Orders
    app.get("/admin/orders", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const orders = await ordersCollection.find().toArray();
        const detailedOrders = await Promise.all(
          orders.map(async (order) => {
            let meal = null;
            try {
              if (ObjectId.isValid(order.mealId)) {
                meal = await mealsCollection.findOne({
                  _id: new ObjectId(order.mealId),
                });
              } else {
                console.warn(`Invalid mealId in order ${order._id}: ${order.mealId}`);
              }
            } catch (err) {
              console.error(`Error fetching meal for order ${order._id}:`, err.message);
            }
            const user = await usersCollection.findOne(
              { email: order.userEmail },
              { collation: { locale: "en", strength: 2 } }
            );
            return {
              ...order,
              mealTitle: meal?.title || "Unknown Meal",
              userName: user?.name || "Unknown User",
              price: order.price || meal?.price || 0,
              transactionId: order.transactionId || "N/A",
            };
          })
        );
        console.log(`Fetched ${detailedOrders.length} orders`);
        res.json(detailedOrders);
      } catch (err) {
        console.error("Error fetching all orders:", err);
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    // Reviews
    app.get("/reviews", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        console.log(`🛰️ [GET] /reviews`);
        const reviews = await reviewsCollection.find().toArray();
        const detailedReviews = await Promise.all(
          reviews.map(async (review) => {
            let meal = null;
            try {
              if (ObjectId.isValid(review.mealId)) {
                meal = await mealsCollection.findOne({
                  _id: new ObjectId(review.mealId),
                });
              } else {
                console.warn(`Invalid mealId in review ${review._id}: ${review.mealId}`);
              }
            } catch (err) {
              console.error(`Error fetching meal for review ${review._id}:`, err.message);
            }
            return {
              ...review,
              mealTitle: meal?.title || "Unknown Meal",
              userEmail: review.userEmail || "Unknown User",
              likes: review.likes || 0,
            };
          })
        );
        console.log(`Reviews found: ${detailedReviews.length}`);
        res.json(detailedReviews);
      } catch (err) {
        console.error("Error fetching reviews:", err);
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    app.post("/reviews", verifyJWT, restrictDuplicateReview, async (req, res) => {
      try {
        const { mealId, userEmail, rating, comment } = req.body;
        console.log(`🛰️ [POST] /reviews`, { mealId, userEmail, rating, comment });
        if (!mealId || !userEmail || !rating || !comment) {
          return res.status(400).json({ success: false, message: "mealId, userEmail, rating, and comment are required" });
        }
        if (rating < 1 || rating > 5) {
          return res.status(400).json({ success: false, message: "Rating must be between 1 and 5" });
        }

        if (!ObjectId.isValid(mealId)) {
          console.log(`Invalid meal ID: ${mealId}`);
          return res.status(400).json({ success: false, message: "Invalid meal ID format" });
        }

        const mealExists = await mealsCollection.findOne({
          _id: new ObjectId(mealId),
        });
        if (!mealExists) {
          console.log(`Meal not found: ${mealId}`);
          return res.status(404).json({ success: false, message: "Meal not found" });
        }

        const review = {
          mealId,
          userEmail: userEmail.toLowerCase(),
          rating: Number(rating),
          comment,
          createdAt: new Date(),
          likes: 0,
        };

        const result = await reviewsCollection.insertOne(review);

        const reviews = await reviewsCollection
          .aggregate([
            { $match: { mealId } },
            { $group: { _id: null, avgRating: { $avg: "$rating" }, count: { $sum: 1 } } },
          ])
          .toArray();
        const avgRating = reviews[0]?.avgRating || 0;
        const reviewsCount = reviews[0]?.count || 0;
        await mealsCollection.updateOne(
          { _id: new ObjectId(mealId) },
          { $set: { reviews_count: reviewsCount, rating: avgRating } }
        );

        console.log(`Review inserted: ${result.insertedId}, updated meal: ${mealId}`);
        res.status(201).json({ success: true, insertedId: result.insertedId });
      } catch (err) {
        console.error("Error creating review:", {
          error: err.message,
          mealId: req.body.mealId,
          userEmail: req.body.userEmail,
        });
        if (err.name === "BSONError") {
          return res.status(400).json({ success: false, message: "Invalid meal ID format" });
        }
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    app.get("/reviews/meal/:mealId", async (req, res) => {
      try {
        const { mealId } = req.params;
        console.log(`🛰️ [GET] /reviews/meal/${mealId}`);
        if (!ObjectId.isValid(mealId)) {
          console.log(`Invalid meal ID: ${mealId}`);
          return res.status(400).json({ success: false, message: "Invalid meal ID format" });
        }
        const mealExists = await mealsCollection.findOne({
          _id: new ObjectId(mealId),
        });
        if (!mealExists) {
          console.log(`Meal not found: ${mealId}`);
          return res.status(404).json({ success: false, message: "Meal not found" });
        }
        const reviews = await reviewsCollection.find({ mealId }).toArray();
        console.log(`Reviews found: ${reviews.length}`);
        res.json(reviews);
      } catch (err) {
        console.error("Error fetching reviews:", {
          error: err.message,
          mealId: req.params.mealId,
        });
        if (err.name === "BSONError") {
          return res.status(400).json({ success: false, message: "Invalid meal ID format" });
        }
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    app.delete("/reviews/:id", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        console.log(`🛰️ [DELETE] /reviews/${req.params.id}`);
        if (!ObjectId.isValid(req.params.id)) {
          console.log(`Invalid review ID: ${req.params.id}`);
          return res.status(400).json({ success: false, message: "Invalid review ID" });
        }
        const result = await reviewsCollection.deleteOne({
          _id: new ObjectId(req.params.id),
        });
        if (result.deletedCount === 0) {
          console.log(`Review not found: ${req.params.id}`);
          return res.status(404).json({ success: false, message: "Review not found" });
        }
        console.log(`Review deleted: ${req.params.id}`);
        res.json({ success: true, deletedCount: result.deletedCount });
      } catch (err) {
        console.error("Error deleting review:", {
          error: err.message,
          reviewId: req.params.id,
        });
        if (err.name === "BSONError") {
          return res.status(400).json({ success: false, message: "Invalid review ID" });
        }
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    // Profile
    app.get("/my-profile", verifyJWT, async (req, res) => {
      try {
        const user = await usersCollection.findOne(
          { email: req.user.email },
          { collation: { locale: "en", strength: 2 } }
        );
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        res.json(user);
      } catch (err) {
        console.error("Error fetching profile:", err);
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    // Upcoming Meals
    app.post("/upcoming-meals", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const meal = req.body;
        const requiredFields = ["title", "description", "photoUrl", "postTime"];
        const missingFields = requiredFields.filter((field) => !meal[field]);
        if (missingFields.length > 0) {
          return res.status(400).json({ message: `Missing required fields: ${missingFields.join(", ")}` });
        }
        if (meal.photoUrl && !isValidUrl(meal.photoUrl)) {
          return res.status(400).json({ message: "Invalid photoUrl" });
        }
        meal.postTime = new Date(meal.postTime);
        meal.likedBy = [];
        const result = await upcomingMealsCollection.insertOne(meal);
        console.log(`Upcoming meal created: ${meal.title}, ID: ${result.insertedId}`);
        res.status(201).json({ success: true, insertedId: result.insertedId });
      } catch (err) {
        console.error("Error adding upcoming meal:", err);
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    app.get("/upcoming-meals", async (req, res) => {
      try {
        const meals = await upcomingMealsCollection
          .find({ postTime: { $gt: new Date() } })
          .toArray();
        console.log(`Fetched ${meals.length} upcoming meals`);
        res.json(meals);
      } catch (err) {
        console.error("Error fetching upcoming meals:", err);
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    app.patch("/upcoming-meals/like/:id", verifyJWT, async (req, res) => {
      try {
        const { userEmail } = req.body;
        const mealId = req.params.id;

        if (!userEmail || userEmail.toLowerCase() !== req.user.email) {
          return res.status(403).json({ message: "Forbidden: Email mismatch" });
        }

        if (!ObjectId.isValid(mealId)) {
          console.log(`Invalid meal ID: ${mealId}`);
          return res.status(400).json({ message: "Invalid meal ID format" });
        }

        const user = await usersCollection.findOne(
          { email: userEmail.toLowerCase() },
          { collation: { locale: "en", strength: 2 } }
        );
        if (!user || !["Silver", "Gold", "Platinum"].includes(user.badge)) {
          return res.status(403).json({ message: "Only premium users can like upcoming meals" });
        }

        const meal = await upcomingMealsCollection.findOne({
          _id: new ObjectId(mealId),
        });
        if (!meal) {
          return res.status(404).json({ message: "Meal not found" });
        }

        const likedBy = Array.isArray(meal.likedBy) ? meal.likedBy : [];
        const alreadyLiked = likedBy.includes(userEmail);

        if (alreadyLiked) {
          return res.status(400).json({ message: "You have already liked this meal" });
        }

        const result = await upcomingMealsCollection.updateOne(
          { _id: new ObjectId(mealId) },
          { $addToSet: { likedBy: userEmail } }
        );

        console.log(`Like added for upcoming meal ${mealId} by ${userEmail}`);
        res.json({ success: true, modifiedCount: result.modifiedCount });
      } catch (err) {
        console.error("Error liking upcoming meal:", {
          error: err.message,
          mealId: req.params.id,
          userEmail: req.body.userEmail,
        });
        if (err.name === "BSONError") {
          return res.status(400).json({ message: "Invalid meal ID format" });
        }
        res.status(500).json({ message: "Server error" });
      }
    });

    // Packages
    app.get("/packages", async (req, res) => {
      try {
        const packages = Object.values(packageDetails);
        res.json(packages);
      } catch (err) {
        console.error("Error fetching packages:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Payments
    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      try {
        const { amount, email } = req.body;
        console.log("Received /create-payment-intent:", { amount, email });
        if (!amount || !email || email.toLowerCase() !== req.user.email) {
          return res.status(400).json({ message: "Invalid amount or email" });
        }
        const amountInCents = parseInt(amount);
        if (amountInCents < 100) {
          return res.status(400).json({ message: "Amount must be at least $1.00" });
        }
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents,
          currency: "usd",
          payment_method_types: ["card"],
          metadata: { email },
        });
        console.log(`Payment intent created for ${email}: ${paymentIntent.id}`);
        res.json({ success: true, clientSecret: paymentIntent.client_secret });
      } catch (err) {
        console.error("Error creating payment intent:", err);
        res.status(500).json({ message: "Payment processing error", error: err.message });
      }
    });

    app.post("/confirm-payment", verifyJWT, async (req, res) => {
      try {
        const { packageName, transactionId, userEmail } = req.body;
        console.log("Received /confirm-payment:", { packageName, transactionId, userEmail, tokenEmail: req.user.email });
        if (!packageName || !transactionId || !userEmail || userEmail.toLowerCase() !== req.user.email) {
          return res.status(400).json({ message: "Invalid payment details", details: { packageName, transactionId, userEmail, tokenEmail: req.user.email } });
        }
        if (!packageDetails[packageName.toLowerCase()]) {
          return res.status(400).json({ message: "Invalid package name", received: packageName });
        }
        const user = await usersCollection.findOne(
          { email: userEmail.toLowerCase() },
          { collation: { locale: "en", strength: 2 } }
        );
        if (!user) {
          console.log(`User not found: ${userEmail}`);
          return res.status(404).json({ message: "User not found" });
        }
        const payment = {
          userEmail: userEmail.toLowerCase(),
          packageName,
          transactionId,
          amount: packageDetails[packageName.toLowerCase()].price,
          date: new Date(),
        };
        const result = await paymentsCollection.insertOne(payment);
        const userUpdate = await usersCollection.updateOne(
          { email: userEmail.toLowerCase() },
          { $set: { badge: packageName } }
        );
        console.log(`Payment recorded: ${result.insertedId}, badge updated for ${userEmail}: ${packageName}, userUpdate:`, userUpdate);
        res.json({ success: true, insertedId: result.insertedId });
      } catch (err) {
        console.error("Error confirming payment:", {
          message: err.message,
          stack: err.stack,
          requestBody: req.body,
          tokenEmail: req.user.email
        });
        res.status(500).json({ message: "Server error", error: err.message });
      }
    });

    // Payments Endpoint
    app.get("/payments", verifyJWT, async (req, res) => {
      try {
        const userEmail = req.query.email?.toLowerCase();
        console.log(`�Satellite [GET] /payments?email=${userEmail}`, {
          queryEmail: userEmail,
          tokenEmail: req.user.email,
          headers: req.headers.authorization ? "Authorization header present" : "No Authorization header",
        });

        if (!userEmail || userEmail !== req.user.email) {
          console.log(`Forbidden access: query email ${userEmail} does not match token email ${req.user.email}`);
          return res.status(403).json({ message: "Forbidden: Email mismatch" });
        }

        if (!paymentsCollection) {
          console.error("paymentsCollection is not initialized");
          return res.status(500).json({ message: "Server error: Database collection not initialized" });
        }

        const payments = await paymentsCollection
          .find({ userEmail }, { collation: { locale: "en", strength: 2 } })
          .sort({ date: -1 })
          .toArray();

        const total = await paymentsCollection.countDocuments(
          { userEmail },
          { collation: { locale: "en", strength: 2 } }
        );

        console.log(`Fetched ${payments.length} payments for ${userEmail}, total: ${total}`, {
          paymentIds: payments.map(p => p._id.toString()),
        });
        res.json({
          payments,
          total,
          page: 1,
          limit: payments.length,
          totalPages: 1,
        });
      } catch (err) {
        console.error("Error fetching payments:", {
          error: err.message,
          stack: err.stack,
          userEmail: req.query.email,
        });
        res.status(500).json({ message: "Server error", error: err.message });
      }
    });

    // My Reviews Endpoint
    app.get("/my-reviews", verifyJWT, async (req, res) => {
      try {
        const userEmail = req.query.email?.toLowerCase();
        console.log(`🛰️ [GET] /my-reviews?email=${userEmail}`, {
          queryEmail: userEmail,
          tokenEmail: req.user.email,
          headers: req.headers.authorization ? "Authorization header present" : "No Authorization header",
        });

        if (!userEmail || userEmail !== req.user.email) {
          console.log(`Forbidden access: query email ${userEmail} does not match token email ${req.user.email}`);
          return res.status(403).json({ message: "Forbidden: Email mismatch" });
        }

        if (!reviewsCollection) {
          console.error("reviewsCollection is not initialized");
          return res.status(500).json({ message: "Server error: Database collection not initialized" });
        }

        const reviews = await reviewsCollection
          .find({ userEmail }, { collation: { locale: "en", strength: 2 } })
          .sort({ createdAt: -1 })
          .toArray();

        const detailedReviews = await Promise.all(
          reviews.map(async (review) => {
            let meal = null;
            try {
              if (ObjectId.isValid(review.mealId)) {
                meal = await mealsCollection.findOne({ _id: new ObjectId(review.mealId) });
              } else {
                console.warn(`Invalid mealId in review ${review._id}: ${review.mealId}`);
              }
            } catch (err) {
              console.error(`Error fetching meal for review ${review._id}:`, err.message);
            }
            return {
              ...review,
              mealTitle: meal?.title || "Unknown Meal",
            };
          })
        );

        const total = await reviewsCollection.countDocuments(
          { userEmail },
          { collation: { locale: "en", strength: 2 } }
        );

        console.log(`Fetched ${detailedReviews.length} reviews for ${userEmail}, total: ${total}`, {
          reviewIds: detailedReviews.map(r => r._id.toString()),
        });

        res.json({
          reviews: detailedReviews,
          total,
          page: 1,
          limit: detailedReviews.length,
          totalPages: 1,
        });
      } catch (err) {
        console.error("Error fetching user reviews:", {
          error: err.message,
          stack: err.stack,
          userEmail: req.query.email,
        });
        res.status(500).json({ message: "Server error", error: err.message });
      }
    });

app.get("/", (req, res) => res.json("✅ HostelMate Server is Running"));

// Global error handler
app.use((err, req, res, next) => {
  console.error("Global error:", err);
  res.status(500).json({ message: "Server error", error: err.message });
});



const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ Server running on port ${port}`));