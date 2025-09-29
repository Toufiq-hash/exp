const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ObjectId } = require("mongodb");
const dotenv = require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET || "");
const serverless = require("serverless-http");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  console.log(`🛰️ [${req.method}] ${req.originalUrl}`);
  next();
});

// Environment variable validation
const requiredEnvVars = ["MONGODB_URI", "STRIPE_SECRET", "JWT_SECRET"];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Missing environment variable: ${envVar}`);
    throw new Error(`Missing environment variable: ${envVar}`);
  }
}

// MongoDB setup
const client = new MongoClient(process.env.MONGODB_URI, {
  connectTimeoutMS: 10000,
  serverSelectionTimeoutMS: 10000,
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
      // Create indexes for performance
      await usersCollection.createIndex({ email: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });
      await ordersCollection.createIndex({ mealId: 1, userEmail: 1 });
      await reviewsCollection.createIndex({ mealId: 1, userEmail: 1 });
    } catch (err) {
      console.error("❌ MongoDB connection error:", err.message);
      throw new Error("Failed to connect to MongoDB");
    }
  }
  return client;
}

// JWT Middleware
const verifyJWT = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      console.log("No Authorization header provided");
      return res.status(401).json({ message: "Unauthorized access: No token provided" });
    }
    const token = authHeader.split(" ")[1];
    if (!token) {
      console.log("Invalid token format");
      return res.status(401).json({ message: "Unauthorized access: Invalid token format" });
    }
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
        console.error("JWT verification failed:", err.message);
        return res.status(403).json({ message: "Forbidden access: Invalid or expired token" });
      }
      req.user = { email: decoded.email.toLowerCase() };
      next();
    });
  } catch (err) {
    console.error("Error in verifyJWT:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

// Admin Middleware
const verifyAdmin = async (req, res, next) => {
  try {
    await connectToMongo();
    const user = await usersCollection.findOne(
      { email: req.user.email },
      { collation: { locale: "en", strength: 2 } }
    );
    if (!user || user.role !== "admin") {
      console.log(`Admin access denied for ${req.user.email}`);
      return res.status(403).json({ message: "Admin access only" });
    }
    next();
  } catch (err) {
    console.error("Error in verifyAdmin:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

// Duplicate Review Middleware
const restrictDuplicateReview = async (req, res, next) => {
  try {
    await connectToMongo();
    const { mealId, userEmail } = req.body;
    if (!ObjectId.isValid(mealId)) {
      console.log(`Invalid meal ID: ${mealId}`);
      return res.status(400).json({ message: "Invalid meal ID format" });
    }
    const exists = await reviewsCollection.findOne(
      { mealId, userEmail: userEmail.toLowerCase() },
      { collation: { locale: "en", strength: 2 } }
    );
    if (exists) {
      console.log("Duplicate review detected:", { mealId, userEmail });
      return res.status(400).json({ message: "You have already submitted a review for this meal" });
    }
    next();
  } catch (err) {
    console.error("Error in restrictDuplicateReview:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

// Duplicate Request Middleware
const restrictDuplicateRequest = async (req, res, next) => {
  try {
    await connectToMongo();
    const { mealId } = req.body;
    const userEmail = req.user.email;
    if (!ObjectId.isValid(mealId)) {
      console.log(`Invalid meal ID: ${mealId}`);
      return res.status(400).json({ message: "Invalid meal ID format" });
    }
    const exists = await ordersCollection.findOne(
      { mealId, userEmail, status: { $in: ["pending", "paid"] } },
      { collation: { locale: "en", strength: 2 } }
    );
    if (exists) {
      console.log("Duplicate request detected:", { mealId, userEmail });
      return res.status(400).json({ message: "You have already requested this meal" });
    }
    next();
  } catch (err) {
    console.error("Error in restrictDuplicateRequest:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

// Utility
const isValidUrl = (url) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

// Routes

// JWT Generation
app.post("/jwt", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      console.log("Missing email in /jwt request");
      return res.status(400).json({ message: "Email required" });
    }
    const token = jwt.sign({ email: email.toLowerCase() }, process.env.JWT_SECRET, { expiresIn: "70d" });
    console.log(`JWT generated for ${email.toLowerCase()}`);
    res.json({ token });
  } catch (err) {
    console.error("Error in /jwt:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

// Login
app.post("/login", async (req, res) => {
  try {
    await connectToMongo();
    const { idToken, email } = req.body;
    if (!idToken || !email) {
      console.log(`Missing fields: idToken=${!!idToken}, email=${email}`);
      return res.status(400).json({ message: "ID token and email required" });
    }

    const normalizedEmail = email.toLowerCase();
    let user = await usersCollection.findOne(
      { email: normalizedEmail },
      { collation: { locale: "en", strength: 2 } }
    );
    if (!user) {
      const result = await usersCollection.insertOne({
        name: email.split("@")[0],
        email: normalizedEmail,
        photoURL: null,
        role: "user",
        googleAuth: false,
        createdAt: new Date(),
      });
      user = { email: normalizedEmail, _id: result.insertedId };
      console.log(`User created: ${normalizedEmail}, ID: ${result.insertedId}`);
    }

    const token = jwt.sign({ email: normalizedEmail }, process.env.JWT_SECRET, { expiresIn: "70d" });
    console.log(`Login successful for ${normalizedEmail}`);
    res.json({ token });
  } catch (err) {
    console.error("Error in /login:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

// Root Route
app.get("/", async (req, res) => {
  try {
    await connectToMongo();
    res.json("✅ HostelMate Server is Running");
  } catch (err) {
    console.error("Error in /:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("Global error:", err.message, err.stack);
  res.status(500).json({ message: "Server error", error: err.message });
});

// Vercel Serverless Export
module.exports = serverless(app);