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

// Log requests for debugging
app.use((req, res, next) => {
  console.log(`🛰️ [${req.method}] ${req.originalUrl}`);
  next();
});

// MongoDB URI and Client
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is not defined");
  throw new Error("MONGODB_URI is not defined");
}

const client = new MongoClient(uri, {
  connectTimeoutMS: 10000, // 10s timeout
  serverSelectionTimeoutMS: 10000,
});

// Package details
const packageDetails = {
  silver: { name: "Silver", price: 999, description: "Access to premium meal features and upcoming meals." },
  gold: { name: "Gold", price: 1999, description: "Enhanced meal options and priority support." },
  platinum: { name: "Platinum", price: 2999, description: "Full access with exclusive perks." },
};

// Initialize collections globally (but connect on-demand)
let usersCollection,
  mealsCollection,
  reviewsCollection,
  upcomingMealsCollection,
  ordersCollection,
  paymentsCollection;

// Connect to MongoDB on-demand
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
      console.log("Collections initialized:", {
        users: !!usersCollection,
        meals: !!mealsCollection,
        reviews: !!reviewsCollection,
        upcomingMeals: !!upcomingMealsCollection,
        orders: !!ordersCollection,
        payments: !!paymentsCollection,
      });
    } catch (err) {
      console.error("❌ MongoDB connection error:", err);
      throw err;
    }
  }
  return client;
}

// Middleware for JWT verification
const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    console.log("No Authorization header provided");
    return res.status(401).json({ message: "Unauthorized access: No token provided" });
  }
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      console.error("JWT verification failed:", { message: err.message, token: token.slice(0, 10) + "..." });
      return res.status(403).json({ message: "Forbidden access: Invalid or expired token" });
    }
    console.log("JWT Decoded:", { email: decoded.email, iat: decoded.iat, exp: decoded.exp });
    req.user = { email: decoded.email.toLowerCase() };
    next();
  });
};

// Admin verification middleware
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
  } catch (error) {
    console.error("Error in verifyAdmin middleware:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Duplicate review restriction
const restrictDuplicateReview = async (req, res, next) => {
  try {
    await connectToMongo();
    const { mealId, userEmail } = req.body;
    console.log(`Checking duplicate review for mealId: ${mealId}, userEmail: ${userEmail}`);
    if (!ObjectId.isValid(mealId)) {
      console.log(`Invalid meal ID in review check: ${mealId}`);
      return res.status(400).json({ message: "Invalid meal ID format" });
    }
    const existingReview = await reviewsCollection.findOne(
      { mealId: mealId, userEmail: userEmail.toLowerCase() },
      { collation: { locale: "en", strength: 2 } }
    );
    if (existingReview) {
      console.log("Duplicate review found:", existingReview);
      return res.status(400).json({ message: "You have already submitted a review for this meal" });
    }
    next();
  } catch (error) {
    console.error("Error checking duplicate review:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Duplicate request restriction
const restrictDuplicateRequest = async (req, res, next) => {
  try {
    await connectToMongo();
    const { mealId } = req.body;
    const userEmail = req.user.email;
    console.log(`Checking duplicate request for mealId: ${mealId}, userEmail: ${userEmail}`);
    if (!ObjectId.isValid(mealId)) {
      console.log(`Invalid meal ID in request check: ${mealId}`);
      return res.status(400).json({ message: "Invalid meal ID format" });
    }
    const existingRequest = await ordersCollection.findOne(
      { mealId: mealId, userEmail, status: { $in: ["pending", "paid"] } },
      { collation: { locale: "en", strength: 2 } }
    );
    if (existingRequest) {
      console.log("Duplicate request found:", existingRequest);
      return res.status(400).json({ message: "You have already requested this meal" });
    }
    next();
  } catch (error) {
    console.error("Error checking duplicate request:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// URL validation
const isValidUrl = (url) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

// Routes (same as your original code, with connectToMongo added where needed)
app.post("/jwt", async (req, res) => {
  try {
    const user = req.body;
    if (!user?.email) return res.status(400).json({ message: "Email required" });
    const token = jwt.sign({ email: user.email.toLowerCase() }, process.env.JWT_SECRET, { expiresIn: "70d" });
    console.log(`JWT generated for ${user.email.toLowerCase()}`);
    res.json({ token });
  } catch (err) {
    console.error("Error in JWT generation:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Login
app.post("/login", async (req, res) => {
  try {
    await connectToMongo();
    const { idToken, email } = req.body;
    if (!idToken || !email) {
      console.log(`Missing required fields: idToken=${!!idToken}, email=${email}`);
      return res.status(400).json({ message: "Firebase ID token and email required" });
    }

    const normalizedEmail = email.toLowerCase();
    console.log(`Processing login for ${normalizedEmail}`);

    let user = await usersCollection.findOne(
      { email: normalizedEmail },
      { collation: { locale: "en", strength: 2 } }
    );
    if (!user) {
      user = {
        name: email.split("@")[0],
        email: normalizedEmail,
        photoURL: null,
        role: "user",
        googleAuth: false,
        createdAt: new Date(),
      };
      const result = await usersCollection.insertOne(user);
      console.log(`User created during login: ${normalizedEmail}, ID: ${result.insertedId}`);
    }

    const token = jwt.sign({ email: normalizedEmail }, process.env.JWT_SECRET, { expiresIn: "70d" });
    console.log(`Login successful for ${normalizedEmail}`);
    res.json({ token });
  } catch (err) {
    console.error("Error in login:", { message: err.message, stack: err.stack });
    res.status(500).json({ message: "Server error" });
  }
});

// Users
app.post("/users", async (req, res) => {
  try {
    await connectToMongo();
    const user = req.body;
    if (!user?.email || !user?.name) {
      console.log(`Missing required fields: email=${user?.email}, name=${user?.name}`);
      return res.status(400).json({ message: "Name and email are required" });
    }
    const exists = await usersCollection.findOne(
      { email: user.email.toLowerCase() },
      { collation: { locale: "en", strength: 2 } }
    );
    if (exists) {
      console.log(`User already exists: ${user.email.toLowerCase()}`);
      return res.status(409).json({ message: "User exists" });
    }
    const result = await usersCollection.insertOne({
      name: user.name,
      email: user.email.toLowerCase(),
      photoURL: user.photoURL || null,
      role: user.role || "user",
      googleAuth: user.googleAuth || false,
      createdAt: new Date(),
    });
    console.log(`User created: ${user.email.toLowerCase()}, Google: ${user.googleAuth || false}`);
    res.status(201).json({ success: true, insertedId: result.insertedId });
  } catch (err) {
    console.error("Error creating user:", { message: err.message, stack: err.stack });
    res.status(500).json({ message: "Server error" });
  }
});

// Add remaining routes (omitted for brevity, but same as original with connectToMongo added)
// For example, /users, /meals, /reviews, etc., follow the same pattern: call connectToMongo() at the start of each route handler.

// Root
app.get("/", (req, res) => {
  res.json("✅ HostelMate Server is Running");
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Global error:", err.stack);
  res.status(500).json({ message: "Server error", error: err.message });
});

// Export for Vercel serverless
module.exports = async (req, res) => {
  try {
    // Ensure MongoDB is connected
    await connectToMongo();
    // Let Express handle the request
    return app(req, res);
  } catch (err) {
    console.error("Serverless function error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};