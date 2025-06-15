require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");
const admin = require("firebase-admin");

// Paste your full Firebase service account JSON here:
const serviceAccount = {
  
  "type": "service_account",
  "project_id": "as10-46d29",
  "private_key_id": "c4209cd6400bad8d8f165692df8d00e15c6e18e4",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCoipvuwSSaQJg6\nE2brI9CRYdSAGGSPrmmUE3Y35kD12mq340WezdkAbTEg9HoQ+Nplzoclec+5V7aE\n4VA7QYDpIWxlmVjSy1XP4/wTzFCw+3uqD0ihURxWe3000gNpqQHOHTvdkd2r983H\nhSFgoKUvbxQA7lmHSgcV+8CbTXb0FEU6dzSeD/C+jVXkDtBKmivC40PAUAWGdcVU\nKZjCXhlC/Bsjg8uGrCbTYzMnrpi14lTou/2KecsKjaz4M7sBhpBSLrwidxCmCsw9\nMcEa7WIl5bbCeVviNjPGjQ7fKFHEVOdL5iuj75mGVGLMeBh/jHlQ+87zLEXgyxqh\n9BLJewxHAgMBAAECggEAJnlRxExp3x6MwYEpVtcbpvxmpoEq/5OofUl+DJ+ux5C/\nGNA0Vd6WwV6rvuKgNNyh+miNeFQYw64Ot8G5b3VyCIX9OSoq2R/arHTWV+ylpOkb\nn0QS5+RcrC9Pcy3X4phWlacdweQo7rdITdoJtwWk/7GDJv1CCbyv5mhMXQdvdqME\niCOzbtYKVyuwxVCLrULX4D3c6VUOlKVOwaik/qOypBxTXhH2KdZjpWMUK5DJGjCr\nXywJ5O8Bc6frLgrqTGHqYNh/d9pEyv/Qr1xQnl4cWbYBbeSDIBIVJxh0hsGB6CF2\n1iAY3KIyOyfoVoEb0yHz66vipyezzN3NRd6drhlFhQKBgQDoL/ER57bPxYPTGayh\nCle+02vUBACCkrIqa41l8ep5p2qoR5hm7MJ1sAClsPHCg9GvoGXdogHFyNM1q6Fm\njV4xXTSLQNAjRfYPNNaK+zFdWYp3lcbb45uwOHsm+wg8LA17RMK+B03Pgy+7mku+\nGPDzJifz7YfKHQryDtCHsJsjNQKBgQC506a3D9E5dMEhGYC0F7iw3hXjcRaFvOoS\n7k0utg2zgwwxA9GEG3thqHezozqYskl/j/5J/H3Dc2octdUwKclWI9KhvpGnpiSj\n/sPiW+MFbQeK2CqUytzaK+XrBNnWgpViMhcH6+R8AKAY40fSBCaDYD7BaeTgKqIV\nDk+a7i6FCwKBgQCeWAOZaGKd819hWcMG2FzawKhqoIgQhCaJE2wMuBxl9qygMqNW\nneRICk2GsdNOCkO3+DVAHroCvmB7255op8Qy+hNZXEwVoiKaYDhn88LInMX3o+dI\nEkMcvIgQH2aQUqKnDE+a9LQ17otg72r0K2I3EDBzA+x1A7VxOnUv9Fr4eQKBgCSf\nZdfmMiHUtMtFL2xO0INrAX1VqE6rMKaSeHugPYsHZLu0OPKESAizHwQ0QzQczwdo\n5YDHVjHS6TLHU0Cuu5NSdAyUdjhIMihv6UMPQOqs1jOy7pFseaI1zJZI2nXAPpif\nrpJNFzapGOROxrTJRJ3XtgaATC8xt8fWjjHGhzyJAoGBAIT6Fb0MYpo2TXksMqQV\nrorI5klj2gNC8xMroA/ttJ8ejDtF1h6B6GU++4avZDto7UZPK3WWzmbstnkNrBgJ\np0u4WdtO0WU+e7XU5/HByk29Ouxl1SNM6yuo8CEImFNOW8wt1DtI+xkszeycjibj\nCB/Lpg4of06le5UzkAlEGx+E\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-fbsvc@as10-46d29.iam.gserviceaccount.com",
  "client_id": "113668680542680694175",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40as10-46d29.iam.gserviceaccount.com",
  "universe_domain": "googleapis.com"
}


const app = express();
app.use(cors());
app.use(express.json());

// Initialize Firebase Admin with embedded service account
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Middleware to verify Firebase JWT
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

// GET queries by user email
app.get("/queries/user/:email", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const email = req.params.email;
    const userQueries = await db.collection("myproduct").find({
      type: "query",
      userEmail: email
    }).toArray();
    res.send(userQueries);
  } catch (err) {
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
  } catch (err) {
    res.status(500).send({ message: "Failed to fetch query by ID" });
  }
});

// POST new query (Protected by JWT)
app.post("/queries", verifyToken, async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const newQuery = req.body;
    newQuery.type = "query";
    newQuery.userEmail = req.user.email; // save user email from token
    newQuery.recommendationsCount = 0;
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

// POST add a recommendation and increment recommendationsCount
app.post("/recommendations", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const newRecommendation = req.body;
    newRecommendation.type = "recommendation";

    const result = await db.collection("myproduct").insertOne(newRecommendation);

    // Increment recommendationsCount on the related query
    await db.collection("myproduct").updateOne(
      { _id: new ObjectId(newRecommendation.queryId), type: "query" },
      { $inc: { recommendationsCount: 1 } }
    );

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

// GET all recommendations made by a user
app.get("/my-recommendations/:email", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const email = req.params.email;
    const recommendations = await db.collection("myproduct").find({
      type: "recommendation",
      recommenderEmail: email
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

    const userQueries = await db.collection("myproduct").find({
      type: "query",
      userEmail: email
    }).project({ _id: 1 }).toArray();

    const queryIds = userQueries.map(q => q._id.toString());

    const recommendations = await db.collection("myproduct").find({
      type: "recommendation",
      queryId: { $in: queryIds }
    }).toArray();

    res.send(recommendations);
  } catch (err) {
    res.status(500).send({ message: "Failed to fetch recommendations for user" });
  }
});

// DELETE recommendation and decrement recommendationsCount
app.delete("/recommendations/:id", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const { id } = req.params;

    const recommendation = await db.collection("myproduct").findOne({
      _id: new ObjectId(id),
      type: "recommendation"
    });

    if (!recommendation) return res.status(404).send({ message: "Recommendation not found" });

    await db.collection("myproduct").deleteOne({ _id: new ObjectId(id), type: "recommendation" });

    await db.collection("myproduct").updateOne(
      { _id: new ObjectId(recommendation.queryId), type: "query" },
      { $inc: { recommendationsCount: -1 } }
    );

    res.send({ message: "Recommendation deleted and count updated" });
  } catch (err) {
    res.status(500).send({ message: "Failed to delete recommendation", error: err.message });
  }
});

module.exports = app;
