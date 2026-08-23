const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  role: { type: String, enum: ["teacher", "student"], required: true },
  name: { type: String, required: true, trim: true },
  username: { type: String, required: true, trim: true, lowercase: true, unique: true },
  salt: { type: String, required: true },
  hash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("User", userSchema);
