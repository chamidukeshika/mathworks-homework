const mongoose = require("mongoose");

const reviewItemSchema = new mongoose.Schema({
  questionId: { type: String, required: true },
  question: { type: String, required: true },
  studentAnswerText: { type: String, default: "" },
  studentAnswerDrawing: { type: String, default: null },
  marks: { type: Number, required: true },
  awardedMarks: { type: Number, default: null },
  correct: { type: Boolean, default: null },
  feedback: { type: String, default: "" }
}, { _id: false });

const submissionSchema = new mongoose.Schema({
  worksheetId: { type: mongoose.Schema.Types.ObjectId, ref: "Worksheet", required: true },
  worksheetTitle: { type: String, required: true },
  worksheetTopic: { type: String, default: "" },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  studentName: { type: String, required: true },
  answers: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ["submitted", "graded"], default: "submitted" },
  review: { type: [reviewItemSchema], default: [] },
  overallFeedback: { type: String, default: "" },
  earnedMarks: { type: Number, default: 0 },
  totalMarks: { type: Number, default: 0 },
  percentage: { type: Number, default: 0 },
  timeSpentSeconds: { type: Number, default: 0 },
  submittedAt: { type: Date, default: Date.now },
  gradedAt: { type: Date, default: null },
  gradedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
});

submissionSchema.index({ worksheetId: 1, studentId: 1 }, { unique: true });
submissionSchema.set("toJSON", { flattenMaps: true });

module.exports = mongoose.model("Submission", submissionSchema);
