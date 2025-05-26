const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
app.use(cors());
app.use(express.json());

const uri = "mongodb+srv://as10:XAltanrBAK1rjCve@cluster0.s7iqsx5.mongodb.net/plantdb?retryWrites=true&w=majority&appName=Cluster0";

const client = new MongoClient(uri, {
  ssl: true,
  tlsAllowInvalidCertificates: false,
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let plantsCollection;

async function connectAndSetup() {
  try {
    await client.connect();
    const db = client.db("plantdb");
    plantsCollection = db.collection("myplant");
    console.log("Connected to MongoDB");

    
    app.get("/api/plants", async (req, res) => {
      try {
        const result = await plantsCollection.find().toArray();
        res.send(result);
      } catch {
        res.status(500).send({ message: "Failed to fetch plants" });
      }
    });

    app.get("/api/plants/user/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const plants = await plantsCollection.find({ userEmail: email }).toArray();
        res.send(plants);
      } catch {
        res.status(500).send({ message: "Failed to fetch user's plants" });
      }
    });

    app.get("/api/plants/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const plant = await plantsCollection.findOne({ _id: new ObjectId(id) });
        if (!plant) return res.status(404).send({ message: "Plant not found" });
        res.send(plant);
      } catch {
        res.status(500).send({ message: "Failed to fetch plant" });
      }
    });

    app.post("/api/plants", async (req, res) => {
      try {
        const newPlant = req.body;
        const result = await plantsCollection.insertOne(newPlant);
        res.status(201).send(result);
      } catch  {
        res.status(500).send({ message: "Failed to add plant" });
      }
    });

    app.put("/api/plants/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const updatedPlant = req.body;
        const result = await plantsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedPlant }
        );
        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Plant not found" });
        }
        res.send({ message: " Plant updated", result });
      } catch  {
        res.status(500).send({ message: "Failed to update plant" });
      }
    });

    app.delete("/api/plants/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await plantsCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Plant not found" });
        }
        res.send({ message: " Plant deleted", result });
      } catch  {
        res.status(500).send({ message: "Failed to delete plant" });
      }
    });

  } catch {
    console.error(" MongoDB connection failed:", err);
  }
}

connectAndSetup();

app.get("/", (req, res) => {
  res.send(" Plant Care Tracker backend is running!");
});

module.exports = app;
