import express from "express";
import { ObjectId } from "mongodb";
import { db } from "./auth.js";
import verifyToken from "./middlewares/verifyToken.js";
import verifyCustomer from "./middlewares/verifyCustomer.js";
import verifyTechnician from "./middlewares/verifyTechnician.js";

const router = express.Router();

const bookingsCollection = db.collection("bookings");
const servicesCollection = db.collection("services");

router.post("/", verifyToken, verifyCustomer, async (req, res) => {
  try {
    const {
      serviceId,
      customerPhone,
      address,
      preferredDate,
      problemDescription
    } = req.body;

    if (
      serviceId === undefined ||
      customerPhone === undefined ||
      address === undefined ||
      preferredDate === undefined ||
      problemDescription === undefined
    ) {
      return res.status(400).send({ message: "All fields are required" });
    }

    if (ObjectId.isValid(serviceId) === false) {
      return res.status(400).send({ message: "Invalid service ID" });
    }

    if (problemDescription.trim().length < 20) {
      return res.status(400).send({
        message: "Problem description must be at least 20 characters"
      });
    }

    const selectedDate = new Date(preferredDate);

    if (
      Number.isNaN(selectedDate.getTime()) ||
      selectedDate.setHours(0, 0, 0, 0) <
        new Date().setHours(0, 0, 0, 0)
    ) {
      return res.status(400).send({ message: "Invalid preferred date" });
    }

    const service = await servicesCollection.findOne({
      _id: new ObjectId(serviceId),
      approvalStatus: "approved",
      isAvailable: true
    });

    if (service === null) {
      return res.status(404).send({ message: "Service not found" });
    }

    const activeBooking = await bookingsCollection.findOne({
      serviceId,
      customerEmail: req.user.email,
      status: { $in: ["requested", "accepted", "in-progress"] }
    });

    if (activeBooking !== null) {
      return res.status(400).send({
        message: "You already have an active request for this service"
      });
    }

    const booking = {
      serviceId,
      serviceTitle: service.title,
      serviceImage: service.image,
      category: service.category,
      basePrice: service.basePrice,
      technicianName: service.technicianName,
      technicianEmail: service.technicianEmail,
      customerName: req.user.name,
      customerEmail: req.user.email,
      customerPhone,
      address,
      preferredDate: selectedDate,
      problemDescription,
      status: "requested",
      finalAmount: service.basePrice,
      paymentStatus: "unpaid",
      createdAt: new Date()
    };

    const result = await bookingsCollection.insertOne(booking);

    res.status(201).send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to create booking" });
  }
});

router.get("/my", verifyToken, verifyCustomer, async (req, res) => {
  try {
    const bookings = await bookingsCollection
      .find({ customerEmail: req.user.email })
      .sort({ createdAt: -1 })
      .toArray();

    res.send(bookings);
  } catch (error) {
    res.status(500).send({ message: "Failed to get bookings" });
  }
});

router.patch("/:id/cancel", verifyToken, verifyCustomer, async (req, res) => {
  try {
    if (ObjectId.isValid(req.params.id) === false) {
      return res.status(404).send({ message: "Booking not found" });
    }

    const result = await bookingsCollection.updateOne(
      {
        _id: new ObjectId(req.params.id),
        customerEmail: req.user.email,
        status: "requested"
      },
      {
        $set: { status: "cancelled" }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(400).send({
        message: "This booking cannot be cancelled"
      });
    }

    res.send({ message: "Booking cancelled successfully" });
  } catch (error) {
    res.status(500).send({ message: "Failed to cancel booking" });
  }
});

router.get("/technician", verifyToken, verifyTechnician, async (req, res) => {
  try {
    const bookings = await bookingsCollection
      .find({ technicianEmail: req.user.email })
      .sort({ createdAt: -1 })
      .toArray();

    res.send(bookings);
  } catch (error) {
    res.status(500).send({ message: "Failed to get requests" });
  }
});

router.patch("/:id/status", verifyToken, verifyTechnician, async (req, res) => {
  try {
    if (ObjectId.isValid(req.params.id) === false) {
      return res.status(404).send({ message: "Booking not found" });
    }

    const { status, finalAmount } = req.body;

    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(req.params.id),
      technicianEmail: req.user.email
    });

    if (booking === null) {
      return res.status(404).send({ message: "Booking not found" });
    }

    const allowedStatuses = {
      requested: ["accepted", "rejected"],
      accepted: ["in-progress"],
      "in-progress": ["completed"]
    };

    if (allowedStatuses[booking.status]?.includes(status) === false) {
      return res.status(400).send({
        message: "Invalid booking status change"
      });
    }

    const updateData = {
      status,
      updatedAt: new Date()
    };

    if (status === "completed") {
      if (
        Number(finalAmount) <= 0 ||
        Number.isFinite(Number(finalAmount)) === false
      ) {
        return res.status(400).send({
          message: "Enter a valid final amount"
        });
      }

      updateData.finalAmount = Number(finalAmount);
    }

    await bookingsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: updateData }
    );

    res.send({ message: "Booking status updated successfully" });
  } catch (error) {
    res.status(500).send({ message: "Failed to update booking status" });
  }
});

export default router;