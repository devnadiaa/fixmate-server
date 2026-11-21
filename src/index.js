import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { toNodeHandler } from "better-auth/node";
import { auth, client, db } from "./auth.js";
import verifyToken from "./middlewares/verifyToken.js";
import verifyCustomer from "./middlewares/verifyCustomer.js";
import verifyTechnician from "./middlewares/verifyTechnician.js";
import verifyAdmin from "./middlewares/verifyAdmin.js";
import serviceRoutes from "./serviceRoutes.js";
import bookingRoutes from "./bookingRoutes.js";
import adminRoutes from "./adminRoutes.js";
import paymentRoutes from "./paymentRoutes.js";
import profileRoutes from "./profileRoutes.js";

dotenv.config();

const app = express();

app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "https://fixmate-client-wheat.vercel.app",
      process.env.CLIENT_URL,
    ].filter(Boolean),
    credentials: true,
  })
);

app.all("/api/auth/{*any}", toNodeHandler(auth));

app.use(
  express.json({
    verify: (req, res, buffer) => {
      if (req.originalUrl === "/api/payments/webhook") {
        req.rawBody = buffer;
      }
    },
  })
);

app.get("/", (req, res) => {
  res.send("FixMate Server is Running");
});

app.use("/api/services", serviceRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/users/profile", profileRoutes);

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

    await db.collection("bookings").createIndex(
      {
        serviceId: 1,
        customerEmail: 1,
      },
      {
        unique: true,
        name: "unique_active_booking_per_customer_service",
        partialFilterExpression: {
          status: {
            $in: ["requested", "accepted", "in-progress"],
          },
        },
      }
    );

    await db.collection("payments").createIndex(
      { bookingId: 1 },
      {
        unique: true,
        name: "unique_payment_per_booking",
        partialFilterExpression: {
          bookingId: { $type: "string" },
        },
      }
    );

    await db.collection("payments").createIndex(
      { stripeSessionId: 1 },
      {
        unique: true,
        name: "unique_stripe_session_id_payment",
        partialFilterExpression: {
          stripeSessionId: { $type: "string" },
        },
      }
    );

    console.log("Database Indexes Created Successfully");

    const port = process.env.PORT || 5000;

    app.listen(port, () => {
      console.log(`FixMate Server running on port ${port}`);
    });
  } catch (error) {
    console.error("Server Startup Failed:", error);
  }
}

run();