const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const db = require("../utils/db");

const router = express.Router();

// ─── Register ─────────────────────────────────────────────────────────────────
router.post("/register", async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const hashed = await bcrypt.hash(password, 12);

  const result = await db.query(
    "INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING id, email, name, created_at",
    [email.toLowerCase(), hashed, name || null]
  );

  const user = result.rows[0];
  const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });

  res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

// ─── Login ────────────────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const result = await db.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
  const user = result.rows[0];

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });

  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

// ─── Get current user ─────────────────────────────────────────────────────────
router.get("/me", require("../middleware/auth").authMiddleware, async (req, res) => {
  const result = await db.query(
    "SELECT id, email, name, created_at FROM users WHERE id = $1",
    [req.user.userId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "User not found" });
  res.json({ user: result.rows[0] });
});

module.exports = router;
