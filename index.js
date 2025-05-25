const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

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

client.connect().then(() => {
  console.log(" Connected to MongoDB");

  const db = client.db("plantdb");
  const plantsCollection = db.collection("myplant");

  app.get("/api/plants", (req, res) => {
    plantsCollection.find().toArray()
      .then(result => res.send(result))
      .catch(() => res.status(500).send({ message: "Failed to fetch plants" }));
  });

  app.get("/api/plants/user/:email", (req, res) => {
    const email = req.params.email;
    plantsCollection.find({ userEmail: email }).toArray()
      .then(plants => res.send(plants))
      .catch(() => res.status(500).send({ message: "Failed to fetch user's plants" }));
  });

  app.get("/api/plants/:id", (req, res) => {
    const id = req.params.id;
    plantsCollection.findOne({ _id: new ObjectId(id) })
      .then(plant => {
        if (!plant) return res.status(404).send({ message: "Plant not found" });
        res.send(plant);
      })
      .catch(() => res.status(500).send({ message: "Failed to fetch plant" }));
  });

  app.post("/api/plants", (req, res) => {
    const newPlant = req.body;
    plantsCollection.insertOne(newPlant)
      .then(result => res.status(201).send(result))
      .catch(() => res.status(500).send({ message: "Failed to add plant" }));
  });

  
  app.put("/api/plants/:id", (req, res) => {
    const id = req.params.id;
    const updatedPlant = req.body;
    plantsCollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedPlant })
      .then(result => {
        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Plant not found" });
        }
        res.send({ message: " Plant updated", result });
      })
      .catch(() => res.status(500).send({ message: "Failed to update plant" }));
  });

  app.delete("/api/plants/:id", (req, res) => {
    const id = req.params.id;
    plantsCollection.deleteOne({ _id: new ObjectId(id) })
      .then(result => {
        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Plant not found" });
        }
        res.send({ message: " Plant deleted", result });
      })
      .catch(() => res.status(500).send({ message: "Failed to delete plant" }));
  });

}).catch(err => {
  console.error(" Failed to connect to MongoDB:", err);
});

app.get("/", (req, res) => {
  res.send(" Plant Care Tracker backend is running!");
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(` Server is running on port ${port}`);
  });
}

module.exports = app;
