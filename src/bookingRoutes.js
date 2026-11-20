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
      phone,
      customerPhone: submittedCustomerPhone,
      address,
      preferredDate,
      problemDescription
    } = req.body;

    const customerPhone =
      typeof phone === "string" ? phone.trim() : submittedCustomerPhone;

    if (
      typeof serviceId !== "string" ||
      typeof customerPhone !== "string" ||
      typeof address !== "string" ||
      typeof preferredDate !== "string" ||
      typeof problemDescription !== "string" ||
      customerPhone.trim() === "" ||
      address.trim() === "" ||
      preferredDate.trim() === "" ||
      problemDescription.trim() === ""
    ) {
      return res.status(400).send({
        message: "All fields are required"
      });
    }

    if (ObjectId.isValid(serviceId) === false) {
      return res.status(400).send({
        message: "Invalid service ID"
      });
    }

    if (problemDescription.trim().length < 20) {
      return res.status(400).send({
        message: "Problem description must be at least 20 characters"
      });
    }

    const selectedDate = new Date(`${preferredDate}T00:00:00`);

    const today = new Date();
    const todayString = `${today.getFullYear()}-${String(
      today.getMonth() + 1
    ).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    if (
      Number.isNaN(selectedDate.getTime()) ||
      preferredDate < todayString
    ) {
      return res.status(400).send({
        message: "Invalid preferred date"
      });
    }

    const service = await servicesCollection.findOne({
      _id: new ObjectId(serviceId),
      approvalStatus: "approved",
      isAvailable: true
    });

    if (service === null) {
      return res.status(404).send({
        message: "Service not found"
      });
    }

    if (service.technicianEmail === req.user.email) {
      return res.status(400).send({
        message: "You cannot book your own service"
      });
    }

    const activeBooking = await bookingsCollection.findOne({
      serviceId,
      customerEmail: req.user.email,
      status: {
        $in: ["requested", "accepted", "in-progress"]
      }
    });

    if (activeBooking !== null) {
      return res.status(400).send({
        message: "You already have an active request for this service"
      });
    }

    const currentDate = new Date();

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
      customerPhone: customerPhone.trim(),
      address: address.trim(),
      preferredDate: selectedDate,
      problemDescription: problemDescription.trim(),
      status: "requested",
      statusHistory: [
        {
          status: "requested",
          changedAt: currentDate,
          note: "Booking request submitted"
        }
      ],
      finalAmount: service.basePrice,
      paymentStatus: "unpaid",
      createdAt: currentDate
    };

    const result = await bookingsCollection.insertOne(booking);

    res.status(201).send({
      message: "Booking request submitted successfully",
      bookingId: result.insertedId
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).send({
        message: "You already have an active request for this service"
      });
    }

    res.status(500).send({
      message: "Failed to create booking"
    });
  }
});

router.get("/my", verifyToken, verifyCustomer, async (req, res) => {
  try {
    const bookings = await bookingsCollection
      .find({
        customerEmail: req.user.email
      })
      .sort({
        createdAt: -1
      })
      .toArray();

    res.send(bookings);
  } catch (error) {
    res.status(500).send({
      message: "Failed to get bookings"
    });
  }
});

router.patch("/:id/cancel", verifyToken, verifyCustomer, async (req, res) => {
  try {
    if (ObjectId.isValid(req.params.id) === false) {
      return res.status(404).send({
        message: "Booking not found"
      });
    }

    const currentDate = new Date();

    const result = await bookingsCollection.updateOne(
      {
        _id: new ObjectId(req.params.id),
        customerEmail: req.user.email,
        status: "requested"
      },
      {
        $set: {
          status: "cancelled",
          updatedAt: currentDate
        },
        $push: {
          statusHistory: {
            status: "cancelled",
            changedAt: currentDate,
            note: "Booking cancelled by customer"
          }
        }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(400).send({
        message: "This booking cannot be cancelled"
      });
    }

    res.send({
      message: "Booking cancelled successfully"
    });
  } catch (error) {
    res.status(500).send({
      message: "Failed to cancel booking"
    });
  }
});

router.get("/technician", verifyToken, verifyTechnician, async (req, res) => {
  try {
    const bookings = await bookingsCollection
      .find({
        technicianEmail: req.user.email
      })
      .sort({
        createdAt: -1
      })
      .toArray();

    res.send(bookings);
  } catch (error) {
    res.status(500).send({
      message: "Failed to get requests"
    });
  }
});

router.patch("/:id/status", verifyToken, verifyTechnician, async (req, res) => {
  try {
    if (ObjectId.isValid(req.params.id) === false) {
      return res.status(404).send({
        message: "Booking not found"
      });
    }

    const { status, finalAmount } = req.body;

    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(req.params.id),
      technicianEmail: req.user.email
    });

    if (booking === null) {
      return res.status(404).send({
        message: "Booking not found"
      });
    }

    const allowedStatuses = {
      requested: ["accepted", "rejected"],
      accepted: ["in-progress"],
      "in-progress": ["completed"]
    };

    if (
      allowedStatuses[booking.status] === undefined ||
      allowedStatuses[booking.status].includes(status) === false
    ) {
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
        Number.isFinite(Number(finalAmount)) === false ||
        Number(finalAmount) <= 0
      ) {
        return res.status(400).send({
          message: "Enter a valid final amount"
        });
      }

      updateData.finalAmount = Number(finalAmount);
    }

    const currentDate = new Date();

    const result = await bookingsCollection.updateOne(
      {
        _id: new ObjectId(req.params.id),
        technicianEmail: req.user.email,
        status: booking.status
      },
      {
        $set: updateData,
        $push: {
          statusHistory: {
            status,
            changedAt: currentDate,
            note: `Booking status changed to ${status}`
          }
        }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(409).send({
        message: "Booking status has already changed. Please refresh."
      });
    }

    res.send({
      message: "Booking status updated successfully"
    });
  } catch (error) {
    res.status(500).send({
      message: "Failed to update booking status"
    });
  }
});

export default router;