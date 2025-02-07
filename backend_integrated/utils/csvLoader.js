import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pool from "../config/pool.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const loadCSVData = async () => {
  let connection;
  try {
    connection = await pool.getConnection();
    console.log("Starting CSV data load...");

    // Update paths to use __dirname
    const classroomPath = path.join(
      __dirname,
      "../database/classroom_list.csv"
    );
    const studentPath = path.join(__dirname, "../database/student_list.csv");
    const student3rdPath = path.join(
      __dirname,
      "../database/student_list_3rd.csv"
    );

    // Check if files exist
    console.log("Checking if files exist:");
    if (!fs.existsSync(classroomPath))
      throw new Error("Classroom file not found");
    if (!fs.existsSync(studentPath)) throw new Error("Student file not found");
    if (!fs.existsSync(student3rdPath))
      throw new Error("Student 3rd file not found");

    // Load classroom data
    console.log("Reading classroom data...");
    const classroomData = await fs.promises.readFile(classroomPath, "utf8");
    console.log("Raw classroom data:", classroomData);

    const classrooms = classroomData
      .split("\n")
      .filter((row) => row.trim())
      .map((row, index) => {
        const [classroom_name, no_of_benches, capacity] = row.trim().split(" ");
        if (!classroom_name || !no_of_benches || !capacity) {
          console.log("Invalid classroom row:", row);
          return null;
        }
        const parsedBenches = parseInt(no_of_benches);
        const parsedCapacity = parseInt(capacity);
        if (isNaN(parsedBenches) || isNaN(parsedCapacity)) {
          console.log("Invalid numbers in row:", row);
          return null;
        }
        return [index + 1, classroom_name, parsedBenches, parsedCapacity];
      })
      .filter((row) => row !== null);

    // Insert classroom data
    if (classrooms.length > 0) {
      console.log("Inserting classrooms:", classrooms);
      await connection.query("TRUNCATE TABLE classroom_list_2");
      const [result] = await connection.query(
        "INSERT INTO classroom_list_2 (sequence_number, classroom_name, no_of_benches, capacity) VALUES ?",
        [classrooms]
      );
      console.log("Classroom insert result:", result);
    } else {
      console.log("No valid classroom data to insert");
    }

    // Load student data
    console.log("Reading student data...");
    const studentData = await fs.promises.readFile(studentPath, "utf8");
    const students = studentData
      .split("\n")
      .filter((row) => row.trim())
      .map((row) => {
        const [rno, usn, ...nameParts] = row.trim().split(" ");
        if (!rno || !usn || nameParts.length === 0) {
          console.log("Invalid student row:", row);
          return null;
        }
        const parsedRno = parseInt(rno);
        if (isNaN(parsedRno)) {
          console.log("Invalid roll number:", rno);
          return null;
        }
        return [parsedRno, usn, nameParts.join(" ")];
      })
      .filter((row) => row !== null);

    if (students.length > 0) {
      console.log("Inserting students:", students);
      await connection.query("TRUNCATE TABLE student_list");
      const [result] = await connection.query(
        "INSERT INTO student_list (rno, usn, name) VALUES ?",
        [students]
      );
      console.log("Student insert result:", result);
    } else {
      console.log("No valid student data to insert");
    }

    // Load 3rd sem student data with improved parsing
    console.log("Reading 3rd sem data...");
    const student3rdData = await fs.promises.readFile(student3rdPath, "utf8");
    const students3rd = student3rdData
      .split("\n")
      .filter((row) => row.trim())
      .map((row) => {
        // Skip header and empty rows
        if (row.startsWith("data") || !row.trim()) return null;

        // Split the line by spaces, but only for the first two spaces
        const parts = row.split(/\s+/);

        if (parts.length < 3) {
          console.log("Invalid 3rd sem row format:", row);
          return null;
        }

        const rno = parts[0];
        const usn = parts[1];
        // Join the remaining parts as the name, and remove trailing commas
        const name = parts.slice(2).join(" ").replace(/,+$/, "");

        const parsedRno = parseInt(rno);
        if (isNaN(parsedRno)) {
          console.log("Invalid 3rd sem roll number:", rno);
          return null;
        }

        return [parsedRno, usn, name.trim()];
      })
      .filter((row) => row !== null);

    if (students3rd.length > 0) {
      console.log("Inserting 3rd sem students:", students3rd);
      await connection.query("TRUNCATE TABLE student_list_3rd");
      const [result] = await connection.query(
        "INSERT INTO student_list_3rd (rno, usn, name) VALUES ?",
        [students3rd]
      );
      console.log("3rd sem insert result:", result);
    } else {
      console.log("No valid 3rd sem data to insert");
    }

    console.log("All CSV data loaded successfully");
  } catch (error) {
    console.error("Error in loadCSVData:", error);
    throw error;
  } finally {
    if (connection) {
      connection.release();
      console.log("Database connection released");
    }
  }
};

export { loadCSVData };
