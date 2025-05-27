require("dotenv").config();
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
  } catch (err) {
    res.status(500).send({ message: "Failed to fetch plants" });
  }
});


app.get("/api/plants/:id", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const id = req.params.id;
    const plant = await db.collection("myplant").findOne({ _id: new ObjectId(id) });
    if (!plant) return res.status(404).send({ message: "Plant not found" });
    res.send(plant);
  } catch (err) {
    res.status(500).send({ message: "Failed to fetch plant by ID" });
  }
});


app.get("/api/plants/user/:email", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const email = req.params.email;
    const plants = await db.collection("myplant").find({ userEmail: email }).toArray();
    res.send(plants);
  } catch (err) {
    res.status(500).send({ message: "Failed to fetch user's plants" });
  }
});


app.post("/api/plants", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const newPlant = req.body;
    const result = await db.collection("myplant").insertOne(newPlant);
    res.status(201).send(result);
  } catch (err) {
    res.status(500).send({ message: "Failed to add plant" });
  }
});


app.put("/api/plants/:id", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const { id } = req.params;
    const updatedData = req.body;
    const result = await db.collection("myplant").updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedData }
    );
    res.send(result);
  } catch (err) {
    res.status(500).send({ message: "Failed to update plant" });
  }
});


app.delete("/api/plants/:id", async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const { id } = req.params;
    const result = await db.collection("myplant").deleteOne({ _id: new ObjectId(id) });
    res.send(result);
  } catch (err) {
    res.status(500).send({ message: "Failed to delete plant" });
  }
});


app.get("/", (req, res) => {
  res.send(" Plant Care Tracker backend is running!");
});

module.exports = app;
