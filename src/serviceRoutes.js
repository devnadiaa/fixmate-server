import express from "express";
import { ObjectId } from "mongodb";
import { db } from "./auth.js";
import verifyToken from "./middlewares/verifyToken.js";
import verifyTechnician from "./middlewares/verifyTechnician.js";
import verifyCustomer from "./middlewares/verifyCustomer.js";

const router = express.Router();

const servicesCollection = db.collection("services");
const usersCollection = db.collection("users");
const bookingsCollection = db.collection("bookings");
const reviewsCollection = db.collection("reviews");

router.get("/", async (req, res) => {
  try {
    const query = {
      approvalStatus: "approved",
      isAvailable: true
    };

    if (req.query.search) {
      query.$or = [
        { title: { $regex: req.query.search, $options: "i" } },
        { category: { $regex: req.query.search, $options: "i" } }
      ];
    }

    if (req.query.category) {
      query.category = req.query.category;
    }

    if (req.query.serviceMode) {
      query.serviceMode = req.query.serviceMode;
    }

    const sort = req.query.sort || "newest";

    const paginationEnabled =
      req.query.page !== undefined || req.query.limit !== undefined;

    const totalServices = await servicesCollection.countDocuments(query);

    let currentPage = 1;
    let limit = totalServices || 1;
    let totalPages = 1;

    if (paginationEnabled) {
      currentPage = Number(req.query.page || 1);
      limit = Number(req.query.limit || 6);

      if (
        Number.isInteger(currentPage) === false ||
        currentPage < 1 ||
        Number.isInteger(limit) === false ||
        limit < 1 ||
        limit > 50
      ) {
        return res.status(400).send({
          message: "Invalid pagination parameters"
        });
      }

      totalPages = Math.ceil(totalServices / limit);

      if (totalPages > 0 && currentPage > totalPages) {
        currentPage = totalPages;
      }
    }

    const ratingSort =
      sort === "rating-high" || sort === "rating-low";

    let services;

    if (ratingSort) {
      services = await servicesCollection
        .find(query)
        .toArray();
    } else {
      let sortOption = { createdAt: -1 };

      if (sort === "price-low") {
        sortOption = { basePrice: 1 };
      }

      if (sort === "price-high") {
        sortOption = { basePrice: -1 };
      }

      let servicesQuery = servicesCollection
        .find(query)
        .sort(sortOption);

      if (paginationEnabled) {
        servicesQuery = servicesQuery
          .skip((currentPage - 1) * limit)
          .limit(limit);
      }

      services = await servicesQuery.toArray();
    }

    const serviceIds = services.map(service =>
      service._id.toString()
    );

    const ratings = serviceIds.length > 0
      ? await reviewsCollection.aggregate([
          {
            $match: {
              serviceId: { $in: serviceIds }
            }
          },
          {
            $group: {
              _id: "$serviceId",
              averageRating: { $avg: "$rating" }
            }
          }
        ]).toArray()
      : [];

    const ratingMap = new Map(
      ratings.map(item => [
        item._id,
        item.averageRating
      ])
    );

    let servicesWithRatings = services.map(service => ({
      ...service,
      averageRating:
        ratingMap.get(service._id.toString()) || 0
    }));

    if (sort === "rating-high") {
      servicesWithRatings.sort((a, b) => {
        return (
          b.averageRating - a.averageRating ||
          new Date(b.createdAt).getTime() -
            new Date(a.createdAt).getTime()
        );
      });
    }

    if (sort === "rating-low") {
      servicesWithRatings.sort((a, b) => {
        return (
          a.averageRating - b.averageRating ||
          new Date(b.createdAt).getTime() -
            new Date(a.createdAt).getTime()
        );
      });
    }

    if (ratingSort && paginationEnabled) {
      const startIndex = (currentPage - 1) * limit;

      servicesWithRatings = servicesWithRatings.slice(
        startIndex,
        startIndex + limit
      );
    }

    if (paginationEnabled) {
      return res.send({
        services: servicesWithRatings,
        totalServices,
        totalPages,
        currentPage,
        limit
      });
    }

    res.send(servicesWithRatings);
  } catch {
    res.status(500).send({
      message: "Failed to get services"
    });
  }
});

router.get("/my-services", verifyToken, verifyTechnician, async (req, res) => {
  try {
    const services = await servicesCollection
      .find({ technicianEmail: req.user.email })
      .sort({ createdAt: -1 })
      .toArray();

    res.send(services);
  } catch {
    res.status(500).send({
      message: "Failed to get your services"
    });
  }
});

router.post("/:id/reviews", verifyToken, verifyCustomer, async (req, res) => {
  try {
    const { bookingId, rating, comment } = req.body;

    if (
      ObjectId.isValid(req.params.id) === false ||
      ObjectId.isValid(bookingId) === false
    ) {
      return res.status(400).send({
        message: "Invalid service or booking ID"
      });
    }

    if (
      Number.isInteger(rating) === false ||
      rating < 1 ||
      rating > 5 ||
      typeof comment !== "string" ||
      comment.trim() === ""
    ) {
      return res.status(400).send({
        message: "Please provide a valid rating and review"
      });
    }

    const service = await servicesCollection.findOne({
      _id: new ObjectId(req.params.id),
      approvalStatus: "approved",
      isAvailable: true
    });

    if (service === null) {
      return res.status(404).send({
        message: "Service not found"
      });
    }

    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(bookingId),
      serviceId: req.params.id,
      customerEmail: req.user.email,
      status: "completed",
      paymentStatus: "paid"
    });

    if (booking === null) {
      return res.status(403).send({
        message: "Only customers with their own completed and paid booking can review this service"
      });
    }

    const review = {
      serviceId: req.params.id,
      bookingId,
      customerName: req.user.name,
      customerEmail: req.user.email,
      rating,
      comment: comment.trim(),
      createdAt: new Date()
    };

    const result = await reviewsCollection.insertOne(review);

    res.status(201).send({
      message: "Review submitted successfully",
      review: {
        ...review,
        _id: result.insertedId
      }
    });
  } catch {
    res.status(500).send({
      message: "Failed to submit review"
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    if (ObjectId.isValid(req.params.id) === false) {
      return res.status(404).send({
        message: "Service not found"
      });
    }

    const service = await servicesCollection.findOne({
      _id: new ObjectId(req.params.id),
      approvalStatus: "approved",
      isAvailable: true
    });

    if (service === null) {
      return res.status(404).send({
        message: "Service not found"
      });
    }

    const technician = await usersCollection.findOne(
      { email: service.technicianEmail },
      {
        projection: {
          _id: 0,
          name: 1,
          email: 1,
          image: 1,
          area: 1,
          bio: 1
        }
      }
    );

    const reviews = await reviewsCollection
      .find({ serviceId: req.params.id })
      .sort({ createdAt: -1 })
      .toArray();

    const reviewCount = reviews.length;

    const averageRating =
      reviewCount > 0
        ? reviews.reduce(
            (total, review) => total + review.rating,
            0
          ) / reviewCount
        : 0;

    res.send({
      ...service,
      technician: technician || {
        name: service.technicianName,
        email: service.technicianEmail,
        image: "",
        area: "",
        bio: ""
      },
      reviews,
      reviewCount,
      averageRating
    });
  } catch {
    res.status(500).send({
      message: "Failed to get service"
    });
  }
});

router.post("/", verifyToken, verifyTechnician, async (req, res) => {
  try {
    const {
      title,
      category,
      description,
      image,
      images,
      basePrice,
      estimatedDuration,
      serviceMode,
      serviceArea
    } = req.body;

    if (
      title === undefined ||
      category === undefined ||
      description === undefined ||
      basePrice === undefined ||
      serviceMode === undefined
    ) {
      return res.status(400).send({
        message: "All required fields must be provided"
      });
    }

    const galleryImages = Array.isArray(images)
      ? images
      : typeof image === "string" && image.trim()
        ? [image.trim()]
        : [];

    if (
      typeof title !== "string" ||
      typeof category !== "string" ||
      typeof description !== "string" ||
      Number.isFinite(Number(basePrice)) === false ||
      Number(basePrice) <= 0 ||
      galleryImages.length === 0 ||
      galleryImages.length > 5 ||
      galleryImages.some(
        item =>
          typeof item !== "string" ||
          item.trim() === ""
      )
    ) {
      return res.status(400).send({
        message: "Invalid service information"
      });
    }

    const service = {
      title,
      category,
      description,
      image: galleryImages[0].trim(),
      galleryImages: galleryImages.map(item => item.trim()),
      basePrice: Number(basePrice),
      estimatedDuration: estimatedDuration || "",
      serviceMode,
      serviceArea: serviceArea || "",
      technicianName: req.user.name,
      technicianEmail: req.user.email,
      approvalStatus: "pending",
      isAvailable: true,
      createdAt: new Date()
    };

    const result = await servicesCollection.insertOne(service);

    res.status(201).send(result);
  } catch {
    res.status(500).send({
      message: "Failed to add service"
    });
  }
});

router.patch("/:id/availability", verifyToken, verifyTechnician, async (req, res) => {
  try {
    if (ObjectId.isValid(req.params.id) === false) {
      return res.status(404).send({
        message: "Service not found"
      });
    }

    const { isAvailable } = req.body;

    if (typeof isAvailable !== "boolean") {
      return res.status(400).send({
        message: "Please provide a valid availability status"
      });
    }

    const result = await servicesCollection.updateOne(
      {
        _id: new ObjectId(req.params.id),
        technicianEmail: req.user.email,
        approvalStatus: "approved"
      },
      {
        $set: {
          isAvailable,
          updatedAt: new Date()
        }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        message: "Approved service not found"
      });
    }

    res.send({
      message: "Service availability updated successfully",
      isAvailable
    });
  } catch {
    res.status(500).send({
      message: "Failed to update service availability"
    });
  }
});

router.patch("/:id", verifyToken, verifyTechnician, async (req, res) => {
  try {
    if (ObjectId.isValid(req.params.id) === false) {
      return res.status(404).send({
        message: "Service not found"
      });
    }

    const {
      title,
      category,
      description,
      image,
      images,
      basePrice,
      estimatedDuration,
      serviceMode,
      serviceArea
    } = req.body;

    const updateData = {};

    if (title !== undefined) {
      updateData.title = title;
    }

    if (category !== undefined) {
      updateData.category = category;
    }

    if (description !== undefined) {
      updateData.description = description;
    }

    if (images !== undefined) {
      if (
        Array.isArray(images) === false ||
        images.length === 0 ||
        images.length > 5 ||
        images.some(
          item =>
            typeof item !== "string" ||
            item.trim() === ""
        )
      ) {
        return res.status(400).send({
          message: "Please provide between 1 and 5 valid images"
        });
      }

      updateData.galleryImages = images.map(item => item.trim());
      updateData.image = images[0].trim();
    } else if (image !== undefined) {
      if (
        typeof image !== "string" ||
        image.trim() === ""
      ) {
        return res.status(400).send({
          message: "Invalid service image"
        });
      }

      updateData.image = image.trim();
      updateData.galleryImages = [image.trim()];
    }

    if (basePrice !== undefined) {
      if (
        Number.isFinite(Number(basePrice)) === false ||
        Number(basePrice) <= 0
      ) {
        return res.status(400).send({
          message: "Invalid service price"
        });
      }

      updateData.basePrice = Number(basePrice);
    }

    if (estimatedDuration !== undefined) {
      updateData.estimatedDuration = estimatedDuration;
    }

    if (serviceMode !== undefined) {
      updateData.serviceMode = serviceMode;
    }

    if (serviceArea !== undefined) {
      updateData.serviceArea = serviceArea;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).send({
        message: "No information to update"
      });
    }

    updateData.approvalStatus = "pending";
    updateData.updatedAt = new Date();

    const result = await servicesCollection.updateOne(
      {
        _id: new ObjectId(req.params.id),
        technicianEmail: req.user.email
      },
      {
        $set: updateData
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        message: "Service not found"
      });
    }

    res.send({
      message: "Service updated successfully"
    });
  } catch {
    res.status(500).send({
      message: "Failed to update service"
    });
  }
});

router.delete("/:id", verifyToken, verifyTechnician, async (req, res) => {
  try {
    if (ObjectId.isValid(req.params.id) === false) {
      return res.status(404).send({
        message: "Service not found"
      });
    }

    const result = await servicesCollection.deleteOne({
      _id: new ObjectId(req.params.id),
      technicianEmail: req.user.email
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({
        message: "Service not found"
      });
    }

    res.send({
      message: "Service deleted successfully"
    });
  } catch {
    res.status(500).send({
      message: "Failed to delete service"
    });
  }
});

export default router;