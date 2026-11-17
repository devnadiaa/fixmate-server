import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URI);

async function run() {
  try {
    await client.connect();

    const db = client.db(process.env.DB_NAME);

    console.log("MongoDB Connected Successfully");

    app.get("/", (req, res) => {
      res.send("FixMate Server is Running");
    });

    app.get("/test", (req, res) => {
      res.send("MongoDB Connected Successfully");
    });

    const port = process.env.PORT || 5000;

    app.listen(port, () => {
      console.log(`FixMate Server running on port ${port}`);
    });
  } catch (error) {
    console.log("MongoDB Connection Failed");
  }
}

run();