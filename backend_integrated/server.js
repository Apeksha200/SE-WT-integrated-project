import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import bodyParser from "body-parser";
import fs from "fs";
import pool from "./config/pool.js";
import bookletRoutes from "./routes/bookletRoutes.js";
import absenteeRoutes from "./routes/absenteeRoutes.js";
import timetableRoutes from "./routes/timetableRoutes.js";
import { loadCSVData } from "./utils/csvLoader.js";

dotenv.config();

const app = express();
app.use(
  cors({
    origin: [
      "http://localhost:5175",
      "http://localhost:3000",
      "http://localhost:5173",
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
    optionsSuccessStatus: 200,
  })
);
app.use(bodyParser.json());

const initializeDatabase = async () => {
  let connection;
  try {
    connection = await pool.getConnection();

    // Create database
    await connection.query("CREATE DATABASE IF NOT EXISTS isa_db");
    await connection.query("USE isa_db");

    // Create tables
    const createClassroomsTable = `
      CREATE TABLE IF NOT EXISTS classrooms (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        num_benches INT NOT NULL,
        students_per_bench INT NOT NULL,
        total_capacity INT NOT NULL
      )`;

    const createTeachersTable = `
      CREATE TABLE IF NOT EXISTS teachers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        teaches_sem_3 BOOLEAN DEFAULT 0,
        teaches_sem_5 BOOLEAN DEFAULT 0,
        division VARCHAR(1) NOT NULL
      )`;

    const createAllocationsTable = `
      CREATE TABLE IF NOT EXISTS allocations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        teacher_id INT,
        classroom_id INT,
        semester INT NOT NULL,
        allocation_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (teacher_id) REFERENCES teachers(id),
        FOREIGN KEY (classroom_id) REFERENCES classrooms(id)
      )`;

    // Create tables
    await connection.query(createClassroomsTable);
    console.log("Classrooms table ready");

    await connection.query(createTeachersTable);
    console.log("Teachers table ready");

    // Insert classroom data
    const classroomData = [
      ["CSC313", 40, 2],
      ["CLAB-1", 36, 2],
      ["CLAB-2", 38, 2],
      ["LAB-1", 37, 2],
      ["CLH209", 38, 2],
      ["CLH208", 22, 3],
      ["CLH310", 22, 3],
      ["CLH303", 36, 2],
      ["CLH204", 35, 2],
      ["CLH304", 34, 2],
      ["CLH210", 22, 3],
      ["CLH308", 36, 2],
      ["LAB-6", 34, 2],
      ["LAB-7", 34, 2],
    ];

    // First check which classrooms already exist
    const [existingClassrooms] = await connection.query(
      "SELECT name FROM classrooms"
    );
    const existingNames = new Set(existingClassrooms.map((room) => room.name));

    // Filter out classrooms that already exist
    const newClassrooms = classroomData.filter(
      (room) => !existingNames.has(room[0])
    );

    if (newClassrooms.length > 0) {
      const classroomValues = newClassrooms.map((room) => [
        room[0],
        room[1],
        room[2],
        room[1] * room[2],
      ]);

      const insertClassroomSQL = `
        INSERT INTO classrooms (name, num_benches, students_per_bench, total_capacity) 
        VALUES ?`;

      await connection.query(insertClassroomSQL, [classroomValues]);
      console.log(`${newClassrooms.length} new classrooms inserted`);
    } else {
      console.log("No new classrooms to insert");
    }
    // Process teacher data
    try {
      const sem3Data = fs
        .readFileSync("./teacher-list.csv", "utf-8")
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          const [name, _, division, semester] = line.split(",");
          return {
            name: name.trim(),
            division: division.trim(),
            semester: parseInt(semester),
          };
        });

      const sem5Data = fs
        .readFileSync("./teacher-list-sem-5.csv", "utf-8")
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          const [name, _, division, semester] = line.split(",");
          return {
            name: name.trim(),
            division: division.trim(),
            semester: parseInt(semester),
          };
        });

      const teacherFirstOccurrence = new Map();
      const teacherValues = [];

      sem3Data.forEach((teacher) => {
        if (!teacherFirstOccurrence.has(teacher.name)) {
          teacherFirstOccurrence.set(teacher.name, {
            division: teacher.division,
            teaches_sem_3: 1,
            teaches_sem_5: 0,
          });
          teacherValues.push([
            teacher.name,
            1, // teaches_sem_3
            0, // teaches_sem_5
            teacher.division,
          ]);
        }
      });

      sem5Data.forEach((teacher) => {
        if (!teacherFirstOccurrence.has(teacher.name)) {
          teacherFirstOccurrence.set(teacher.name, {
            division: teacher.division,
            teaches_sem_3: 0,
            teaches_sem_5: 1,
          });
          teacherValues.push([
            teacher.name,
            0, // teaches_sem_3
            1, // teaches_sem_5
            teacher.division,
          ]);
        }
      });

      if (teacherValues.length > 0) {
        // First check for existing names
        const names = teacherValues.map((teacher) => teacher[0]);
        const [existingTeachers] = await connection.query(
          "SELECT name FROM teachers WHERE name IN (?)",
          [names]
        );

        // Filter out teachers that already exist
        const existingNames = new Set(existingTeachers.map((t) => t.name));
        const newTeacherValues = teacherValues.filter(
          (teacher) => !existingNames.has(teacher[0])
        );

        if (newTeacherValues.length > 0) {
          const insertTeacherSQL = `
            INSERT INTO teachers (name, teaches_sem_3, teaches_sem_5, division) 
            VALUES ?`;
          await connection.query(insertTeacherSQL, [newTeacherValues]);
          console.log("New teacher data inserted successfully");
        } else {
          console.log("No new teachers to insert");
        }
      }
    } catch (error) {
      console.error("Error processing teacher data:", error);
    }

    // Drop and recreate allocations table
    await connection.query("DROP TABLE IF EXISTS allocations");
    console.log("Allocations table dropped");

    await connection.query(createAllocationsTable);
    console.log("Allocations table ready");
  } catch (error) {
    console.error("Database initialization error:", error);
  } finally {
    if (connection) connection.release();
  }
};

// Get all classrooms
app.get("/api/classrooms", async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [rows] = await connection.query("SELECT * FROM classrooms");
    res.json(rows);
  } catch (error) {
    console.error("Error fetching classrooms:", error);
    res.status(500).json({ error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// Get teachers by semester
app.get("/api/teachers/:semester", async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const semester = req.params.semester;
    const [rows] = await connection.query(
      `SELECT * FROM teachers WHERE teaches_sem_${semester} = 1`
    );
    res.json(rows);
  } catch (error) {
    console.error("Error fetching teachers:", error);
    res.status(500).json({ error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// Modified allocation route
app.post("/api/allocate-division", async (req, res) => {
  let connection;
  try {
    const { semester, division } = req.body;
    connection = await pool.getConnection();

    // Keep the detailed classroom query to track semester distribution
    const classroomQuery = `
      SELECT 
        c.*,
        COUNT(a.id) as current_teachers,
        SUM(CASE WHEN t.teaches_sem_3 = 1 THEN 1 ELSE 0 END) as sem3_count,
        SUM(CASE WHEN t.teaches_sem_5 = 1 THEN 1 ELSE 0 END) as sem5_count
      FROM classrooms c
      LEFT JOIN allocations a ON c.id = a.classroom_id
      LEFT JOIN teachers t ON a.teacher_id = t.id
      GROUP BY c.id
      HAVING (COUNT(a.id) < c.students_per_bench OR COUNT(a.id) IS NULL)
      ORDER BY 
        CASE 
          WHEN COUNT(a.id) IS NULL THEN 0 
          ELSE COUNT(a.id) 
        END ASC,
        c.name`;

    const [availableClassrooms] = await connection.query(classroomQuery);

    // Teacher query remains the same
    const teacherQuery = `
      SELECT t.* 
      FROM teachers t
      LEFT JOIN allocations a ON t.id = a.teacher_id
      WHERE t.teaches_sem_${semester} = 1 
      AND t.division = ?
      AND a.id IS NULL
      ORDER BY t.name`;

    const [availableTeachers] = await connection.query(teacherQuery, [
      division,
    ]);

    // Create allocations with proper semester distribution rules
    const allocations = [];
    let teacherIndex = 0;

    availableClassrooms.forEach((classroom) => {
      const sem3Teachers = classroom.sem3_count || 0;
      const sem5Teachers = classroom.sem5_count || 0;
      const currentTotal = classroom.current_teachers || 0;
      const maxTeachers = classroom.students_per_bench;
      let canAllocate = false;

      // Check allocation rules based on room capacity
      if (currentTotal < maxTeachers) {
        if (maxTeachers === 2) {
          // For 2-capacity rooms: max 1 from same semester
          if (semester === "3" && sem3Teachers < 1) canAllocate = true;
          if (semester === "5" && sem5Teachers < 1) canAllocate = true;
        } else if (maxTeachers === 3) {
          // For 3-capacity rooms: max 2 from same semester
          if (semester === "3" && sem3Teachers < 2) canAllocate = true;
          if (semester === "5" && sem5Teachers < 2) canAllocate = true;
        }
      }

      if (canAllocate && teacherIndex < availableTeachers.length) {
        allocations.push([availableTeachers[teacherIndex].id, classroom.id]);
        teacherIndex++;
      }
    });

    if (allocations.length > 0) {
      const sql = "INSERT INTO allocations (teacher_id, classroom_id) VALUES ?";
      await connection.query(sql, [allocations]);

      res.json({
        success: true,
        message: `Created ${allocations.length} allocations`,
      });
    } else {
      res.status(400).json({
        error:
          "No valid allocations could be created. Check semester distribution rules.",
      });
    }
  } catch (error) {
    console.error("Error in allocation:", error);
    res.status(500).json({ error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// GET allocations route
app.get("/api/allocations", async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();

    const sql = `
      SELECT 
      c.id as classroom_id,
      c.name as classroom_name,
      c.students_per_bench as max_teachers,
      GROUP_CONCAT(t.name) as teacher_names,
      COUNT(a.id) as current_teachers,
      c.students_per_bench
    FROM classrooms c
    LEFT JOIN allocations a ON c.id = a.classroom_id
    LEFT JOIN teachers t ON a.teacher_id = t.id
    GROUP BY c.id, c.name, c.students_per_bench
    ORDER BY c.name`;

    const [result] = await connection.query(sql);

    const allocated = result
      .filter((r) => r.teacher_names)
      .map((room) => ({
        classroom_id: room.classroom_id,
        classroom_name: room.classroom_name,
        max_teachers: room.students_per_bench,
        teacher_names: room.teacher_names ? room.teacher_names.split(",") : [],
        current_teachers: room.current_teachers,
        students_per_bench: room.students_per_bench,
      }));

    const unallocated = result
      .filter((r) => !r.teacher_names)
      .map((room) => ({
        classroom_id: room.classroom_id,
        classroom_name: room.classroom_name,
        students_per_bench: room.students_per_bench,
      }));

    res.json({
      allocated,
      unallocated,
    });
  } catch (error) {
    console.error("Error fetching allocations:", error);
    res.status(500).json({ error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// Delete allocations for a classroom
app.delete("/api/allocations/classroom/:classroomId", async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const classroomId = req.params.classroomId;

    const sql = "DELETE FROM allocations WHERE classroom_id = ?";
    const [result] = await connection.query(sql, [classroomId]);

    res.json({ success: true, message: "Allocations deleted successfully" });
  } catch (error) {
    console.error("Error deleting allocations:", error);
    res.status(500).json({ error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// Get teachers info
app.get("/api/teachers-info", async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();

    const [rows] = await connection.query(
      "SELECT id, name, teaches_sem_3, teaches_sem_5 FROM teachers"
    );

    res.json(rows);
  } catch (error) {
    console.error("Error fetching teachers info:", error);
    res.status(500).json({ error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// New endpoint for detailed teacher information
app.get("/api/teachers-details", async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    console.log("Reading teacher files...");

    const sem3Data = fs
      .readFileSync("teacher-list.csv", "utf-8") // Removed the './' prefix
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const [name, course, division, semester] = line.split(",");
        return {
          name: name.trim(),
          course: course.trim(),
          division: division.trim(),
          semester: 3,
        };
      });

    const sem5Data = fs
      .readFileSync("teacher-list-sem-5.csv", "utf-8") // Removed the './' prefix
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const [name, course, division, semester] = line.split(",");
        return {
          name: name.trim(),
          course: course.trim(),
          division: division.trim(),
          semester: 5,
        };
      });

    console.log("Teachers data loaded:", {
      sem3Count: sem3Data.length,
      sem5Count: sem5Data.length,
    });

    const allTeachers = [...sem3Data, ...sem5Data];
    res.json(allTeachers);
  } catch (error) {
    console.error("Error fetching teacher data:", error);
    res.status(500).json({
      error: "Failed to fetch teacher details",
      details: error.message,
    });
  } finally {
    if (connection) connection.release();
  }
});

// Get unallocated teachers
app.get("/api/unallocated-teachers", async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();

    const sql = `
      SELECT t.id, t.name, t.teaches_sem_3, t.teaches_sem_5, t.division
      FROM teachers t
      LEFT JOIN allocations a ON t.id = a.teacher_id
      WHERE a.id IS NULL
      ORDER BY t.name`;

    const [result] = await connection.query(sql);
    res.json(result);
  } catch (error) {
    console.error("Error fetching unallocated teachers:", error);
    res.status(500).json({ error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// Get available classrooms with current allocations
app.get("/api/available-classrooms", async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();

    const sql = `
      SELECT 
        c.id,
        c.name,
        c.students_per_bench,
        COUNT(a.id) as current_teachers,
        SUM(CASE WHEN t.teaches_sem_3 = 1 THEN 1 ELSE 0 END) as sem3_count,
        SUM(CASE WHEN t.teaches_sem_5 = 1 THEN 1 ELSE 0 END) as sem5_count
      FROM classrooms c
      LEFT JOIN allocations a ON c.id = a.classroom_id
      LEFT JOIN teachers t ON a.teacher_id = t.id
      GROUP BY c.id, c.name, c.students_per_bench
      HAVING current_teachers < students_per_bench OR current_teachers IS NULL
      ORDER BY c.name`;

    const [result] = await connection.query(sql);
    res.json(result);
  } catch (error) {
    console.error("Error fetching available classrooms:", error);
    res.status(500).json({ error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// Manual allocation endpoint
app.post("/api/manual-allocate", async (req, res) => {
  let connection;
  try {
    const { teacherId, classroomId } = req.body;

    // Input validation
    if (!teacherId || !classroomId) {
      return res
        .status(400)
        .json({ error: "Teacher ID and Classroom ID are required" });
    }

    connection = await pool.getConnection();

    // Get teacher details
    const teacherQuery = "SELECT * FROM teachers WHERE id = ?";
    const [teacherResult] = await connection.query(teacherQuery, [teacherId]);

    if (teacherResult.length === 0) {
      return res.status(404).json({ error: "Teacher not found" });
    }

    const teacher = teacherResult[0];

    // Get classroom details with current allocations
    const classroomQuery = `
      SELECT 
        c.*,
        COUNT(a.id) as current_teachers,
        SUM(CASE WHEN t.teaches_sem_3 = 1 THEN 1 ELSE 0 END) as sem3_count,
        SUM(CASE WHEN t.teaches_sem_5 = 1 THEN 1 ELSE 0 END) as sem5_count
      FROM classrooms c
      LEFT JOIN allocations a ON c.id = a.classroom_id
      LEFT JOIN teachers t ON a.teacher_id = t.id
      WHERE c.id = ?
      GROUP BY c.id`;

    const [classroomResult] = await connection.query(classroomQuery, [
      classroomId,
    ]);

    if (classroomResult.length === 0) {
      return res.status(404).json({ error: "Classroom not found" });
    }

    const classroom = classroomResult[0];

    // Check if classroom is full
    if (classroom.current_teachers >= classroom.students_per_bench) {
      return res.status(400).json({ error: "Classroom is already full" });
    }

    // Check semester distribution rules
    const isSem3Teacher = teacher.teaches_sem_3 === 1;
    const isSem5Teacher = teacher.teaches_sem_5 === 1;

    if (classroom.students_per_bench === 2) {
      if (
        (isSem3Teacher && classroom.sem3_count > 0) ||
        (isSem5Teacher && classroom.sem5_count > 0)
      ) {
        return res.status(400).json({
          error:
            "For 2-capacity rooms, cannot have more than one teacher from the same semester",
        });
      }
    } else if (classroom.students_per_bench === 3) {
      if (
        (isSem3Teacher && classroom.sem3_count >= 2) ||
        (isSem5Teacher && classroom.sem5_count >= 2)
      ) {
        return res.status(400).json({
          error:
            "For 3-capacity rooms, cannot have more than two teachers from the same semester",
        });
      }
    }

    // If all checks pass, create the allocation
    const insertQuery =
      "INSERT INTO allocations (teacher_id, classroom_id) VALUES (?, ?)";
    await connection.query(insertQuery, [teacherId, classroomId]);

    res.json({
      success: true,
      message: "Teacher allocated successfully",
    });
  } catch (error) {
    console.error("Error in manual allocation:", error);
    res.status(500).json({ error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// Get question paper counts for a classroom
app.get("/api/question-papers/:classroomId", async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const classroomId = req.params.classroomId;

    const sql = `
      SELECT 
        c.name as classroom_name,
        c.num_benches,
        c.students_per_bench,
        SUM(CASE WHEN t.teaches_sem_3 = 1 THEN 1 ELSE 0 END) as sem3_teachers,
        SUM(CASE WHEN t.teaches_sem_5 = 1 THEN 1 ELSE 0 END) as sem5_teachers
      FROM classrooms c
      LEFT JOIN allocations a ON c.id = a.classroom_id
      LEFT JOIN teachers t ON a.teacher_id = t.id
      WHERE c.id = ?
      GROUP BY c.id, c.name, c.num_benches, c.students_per_bench`;

    const [result] = await connection.query(sql, [classroomId]);

    if (result.length === 0) {
      return res.status(404).json({ error: "Classroom not found" });
    }

    const classroom = result[0];
    const paperCounts = {
      classroom_name: classroom.classroom_name,
      papers: {},
    };

    // Calculate paper counts based on number of teachers
    if (classroom.sem3_teachers > 0) {
      paperCounts.papers.sem3 = classroom.num_benches * classroom.sem3_teachers;
    }

    if (classroom.sem5_teachers > 0) {
      paperCounts.papers.sem5 = classroom.num_benches * classroom.sem5_teachers;
    }

    res.json(paperCounts);
  } catch (error) {
    console.error("Error fetching question paper counts:", error);
    res.status(500).json({ error: error.message });
  } finally {
    if (connection) connection.release();
  }
});
// Routes
app.use("/api/booklets", bookletRoutes);
app.use("/api/absentees", absenteeRoutes);
app.use("/api/timetable", timetableRoutes);

app.post("/api/login", async (req, res) => {
  try {
    const { username, password, role } = req.body;
    const connection = await pool.getConnection();

    try {
      const [rows] = await connection.query(
        "SELECT * FROM users WHERE username = ? AND password = ? AND role = ?",
        [username, password, role]
      );

      if (rows.length > 0) {
        res.json({ success: true, role: rows[0].role });
      } else {
        res
          .status(401)
          .json({ success: false, message: "Invalid credentials" });
      }
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Get faculty list
app.get("/api/faculty", async (req, res) => {
  try {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.query(
        "SELECT * FROM faculty WHERE designation IN (?, ?, ?) ORDER BY name",
        ["Assistant Professor", "Assistant Professor (P)", "T.A"]
      );
      res.json(rows);
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Error fetching faculty:", error);
    res.status(500).json({ message: "Failed to fetch faculty list" });
  }
});

// Get classrooms
app.get("/api/classrooms", async (req, res) => {
  try {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.query(
        "SELECT * FROM classroom_data WHERE third_sem_qp_count > 0 OR fifth_sem_qp_count > 0 ORDER BY classroom"
      );
      res.json(rows);
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Error fetching classrooms:", error);
    res.status(500).json({ message: "Failed to fetch classroom list" });
  }
});

// Save duty allocation
app.post("/api/duty-allocation/save", async (req, res) => {
  try {
    const { examType, allocations } = req.body;

    // Validate request data
    if (
      !examType ||
      !allocations ||
      !Array.isArray(allocations) ||
      allocations.length === 0
    ) {
      return res.status(400).json({ message: "Invalid request data" });
    }

    // Validate exam type
    if (!["ISA1", "ISA2", "ESA"].includes(examType)) {
      return res.status(400).json({ message: "Invalid exam type" });
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Get unique dates from allocations
      const dates = [...new Set(allocations.map((a) => a.date))];

      // Delete existing allocations for these dates
      await connection.query(
        "DELETE FROM duty_allocation WHERE exam_type = ? AND date IN (?)",
        [examType, dates]
      );

      // Insert new allocations
      for (const allocation of allocations) {
        await connection.query(
          "INSERT INTO duty_allocation (exam_type, date, session, faculty_name, classroom) VALUES (?, ?, ?, ?, ?)",
          [
            examType,
            allocation.date,
            allocation.session,
            allocation.name,
            allocation.classroom,
          ]
        );
      }

      await connection.commit();
      res.json({
        success: true,
        message: "Duty allocations saved successfully",
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Error saving duty allocations:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to save duty allocations",
    });
  }
});

// Delete all duty allocations
app.delete("/api/duty-allocation/clear", async (req, res) => {
  try {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query("DELETE FROM duty_allocation");
      await connection.commit();
      res.json({
        success: true,
        message: "Duty allocations cleared successfully",
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Error clearing duty allocations:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to clear duty allocations",
    });
  }
});

// Save timetable
app.post("/api/timetable/save", async (req, res) => {
  try {
    const { examType, semester, entries } = req.body;

    // Validate request data
    if (!examType || !semester || !entries || !Array.isArray(entries)) {
      return res.status(400).json({ message: "Invalid request data" });
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Insert each timetable entry
      const values = entries.map((entry) => [
        examType,
        semester,
        entry.department,
        entry.date,
        "", // day
        entry.startTime,
        entry.endTime,
        entry.courseName,
        entry.courseCode,
      ]);

      const query = `
        INSERT INTO timetable_summary 
        (exam_type, semester, department, date, day, start_time, end_time, course_name, course_code)
        VALUES ?
      `;

      await connection.query(query, [values]);

      await connection.commit();
      res.json({ message: "Timetable saved successfully" });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Error saving timetable:", error);
    res
      .status(500)
      .json({ message: error.message || "Failed to save timetable" });
  }
});

// Update seating arrangement endpoint
app.get("/seating-arrangement", async (req, res) => {
  try {
    const connection = await pool.getConnection();
    try {
      // Fetch classroom and student data
      const [classrooms] = await connection.query(
        "SELECT * FROM classroom_list_2 ORDER BY sequence_number"
      );
      const [thirdSemStudents] = await connection.query(
        "SELECT * FROM student_list_3rd ORDER BY rno"
      );
      const [fifthSemStudents] = await connection.query(
        "SELECT * FROM student_list ORDER BY rno"
      );

      // Group students by division (e.g., 100-series, 200-series)
      const groupByDivision = (students) => {
        const divisions = {};
        students.forEach((student) => {
          const division = Math.floor(student.rno / 100); // Identify division by roll number
          if (!divisions[division]) divisions[division] = [];
          divisions[division].push(student.rno); // Collect roll numbers
        });
        return divisions;
      };

      const thirdSemDivisions = groupByDivision(thirdSemStudents);
      const fifthSemDivisions = groupByDivision(fifthSemStudents);

      // Allocate classrooms
      const allocation = [];
      classrooms.forEach((classroom) => {
        const benches = classroom.no_of_benches; // Total benches in the classroom

        let thirdSemRollNumbers = [];
        let fifthSemRollNumbers = [];
        let thirdSemPaperCount = 0;
        let fifthSemPaperCount = 0;

        // Allocate students for 3rd sem
        const thirdDivisionKeys = Object.keys(thirdSemDivisions);
        if (thirdDivisionKeys.length > 0) {
          const currentThirdDivision = thirdDivisionKeys[0]; // Get the first division
          const students = thirdSemDivisions[currentThirdDivision].splice(
            0,
            benches
          ); // Take up to 'benches' students
          thirdSemRollNumbers = students;
          thirdSemPaperCount = students.length + 2;

          // Remove division if all students are allocated
          if (thirdSemDivisions[currentThirdDivision].length === 0) {
            delete thirdSemDivisions[currentThirdDivision];
          }
        }

        // Allocate students for 5th sem
        const fifthDivisionKeys = Object.keys(fifthSemDivisions);
        if (fifthDivisionKeys.length > 0) {
          const currentFifthDivision = fifthDivisionKeys[0]; // Get the first division
          const students = fifthSemDivisions[currentFifthDivision].splice(
            0,
            benches
          ); // Take up to 'benches' students
          fifthSemRollNumbers = students;
          fifthSemPaperCount = students.length + 2;

          // Remove division if all students are allocated
          if (fifthSemDivisions[currentFifthDivision].length === 0) {
            delete fifthSemDivisions[currentFifthDivision];
          }
        }

        // Determine roll number ranges
        const getRollNumberRange = (rollNumbers) => {
          const filteredNumbers = rollNumbers.filter((num) => num !== "EMPTY");
          if (filteredNumbers.length === 0) return "EMPTY"; // No students allocated
          return `${filteredNumbers[0]}-${
            filteredNumbers[filteredNumbers.length - 1]
          }`;
        };

        const thirdSemRollNumberRange = getRollNumberRange(thirdSemRollNumbers);
        const fifthSemRollNumberRange = getRollNumberRange(fifthSemRollNumbers);

        allocation.push({
          classroom_name: classroom.classroom_name,
          third_sem_roll_numbers: thirdSemRollNumberRange,
          fifth_sem_roll_numbers: fifthSemRollNumberRange,
          third_sem_paper_count: thirdSemPaperCount,
          fifth_sem_paper_count: fifthSemPaperCount,
        });
      });

      // Create a new table for seating allocations
      await connection.query(`
        CREATE TABLE IF NOT EXISTS seat_arrangement (
          classroom_name VARCHAR(50),
          third_sem_roll_numbers VARCHAR(50),
          fifth_sem_roll_numbers VARCHAR(50),
          third_sem_paper_count INT,
          fifth_sem_paper_count INT
        )
      `);

      // Clear old data
      await connection.query("TRUNCATE TABLE seat_arrangement");

      // Insert allocation data into the database
      for (const entry of allocation) {
        await connection.query("INSERT INTO seat_arrangement SET ?", entry);
      }

      // Send the allocation as a response
      res.json(allocation);
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
});

// Update classroom list endpoint
app.get("/classroom-list", async (req, res) => {
  try {
    const connection = await pool.getConnection();
    try {
      const [classrooms] = await connection.query(
        "SELECT * FROM classroom_list_2 ORDER BY sequence_number"
      );
      res.json(classrooms);
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
});

// Update add classroom endpoint
app.post("/add-classroom", async (req, res) => {
  const { classroom_name, no_of_benches } = req.body;
  try {
    const connection = await pool.getConnection();
    try {
      // Check if the classroom name already exists
      const [existingClassroom] = await connection.query(
        "SELECT * FROM classroom_list_2 WHERE classroom_name = ?",
        [classroom_name]
      );

      if (existingClassroom.length > 0) {
        return res.status(400).send("Classroom with this name already exists.");
      }

      // Get the last sequence_number to increment
      const [lastClassroom] = await connection.query(
        "SELECT * FROM classroom_list_2 ORDER BY sequence_number DESC LIMIT 1"
      );
      const sequence_number = lastClassroom.length
        ? lastClassroom[0].sequence_number + 1
        : 1;

      // Insert the new classroom into the database
      await connection.query(
        "INSERT INTO classroom_list_2 (sequence_number, classroom_name, no_of_benches) VALUES (?, ?, ?)",
        [sequence_number, classroom_name, no_of_benches]
      );

      res.status(200).send("Classroom added successfully!");
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
});

// Update delete classroom endpoint
app.post("/delete-classroom", async (req, res) => {
  const { classroom_name } = req.body;
  try {
    const connection = await pool.getConnection();
    try {
      // Ensure that classroom_name is provided
      if (!classroom_name) {
        return res.status(400).send("Classroom name is required.");
      }

      // Check if the classroom exists
      const [classroom] = await connection.query(
        "SELECT * FROM classroom_list_2 WHERE classroom_name = ?",
        [classroom_name]
      );

      if (classroom.length === 0) {
        return res.status(404).send("Classroom not found.");
      }

      // Delete the classroom
      const [deleteResult] = await connection.query(
        "DELETE FROM classroom_list_2 WHERE classroom_name = ?",
        [classroom_name]
      );

      if (deleteResult.affectedRows === 0) {
        return res.status(500).send("Failed to delete the classroom.");
      }

      res.status(200).send("Classroom deleted successfully!");
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Error during delete:", error);
    res.status(500).send("Server Error");
  }
});

// Update benches endpoint
app.put("/update-benches", async (req, res) => {
  const { classroom_name, new_no_of_benches } = req.body;
  try {
    const connection = await pool.getConnection();
    try {
      // Ensure that classroom_name and no_of_benches are provided
      if (!classroom_name || !new_no_of_benches) {
        return res
          .status(400)
          .send("Classroom name and new number of benches are required.");
      }

      // Check if the classroom exists
      const [classroom] = await connection.query(
        "SELECT * FROM classroom_list_2 WHERE classroom_name = ?",
        [classroom_name]
      );

      if (classroom.length === 0) {
        return res.status(404).send("Classroom not found.");
      }

      // Update the number of benches
      const [updateResult] = await connection.query(
        "UPDATE classroom_list_2 SET no_of_benches = ? WHERE classroom_name = ?",
        [new_no_of_benches, classroom_name]
      );

      if (updateResult.affectedRows === 0) {
        return res.status(500).send("Failed to update the number of benches.");
      }

      res.status(200).send("Number of benches updated successfully!");
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Error during update:", error);
    res.status(500).send("Server Error");
  }
});

// Standardize error responses across all routes
const handleError = (res, error, message = "Server Error") => {
  console.error(error);
  return res.status(500).json({
    success: false,
    message,
    error: error.message,
  });
};

const PORT = process.env.PORT || 5000;

const initializeServer = async () => {
  try {
    // Initialize database and load CSV data
    await initializeDatabase();
    await loadCSVData();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to initialize server:", error);
    process.exit(1);
  }
};

// Start the server
initializeServer();
