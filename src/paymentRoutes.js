import express from "express";
import Stripe from "stripe";
import { ObjectId } from "mongodb";
import { db } from "./auth.js";
import verifyToken from "./middlewares/verifyToken.js";
import verifyCustomer from "./middlewares/verifyCustomer.js";

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const bookingsCollection = db.collection("bookings");
const paymentsCollection = db.collection("payments");

router.post("/create-checkout-session/:bookingId", verifyToken, verifyCustomer, async (req, res) => {
  try {
    if (ObjectId.isValid(req.params.bookingId) === false) {
      return res.status(404).send({ message: "Booking not found" });
    }

    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(req.params.bookingId),
      customerEmail: req.user.email
    });

    if (booking === null) {
      return res.status(404).send({ message: "Booking not found" });
    }

    if (booking.status !== "completed") {
      return res.status(400).send({
        message: "Payment is available after service completion"
      });
    }

    if (booking.paymentStatus === "paid") {
      return res.status(400).send({ message: "Payment already completed" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "bdt",
            product_data: {
              name: booking.serviceTitle
            },
            unit_amount: Math.round(Number(booking.finalAmount) * 100)
          },
          quantity: 1
        }
      ],
      metadata: {
        bookingId: booking._id.toString(),
        customerEmail: req.user.email
      },
      success_url: `${process.env.CLIENT_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/my-bookings`
    });

    res.send({ url: session.url });
  } catch (error) {
    res.status(500).send({ message: "Failed to create payment session" });
  }
});

router.post("/verify-payment", verifyToken, verifyCustomer, async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (typeof sessionId !== "string") {
      return res.status(400).send({ message: "Invalid session ID" });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (
      session.payment_status !== "paid" ||
      session.metadata.customerEmail !== req.user.email
    ) {
      return res.status(400).send({ message: "Payment not completed" });
    }

    const bookingId = session.metadata.bookingId;

    if (ObjectId.isValid(bookingId) === false) {
      return res.status(400).send({ message: "Invalid booking ID" });
    }

    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(bookingId),
      customerEmail: req.user.email,
      status: "completed"
    });

    if (booking === null) {
      return res.status(404).send({ message: "Booking not found" });
    }

    const existingPayment = await paymentsCollection.findOne({
      sessionId
    });

    if (existingPayment !== null) {
      return res.send({ message: "Payment already verified" });
    }

    await paymentsCollection.insertOne({
      bookingId,
      sessionId,
      customerEmail: req.user.email,
      amount: session.amount_total / 100,
      currency: session.currency,
      paymentStatus: "paid",
      createdAt: new Date()
    });

    await bookingsCollection.updateOne(
      {
        _id: new ObjectId(bookingId),
        paymentStatus: "unpaid"
      },
      {
        $set: {
          paymentStatus: "paid",
          paidAt: new Date()
        }
      }
    );

    res.send({ message: "Payment successful" });
  } catch (error) {
    res.status(500).send({ message: "Payment verification failed" });
  }
});

export default router;