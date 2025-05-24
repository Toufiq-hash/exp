const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;


app.use(cors());
app.use(express.json());


const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error("❌ MONGODB_URI is missing in .env file");
  process.exit(1);
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

async function run() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB");

    const db = client.db("plantdb");
    const plantsCollection = db.collection("myplant");

    
    app.get("/api/plants", async (req, res) => {
      try {
        const result = await plantsCollection.find().toArray();
        res.send(result);
      } catch (error) {
        console.error("❌ Error fetching plants:", error);
        res.status(500).send({ message: "Failed to fetch plants" });
      }
    });

    
    app.get("/api/plants/user/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const plants = await plantsCollection.find({ userEmail: email }).toArray();
        res.send(plants);
      } catch (error) {
        console.error("❌ Error fetching user's plants:", error);
        res.status(500).send({ message: "Failed to fetch user's plants" });
      }
    });

    
    app.get("/api/plants/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const plant = await plantsCollection.findOne({ _id: new ObjectId(id) });
        if (!plant) return res.status(404).send({ message: "Plant not found" });
        res.send(plant);
      } catch (error) {
        console.error("❌ Error fetching plant:", error);
        res.status(500).send({ message: "Failed to fetch plant" });
      }
    });

  
    app.post("/api/plants", async (req, res) => {
      try {
        const newPlant = req.body;
        const result = await plantsCollection.insertOne(newPlant);
        res.status(201).send(result);
      } catch (error) {
        console.error("❌ Error adding plant:", error);
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
        res.send({ message: "✅ Plant updated", result });
      } catch (error) {
        console.error("❌ Error updating plant:", error);
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
        res.send({ message: "🗑️ Plant deleted", result });
      } catch (error) {
        console.error("❌ Error deleting plant:", error);
        res.status(500).send({ message: "Failed to delete plant" });
      }
    });

  } catch (err) {
    console.error("❌ Failed to connect to MongoDB:", err);
  }
}
run().catch(console.dir);


app.get("/", (req, res) => {
  res.send("🌱 Plant Care Tracker backend is running!");
});

app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
});
