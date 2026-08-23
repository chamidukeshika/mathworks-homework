const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema({
  id: { type: String, required: true },
  question: { type: String, required: true, trim: true },
  marks: { type: Number, required: true, min: 1 },
  guidance: { type: String, default: "", trim: true }
}, { _id: false });

const worksheetSchema = new mongoose.Schema({
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  title: { type: String, required: true, trim: true },
  topic: { type: String, default: "", trim: true },
  description: { type: String, default: "", trim: true },
  questions: { type: [questionSchema], required: true },
  archived: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Worksheet", worksheetSchema);
