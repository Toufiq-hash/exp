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
    await connectToMongo();
    const { email, name, role, photoURL, googleAuth } = req.body;
    if (!email || !name) return res.status(400).json({ message: "Email and name required" });
    const exists = await usersCollection.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(409).json({ message: "User exists" });
    const result = await usersCollection.insertOne({
      name,
      email: email.toLowerCase(),
      photoURL: photoURL || null,
      role: role || "user",
      googleAuth: googleAuth || false,
      createdAt: new Date(),
    });
    res.status(201).json({ success: true, insertedId: result.insertedId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
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