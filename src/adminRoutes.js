import express from "express";
import { ObjectId } from "mongodb";
import { db } from "./auth.js";
import verifyToken from "./middlewares/verifyToken.js";
import verifyAdmin from "./middlewares/verifyAdmin.js";

const router = express.Router();

const usersCollection = db.collection("users");
const servicesCollection = db.collection("services");
const bookingsCollection = db.collection("bookings");
const paymentsCollection = db.collection("payments");

router.get("/users", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const users = await usersCollection
      .find({})
      .project({
        name: 1,
        email: 1,
        role: 1,
        createdAt: 1
      })
      .toArray();

    res.send(users);
  } catch (error) {
    res.status(500).send({ message: "Failed to get users" });
  }
});

router.patch("/users/:email/role", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { role } = req.body;

    if (
      role !== "customer" &&
      role !== "technician" &&
      role !== "admin"
    ) {
      return res.status(400).send({ message: "Invalid user role" });
    }

    const result = await usersCollection.updateOne(
      { email: req.params.email },
      { $set: { role } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({ message: "User not found" });
    }

    res.send({ message: "User role updated successfully" });
  } catch (error) {
    res.status(500).send({ message: "Failed to update user role" });
  }
});

router.get("/services", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const services = await servicesCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.send(services);
  } catch (error) {
    res.status(500).send({ message: "Failed to get services" });
  }
});

router.patch("/services/:id/approval", verifyToken, verifyAdmin, async (req, res) => {
  try {
    if (ObjectId.isValid(req.params.id) === false) {
      return res.status(404).send({ message: "Service not found" });
    }

    const { approvalStatus } = req.body;

    if (
      approvalStatus !== "approved" &&
      approvalStatus !== "rejected"
    ) {
      return res.status(400).send({ message: "Invalid approval status" });
    }

    const result = await servicesCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { approvalStatus } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({ message: "Service not found" });
    }

    res.send({ message: "Service approval updated successfully" });
  } catch (error) {
    res.status(500).send({ message: "Failed to update service approval" });
  }
});

router.get("/bookings", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const bookings = await bookingsCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.send(bookings);
  } catch (error) {
    res.status(500).send({ message: "Failed to get bookings" });
  }
});

router.get("/payments", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const payments = await paymentsCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.send(payments);
  } catch (error) {
    res.status(500).send({ message: "Failed to get payments" });
  }
});

export default router;