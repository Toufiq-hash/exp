const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");
const admin = require("firebase-admin");

const app = express();
app.use(cors());
app.use(express.json());

// === Firebase Admin Init with Inlined Service Account ===
admin.initializeApp({
  credential: admin.credential.cert({
    type: "service_account",
    project_id: "as10-46d29",
    private_key_id: "c4209cd6400bad8d8f165692df8d00e15c6e18e4",
    private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkq...your_full_key...\n-----END PRIVATE KEY-----\n",
    client_email: "firebase-adminsdk-fbsvc@as10-46d29.iam.gserviceaccount.com",
    client_id: "113668680542680694175",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40as10-46d29.iam.gserviceaccount.com",
    universe_domain: "googleapis.com"
  }),
});

// === Firebase Token Middleware ===
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).send({ message: "Unauthorized: No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).send({ message: "Forbidden: Invalid token" });
  }
};

// === MongoDB Setup ===
const uri = "mongodb+srv://as10:XAltanrBAK1rjCve@cluster0.s7iqsx5.mongodb.net/product?retryWrites=true&w=majority&appName=Cluster0";
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  const client = new MongoClient(uri, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
  });

  await client.connect();
  const db = client.db("product");
  cachedClient = client;
  cachedDb = db;
  return { client, db };
}

// === Routes ===
app.get("/", (req, res) => {
  res.send("Product Recommendation backend is running!");
});

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

// GET queries by user email
app.get("/queries/user/:email", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const email = req.params.email;
    const userQueries = await db.collection("myproduct").find({ type: "query", userEmail: email }).toArray();
    res.send(userQueries);
  } catch {
    res.status(500).send({ message: "Failed to fetch queries by user" });
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
  } catch {
    res.status(500).send({ message: "Failed to fetch query by ID" });
  }
});

// POST new query (Protected by JWT)
app.post("/queries", verifyToken, async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const newQuery = req.body;
    newQuery.type = "query";
    newQuery.userEmail = req.user.email;
    newQuery.recommendationsCount = 0;
    const result = await db.collection("myproduct").insertOne(newQuery);
    res.status(201).send(result);
  } catch {
    res.status(500).send({ message: "Failed to add query" });
  }
});

// PUT update query by ID
app.put("/queries/:id", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const updatedData = req.body;
    const result = await db.collection("myproduct").updateOne(
      { _id: new ObjectId(req.params.id), type: "query" },
      { $set: updatedData }
    );
    res.send(result);
  } catch {
    res.status(500).send({ message: "Failed to update query" });
  }
});

// DELETE query by ID
app.delete("/queries/:id", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const result = await db.collection("myproduct").deleteOne({ _id: new ObjectId(req.params.id), type: "query" });
    res.send(result);
  } catch {
    res.status(500).send({ message: "Failed to delete query" });
  }
});

// POST add recommendation
app.post("/recommendations", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const newRec = req.body;
    newRec.type = "recommendation";

    const result = await db.collection("myproduct").insertOne(newRec);
    await db.collection("myproduct").updateOne(
      { _id: new ObjectId(newRec.queryId), type: "query" },
      { $inc: { recommendationsCount: 1 } }
    );

    res.status(201).send(result);
  } catch {
    res.status(500).send({ message: "Failed to add recommendation" });
  }
});

// GET recommendations by query ID
app.get("/recommendations/query/:queryId", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const recs = await db.collection("myproduct").find({
      type: "recommendation",
      queryId: req.params.queryId,
    }).toArray();
    res.send(recs);
  } catch {
    res.status(500).send({ message: "Failed to fetch recommendations" });
  }
});

// GET user's recommendations
app.get("/my-recommendations/:email", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const recs = await db.collection("myproduct").find({
      type: "recommendation",
      recommenderEmail: req.params.email,
    }).toArray();
    res.send(recs);
  } catch {
    res.status(500).send({ message: "Failed to fetch user's recommendations" });
  }
});

// GET recommendations for user’s queries
app.get("/recommendations-for-me/:email", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const userQueries = await db.collection("myproduct").find({
      type: "query",
      userEmail: req.params.email,
    }).project({ _id: 1 }).toArray();

    const queryIds = userQueries.map(q => q._id.toString());

    const recs = await db.collection("myproduct").find({
      type: "recommendation",
      queryId: { $in: queryIds }
    }).toArray();

    res.send(recs);
  } catch {
    res.status(500).send({ message: "Failed to fetch recommendations for user" });
  }
});

// DELETE recommendation
app.delete("/recommendations/:id", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const recommendation = await db.collection("myproduct").findOne({
      _id: new ObjectId(req.params.id),
      type: "recommendation"
    });

    if (!recommendation) return res.status(404).send({ message: "Recommendation not found" });

    await db.collection("myproduct").deleteOne({ _id: new ObjectId(req.params.id) });

    await db.collection("myproduct").updateOne(
      { _id: new ObjectId(recommendation.queryId), type: "query" },
      { $inc: { recommendationsCount: -1 } }
    );

    res.send({ message: "Recommendation deleted and count updated" });
  } catch (err) {
    res.status(500).send({ message: "Failed to delete recommendation", error: err.message });
  }
});

// === Export for Vercel ===
module.exports = app;
