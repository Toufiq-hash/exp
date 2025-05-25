const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");

const app = express();
app.use(cors());
app.use(express.json());

const uri = "mongodb+srv://as10:XAltanrBAK1rjCve@cluster0.s7iqsx5.mongodb.net/plantdb?retryWrites=true&w=majority&appName=Cluster0";

let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  const client = new MongoClient(uri, {
    ssl: true,
    tlsAllowInvalidCertificates: false,
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });

  await client.connect();
  const db = client.db("plantdb");

  cachedClient = client;
  cachedDb = db;

  return { client, db };
}

app.get("/api/plants", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const plants = await db.collection("myplant").find().toArray();
    res.send(plants);
  } catch (error) {
    console.error("❌ Error fetching plants:", error);
    res.status(500).send({ message: "Failed to fetch plants" });
  }
});

app.get("/", (req, res) => {
  res.send("🌱 Plant Care Tracker backend is running!");
});

module.exports = app;
