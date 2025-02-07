import express from "express";
import pool from "../config/pool.js";

const router = express.Router();

// Generate and assign booklets
router.post("/assign", async (req, res) => {
  let connection;
  try {
    // Validate input
    const { semester, division, course, isaExamNumber, startRoll, endRoll } =
      req.body;

    if (
      !semester ||
      !division ||
      !course ||
      !isaExamNumber ||
      !startRoll ||
      !endRoll
    ) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    connection = await pool.getConnection();

    // Drop the table if it exists and create new one with correct column names
    await connection.query(`DROP TABLE IF EXISTS Booklets`);

    // Create table with exact column names
    await connection.query(`
      CREATE TABLE Booklets (
        booklet_id VARCHAR(50) PRIMARY KEY,
        roll_number INT NOT NULL,
        division VARCHAR(1) NOT NULL,
        course VARCHAR(100) NOT NULL,
        semester VARCHAR(2) NOT NULL,
        isa_exam_number VARCHAR(2) NOT NULL
      )
    `);

    const booklets = [];
    for (let roll = parseInt(startRoll); roll <= parseInt(endRoll); roll++) {
      const bookletId = `ISA-M-${isaExamNumber}-${division}-${roll
        .toString()
        .padStart(3, "0")}`;
      booklets.push([
        bookletId,
        roll,
        division,
        course,
        semester,
        isaExamNumber,
      ]);
    }

    if (booklets.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid booklets to assign",
      });
    }

    // Update the INSERT query to match the new column names
    await connection.query(
      "INSERT INTO Booklets (booklet_id, roll_number, division, course, semester, isa_exam_number) VALUES ?",
      [booklets]
    );

    res.json({
      success: true,
      message: "Booklets assigned successfully",
      count: booklets.length,
    });
  } catch (error) {
    console.error("Error in booklet assignment:", error);
    res.status(500).json({
      success: false,
      message: "Failed to assign booklets",
      error: error.message,
    });
  } finally {
    if (connection) connection.release();
  }
});

// Get assigned booklets with filters
router.get("/", async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const { semester, division, course, isa_exam_number } = req.query;

    let query = "SELECT * FROM booklets WHERE 1=1";
    const params = [];

    if (semester) {
      query += " AND semester = ?";
      params.push(semester);
    }
    if (division) {
      query += " AND division = ?";
      params.push(division);
    }
    if (course) {
      query += " AND course = ?";
      params.push(course);
    }
    if (isa_exam_number) {
      query += " AND isa_exam_number = ?";
      params.push(isa_exam_number);
    }

    query += " ORDER BY roll_number";

    const [booklets] = await connection.query(query, params);
    res.json(booklets);
  } catch (error) {
    console.error("Error fetching booklets:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  } finally {
    if (connection) connection.release();
  }
});

export default router;
