import express from "express";
import Stripe from "stripe";
import { ObjectId } from "mongodb";
import { createHash } from "node:crypto";
import { db } from "./auth.js";
import verifyToken from "./middlewares/verifyToken.js";
import verifyCustomer from "./middlewares/verifyCustomer.js";

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const bookingsCollection = db.collection("bookings");
const paymentsCollection = db.collection("payments");

const createPaymentError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const updateBookingPaymentStatus = async (
  bookingId,
  customerEmail,
  sessionId
) => {
  const currentDate = new Date();

  const result = await bookingsCollection.updateOne(
    {
      _id: new ObjectId(bookingId),
      customerEmail,
      status: "completed",
      paymentStatus: "unpaid"
    },
    {
      $set: {
        paymentStatus: "paid",
        paidAt: currentDate
      },
      $push: {
        statusHistory: {
          status: "paid",
          changedAt: currentDate,
          note: "Payment completed successfully"
        }
      }
    }
  );

  if (result.matchedCount > 0) {
    return;
  }

  const booking = await bookingsCollection.findOne({
    _id: new ObjectId(bookingId),
    customerEmail
  });

  const payment = await paymentsCollection.findOne({
    bookingId
  });

  const savedSessionId =
    payment?.stripeSessionId || payment?.sessionId;

  if (
    booking?.paymentStatus === "paid" &&
    savedSessionId === sessionId
  ) {
    return;
  }

  throw createPaymentError(
    409,
    "Booking payment status could not be updated"
  );
};

const completePayment = async (session, customerEmail) => {
  if (
    typeof customerEmail !== "string" ||
    session.mode !== "payment" ||
    session.payment_status !== "paid" ||
    session.metadata?.customerEmail !== customerEmail
  ) {
    throw createPaymentError(400, "Payment not completed");
  }

  const bookingId = session.metadata?.bookingId;

  if (ObjectId.isValid(bookingId) === false) {
    throw createPaymentError(400, "Invalid booking ID");
  }

  const booking = await bookingsCollection.findOne({
    _id: new ObjectId(bookingId),
    customerEmail,
    status: "completed"
  });

  if (booking === null) {
    throw createPaymentError(404, "Booking not found");
  }

  const expectedAmount = Math.round(
    Number(booking.finalAmount) * 100
  );

  if (
    Number.isFinite(expectedAmount) === false ||
    expectedAmount <= 0 ||
    session.amount_total !== expectedAmount ||
    session.currency !== "usd"
  ) {
    throw createPaymentError(
      400,
      "Payment amount or currency mismatch"
    );
  }

  const transactionId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;

  if (!transactionId) {
    throw createPaymentError(
      400,
      "Payment transaction ID not found"
    );
  }

  const existingPayment = await paymentsCollection.findOne({
    bookingId
  });

  if (existingPayment !== null) {
    const existingSessionId =
      existingPayment.stripeSessionId || existingPayment.sessionId;

    if (existingSessionId !== session.id) {
      throw createPaymentError(
        409,
        "Payment already exists for this booking"
      );
    }

    await updateBookingPaymentStatus(
      bookingId,
      customerEmail,
      session.id
    );

    return "Payment already verified";
  }

  if (booking.paymentStatus === "paid") {
    throw createPaymentError(
      409,
      "Payment already completed"
    );
  }

  const payment = {
    bookingId,
    serviceTitle: booking.serviceTitle,
    customerName: booking.customerName,
    customerEmail: booking.customerEmail,
    technicianName: booking.technicianName,
    technicianEmail: booking.technicianEmail,
    amount: session.amount_total / 100,
    currency: session.currency,
    transactionId,
    stripeSessionId: session.id,
    paymentStatus: "paid",
    paidAt: new Date()
  };

  try {
    await paymentsCollection.insertOne(payment);
  } catch (error) {
    if (error.code !== 11000) {
      throw error;
    }

    const existingRecord = await paymentsCollection.findOne({
      bookingId
    });

    if (
      existingRecord?.stripeSessionId !== session.id &&
      existingRecord?.sessionId !== session.id
    ) {
      throw createPaymentError(
        409,
        "Payment already exists for this booking"
      );
    }
  }

  await updateBookingPaymentStatus(
    bookingId,
    customerEmail,
    session.id
  );

  return "Payment successful";
};

router.get(
  "/my",
  verifyToken,
  verifyCustomer,
  async (req, res) => {
    try {
      const payments = await paymentsCollection
        .find({
          customerEmail: req.user.email
        })
        .sort({
          paidAt: -1
        })
        .toArray();

      const updatedPayments = await Promise.all(
        payments.map(async (payment) => {
          const updateData = {};

          const bookingId = payment.bookingId;

          if (ObjectId.isValid(bookingId)) {
            const booking = await bookingsCollection.findOne({
              _id: new ObjectId(bookingId),
              customerEmail: req.user.email
            });

            if (booking !== null) {
              updateData.serviceTitle =
                payment.serviceTitle || booking.serviceTitle;

              updateData.customerName =
                payment.customerName || booking.customerName;

              updateData.technicianName =
                payment.technicianName || booking.technicianName;

              updateData.technicianEmail =
                payment.technicianEmail || booking.technicianEmail;
            }
          }

          const sessionId =
            payment.stripeSessionId || payment.sessionId;

          if (payment.transactionId === undefined && sessionId) {
            try {
              const session =
                await stripe.checkout.sessions.retrieve(
                  sessionId,
                  {
                    expand: ["payment_intent"]
                  }
                );

              const transactionId =
                typeof session.payment_intent === "string"
                  ? session.payment_intent
                  : session.payment_intent?.id;

              if (transactionId) {
                updateData.transactionId = transactionId;
              }
            } catch (error) {
              console.error(
                "Stripe Transaction Retrieval Error:",
                error.message
              );
            }
          }

          if (Object.keys(updateData).length > 0) {
            await paymentsCollection.updateOne(
              {
                _id: payment._id,
                customerEmail: req.user.email
              },
              {
                $set: updateData
              }
            );
          }

          return {
            ...payment,
            ...updateData
          };
        })
      );

      res.send(updatedPayments);
    } catch (error) {
      console.error("Payment History Error:", error);

      res.status(500).send({
        message: "Failed to get payment history"
      });
    }
  }
);

router.post("/webhook", async (req, res) => {
  let event;

  try {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const signature = req.headers["stripe-signature"];

    if (!webhookSecret) {
      return res.status(500).send({
        message: "Stripe webhook secret is not configured"
      });
    }

    if (!req.rawBody || !signature) {
      return res.status(400).send({
        message: "Missing webhook body or signature"
      });
    }

    event = stripe.webhooks.constructEvent(
      req.rawBody,
      signature,
      webhookSecret
    );
  } catch (error) {
    return res.status(400).send({
      message: "Webhook signature verification failed"
    });
  }

  try {
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const session = event.data.object;

      if (session.payment_status === "paid") {
        await completePayment(
          session,
          session.metadata?.customerEmail
        );
      }
    }

    res.send({
      received: true
    });
  } catch (error) {
    console.error("Stripe Webhook Error:", error);

    res.status(error.statusCode || 500).send({
      message: error.message || "Webhook processing failed"
    });
  }
});

router.post(
  "/create-checkout-session/:bookingId",
  verifyToken,
  verifyCustomer,
  async (req, res) => {
    try {
      if (ObjectId.isValid(req.params.bookingId) === false) {
        return res.status(404).send({
          message: "Booking not found"
        });
      }

      const booking = await bookingsCollection.findOne({
        _id: new ObjectId(req.params.bookingId),
        customerEmail: req.user.email
      });

      if (booking === null) {
        return res.status(404).send({
          message: "Booking not found"
        });
      }

      if (booking.status !== "completed") {
        return res.status(400).send({
          message: "Payment is available after service completion"
        });
      }

      const existingPayment = await paymentsCollection.findOne({
        bookingId: booking._id.toString()
      });

      if (
        booking.paymentStatus === "paid" ||
        existingPayment !== null
      ) {
        return res.status(400).send({
          message: "Payment already completed"
        });
      }

      const finalAmount = Number(booking.finalAmount);

      if (
        Number.isFinite(finalAmount) === false ||
        finalAmount <= 0
      ) {
        return res.status(400).send({
          message: "Invalid payment amount"
        });
      }

      const checkoutSessionData = {
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: booking.serviceTitle
              },
              unit_amount: Math.round(finalAmount * 100)
            },
            quantity: 1
          }
        ],
        metadata: {
          bookingId: booking._id.toString(),
          customerEmail: req.user.email
        },
        success_url: `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_URL}/payment/cancel`
      };

      const paramsHash = createHash("sha256")
        .update(JSON.stringify(checkoutSessionData))
        .digest("hex");

      const session = await stripe.checkout.sessions.create(
        checkoutSessionData,
        {
          idempotencyKey: `fixmate-booking-${booking._id}-${paramsHash}`
        }
      );

      res.send({
        url: session.url
      });
    } catch (error) {
      console.error("Stripe Checkout Error:", error);

      res.status(500).send({
        message: "Failed to create payment session"
      });
    }
  }
);

router.post(
  "/verify-payment",
  verifyToken,
  verifyCustomer,
  async (req, res) => {
    try {
      const { sessionId } = req.body;

      if (
        typeof sessionId !== "string" ||
        sessionId.trim() === ""
      ) {
        return res.status(400).send({
          message: "Invalid session ID"
        });
      }

      const session = await stripe.checkout.sessions.retrieve(
        sessionId
      );

      const message = await completePayment(
        session,
        req.user.email
      );

      res.send({
        message
      });
    } catch (error) {
      console.error("Payment Verification Error:", error);

      res.status(error.statusCode || 500).send({
        message: error.message || "Payment verification failed"
      });
    }
  }
);

export default router;