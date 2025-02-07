import express from "express";
import pool from "../config/pool.js";

const router = express.Router();

// Mark attendance
router.post("/mark", async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const { attendanceData } = req.body;

    for (const record of attendanceData) {
      if (record.Status === "Absent") {
        // Only insert absent records
        await connection.query(
          "INSERT INTO absentees (RollNumber, Division, Course, Semester, ISAExamNumber, Status) VALUES (?, ?, ?, ?, ?, ?)",
          [
            record.RollNumber,
            record.Division,
            record.Course,
            record.Semester,
            record.ISAExamNumber,
            record.Status,
          ]
        );
      }
    }

    res.json({ success: true, message: "Attendance marked successfully" });
  } catch (error) {
    console.error("Error in marking attendance:", error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// Get absentee list
router.get("/", async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const { semester, division, course } = req.query;

    let query = 'SELECT * FROM Absentees WHERE Status = "Absent"';
    const params = [];

    if (semester) {
      query += " AND Semester = ?";
      params.push(semester);
    }
    if (division) {
      query += " AND Division = ?";
      params.push(division);
    }
    if (course) {
      query += " AND Course = ?";
      params.push(course);
    }

    const [absentees] = await connection.query(query, params);
    res.json(absentees);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  } finally {
    if (connection) connection.release();
  }
});

export default router;
