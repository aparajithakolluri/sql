import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Initialize Database (in-memory for the sandbox, or a file if we want persistence)
// For this app, let's use a file so it feels like a real SQL project.
const dbPath = path.join(process.cwd(), 'database.sqlite');
const db = new Database(dbPath);

// Seed Database with some interesting tables if it's empty
const tablesExist = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='employees'").get();

if (!tablesExist) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      location TEXT
    );

    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT,
      salary INTEGER,
      department_id INTEGER,
      joined_at DATE DEFAULT (date('now')),
      FOREIGN KEY(department_id) REFERENCES departments(id)
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      budget INTEGER,
      status TEXT CHECK(status IN ('planned', 'active', 'completed')),
      department_id INTEGER,
      FOREIGN KEY(department_id) REFERENCES departments(id)
    );

    INSERT INTO departments (name, location) VALUES 
      ('Engineering', 'San Francisco'),
      ('Design', 'London'),
      ('Marketing', 'New York'),
      ('Sales', 'Tokyo');

    INSERT INTO employees (name, role, salary, department_id) VALUES 
      ('Alice Smith', 'Lead Engineer', 120000, 1),
      ('Bob Jones', 'Frontend Dev', 95000, 1),
      ('Charlie Brown', 'UX Designer', 90000, 2),
      ('Diana Ross', 'Product Manager', 110000, 1),
      ('Edward Elric', 'Growth Lead', 85000, 3),
      ('Fiona Gallagher', 'Account Exec', 75000, 4);

    INSERT INTO projects (title, budget, status, department_id) VALUES
      ('Project Phoenix', 50000, 'active', 1),
      ('Global Rebrand', 120000, 'planned', 3),
      ('App Redesign', 30000, 'completed', 2);
  `);
}

app.use(express.json());

// Initialize Gemini
const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// API Routes
app.get("/api/schema", (req, res) => {
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
    const schema: any = {};
    
    for (const table of tables) {
      const columns = db.prepare(`PRAGMA table_info(${table.name})`).all();
      schema[table.name] = columns;
    }
    
    res.json(schema);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/query", (req, res) => {
  const { sql } = req.body;
  if (!sql) return res.status(400).json({ error: "Missing SQL query" });

  try {
    // Basic protection (though this is a sandbox, we should be careful)
    // We only allow SELECT for the "Playground" but maybe allow others if requested?
    // Let's allow everything for a real "Sandbox" experience.
    const stmt = db.prepare(sql);
    let result;
    
    if (stmt.reader) {
      result = stmt.all();
    } else {
      const runResult = stmt.run();
      result = { 
        message: "Query executed successfully", 
        changes: runResult.changes, 
        lastInsertRowid: runResult.lastInsertRowid 
      };
    }
    
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/ai/explain", async (req, res) => {
  const { sql } = req.body;
  if (!sql) return res.status(400).json({ error: "No SQL provided" });

  try {
    const response = await genAI.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Explain this SQL query concisely. If it contains potential hazards (like a DELETE without WHERE), mention it as a warning: \n\n\`\`\`sql\n${sql}\n\`\`\``,
    });
    res.json({ explanation: response.text });
  } catch (error: any) {
    res.status(500).json({ error: "AI service is currently unavailable." });
  }
});

app.post("/api/ai/suggest", async (req, res) => {
  const { prompt, schema } = req.body;
  try {
    const response = await genAI.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Generate a SQL query based on this request: "${prompt}". 
      
Here is the database schema for context:
${JSON.stringify(schema, null, 2)}

Return ONLY the SQL code, no markdown blocks, no explanation.`,
    });
    res.json({ sql: response.text?.replace(/```sql|```/g, '').trim() });
  } catch (error: any) {
    res.status(500).json({ error: "AI service is currently unavailable." });
  }
});

// Serve frontend
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
