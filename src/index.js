import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { toNodeHandler } from "better-auth/node";
import { auth, client } from "./auth.js";
import verifyToken from "./middlewares/verifyToken.js";
import verifyCustomer from "./middlewares/verifyCustomer.js";
import verifyTechnician from "./middlewares/verifyTechnician.js";
import verifyAdmin from "./middlewares/verifyAdmin.js";
import serviceRoutes from "./serviceRoutes.js";
import bookingRoutes from "./bookingRoutes.js";
import adminRoutes from "./adminRoutes.js";
import paymentRoutes from "./paymentRoutes.js";

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

app.use("/api/services", serviceRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/payments", paymentRoutes);

app.get("/api/customer", verifyToken, verifyCustomer, (req, res) => {
  res.send({ message: "Welcome Customer", user: req.user });
});

app.get("/api/technician", verifyToken, verifyTechnician, (req, res) => {
  res.send({ message: "Welcome Technician", user: req.user });
});

app.get("/api/admin-check", verifyToken, verifyAdmin, (req, res) => {
  res.send({ message: "Welcome Admin", user: req.user });
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