import express from "express";
import pool from "../config/pool.js";

const router = express.Router();

// Get courses with absentees
router.get("/courses/:semester", async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const { semester } = req.params;

    const [courses] = await connection.query(
      `SELECT DISTINCT Course FROM Absentees 
       WHERE Status = 'Absent' AND Semester = ? 
       GROUP BY Course 
       HAVING COUNT(*) > 0`,
      [semester]
    );

    res.json(courses);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  } finally {
    if (connection) connection.release();
  }
});

export default router;
