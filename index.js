require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");

const app = express();
app.use(cors());
app.use(express.json());

const uri = "mongodb+srv://as10:XAltanrBAK1rjCve@cluster0.s7iqsx5.mongodb.net/product?retryWrites=true&w=majority&appName=Cluster0";

let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  const client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });

  await client.connect();
  const db = client.db("product");
  cachedClient = client;
  cachedDb = db;
  return { client, db };
}

// Root route
app.get("/", (req, res) => {
  res.send("Product Recommendation backend is running!");
});

// ====== Queries Routes ======

// GET all queries
app.get("/queries", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const queries = await db.collection("myproduct").find({ type: "query" }).toArray();
    res.send(queries);
  } catch (err) {
    res.status(500).send({ message: "Failed to fetch queries" });
  }
});

// GET query by ID
app.get("/queries/:id", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const id = req.params.id;
    const query = await db.collection("myproduct").findOne({ _id: new ObjectId(id), type: "query" });
    if (!query) return res.status(404).send({ message: "Query not found" });
    res.send(query);
  } catch (err) {
    res.status(500).send({ message: "Failed to fetch query by ID" });
  }
});

// POST new query
app.post("/queries", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const newQuery = req.body;
    newQuery.type = "query"; // Mark as query
    const result = await db.collection("myproduct").insertOne(newQuery);
    res.status(201).send(result);
  } catch (err) {
    res.status(500).send({ message: "Failed to add query" });
  }
});

// PUT update query by ID
app.put("/queries/:id", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const { id } = req.params;
    const updatedData = req.body;
    const result = await db.collection("myproduct").updateOne(
      { _id: new ObjectId(id), type: "query" },
      { $set: updatedData }
    );
    res.send(result);
  } catch (err) {
    res.status(500).send({ message: "Failed to update query" });
  }
});

// DELETE query by ID
app.delete("/queries/:id", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const { id } = req.params;
    const result = await db.collection("myproduct").deleteOne({ _id: new ObjectId(id), type: "query" });
    res.send(result);
  } catch (err) {
    res.status(500).send({ message: "Failed to delete query" });
  }
});

// ====== Recommendations Routes ======

// POST add a recommendation
app.post("/recommendations", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const newRecommendation = req.body;
    newRecommendation.type = "recommendation"; // Mark as recommendation
    const result = await db.collection("myproduct").insertOne(newRecommendation);
    res.status(201).send(result);
  } catch (err) {
    res.status(500).send({ message: "Failed to add recommendation" });
  }
});

// GET recommendations for a specific query ID
app.get("/recommendations/query/:queryId", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const queryId = req.params.queryId;
    const recommendations = await db.collection("myproduct").find({
      type: "recommendation",
      queryId: queryId
    }).toArray();
    res.send(recommendations);
  } catch (err) {
    res.status(500).send({ message: "Failed to fetch recommendations for query" });
  }
});

// GET all recommendations made by a user (filter by recommender's email)
app.get("/my-recommendations/:email", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const email = req.params.email;
    const recommendations = await db.collection("myproduct").find({
      type: "recommendation",
      recommenderEmail: email // assuming this field in doc
    }).toArray();
    res.send(recommendations);
  } catch (err) {
    res.status(500).send({ message: "Failed to fetch user's recommendations" });
  }
});

// GET recommendations received on the user's queries
app.get("/recommendations-for-me/:email", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const email = req.params.email;
    
    // Find query IDs of user's queries first
    const userQueries = await db.collection("myproduct").find({
      type: "query",
      userEmail: email  // assuming this field in query doc
    }).project({_id: 1}).toArray();

    const queryIds = userQueries.map(q => q._id.toString());

    // Then find recommendations for those queries
    const recommendations = await db.collection("myproduct").find({
      type: "recommendation",
      queryId: { $in: queryIds }
    }).toArray();

    res.send(recommendations);
  } catch (err) {
    res.status(500).send({ message: "Failed to fetch recommendations for user" });
  }
});

// DELETE recommendation by ID
app.delete("/recommendations/:id", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const { id } = req.params;
    const result = await db.collection("myproduct").deleteOne({ _id: new ObjectId(id), type: "recommendation" });
    res.send(result);
  } catch (err) {
    res.status(500).send({ message: "Failed to delete recommendation" });
  }
});

module.exports = app;
