import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { toNodeHandler } from "better-auth/node";
import { auth, client } from "./auth.js";

dotenv.config();

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true
  })
);

app.all("/api/auth/{*any}", toNodeHandler(auth));

app.use(express.json());

app.get("/", (req, res) => {
  res.send("FixMate Server is Running");
});

async function run() {
  try {
    await client.connect();

    console.log("MongoDB Connected Successfully");

    const port = process.env.PORT || 5000;

    app.listen(port, () => {
      console.log(`FixMate Server running on port ${port}`);
    });
  } catch (error) {
    console.log("MongoDB Connection Failed");
  }
}

run();