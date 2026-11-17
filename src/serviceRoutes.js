import express from "express";
import { ObjectId } from "mongodb";
import { db } from "./auth.js";
import verifyToken from "./middlewares/verifyToken.js";
import verifyTechnician from "./middlewares/verifyTechnician.js";

const router = express.Router();

const servicesCollection = db.collection("services");

router.get("/", async (req, res) => {
  try {
    const query = {
      approvalStatus: "approved",
      isAvailable: true
    };

    if (req.query.search) {
      query.$or = [
        {
          title: {
            $regex: req.query.search,
            $options: "i"
          }
        },
        {
          category: {
            $regex: req.query.search,
            $options: "i"
          }
        }
      ];
    }

    if (req.query.category) {
      query.category = req.query.category;
    }

    if (req.query.serviceMode) {
      query.serviceMode = req.query.serviceMode;
    }

    let sortOption = { createdAt: -1 };

    if (req.query.sort === "price-low") {
      sortOption = { basePrice: 1 };
    }

    if (req.query.sort === "price-high") {
      sortOption = { basePrice: -1 };
    }

    const services = await servicesCollection
      .find(query)
      .sort(sortOption)
      .toArray();

    res.send(services);
  } catch (error) {
    res.status(500).send({ message: "Failed to get services" });
  }
});

router.get("/my-services", verifyToken, verifyTechnician, async (req, res) => {
  try {
    const services = await servicesCollection
      .find({ technicianEmail: req.user.email })
      .sort({ createdAt: -1 })
      .toArray();

    res.send(services);
  } catch (error) {
    res.status(500).send({ message: "Failed to get your services" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    if (ObjectId.isValid(req.params.id) === false) {
      return res.status(404).send({ message: "Service not found" });
    }

    const service = await servicesCollection.findOne({
      _id: new ObjectId(req.params.id),
      approvalStatus: "approved",
      isAvailable: true
    });

    if (service === null) {
      return res.status(404).send({ message: "Service not found" });
    }

    res.send(service);
  } catch (error) {
    res.status(500).send({ message: "Failed to get service" });
  }
});

router.post("/", verifyToken, verifyTechnician, async (req, res) => {
  try {
    const {
      title,
      category,
      description,
      image,
      basePrice,
      serviceMode,
      serviceArea
    } = req.body;

    if (
      title === undefined ||
      category === undefined ||
      description === undefined ||
      image === undefined ||
      basePrice === undefined ||
      serviceMode === undefined
    ) {
      return res.status(400).send({ message: "All required fields must be provided" });
    }

    if (
      typeof title !== "string" ||
      typeof category !== "string" ||
      typeof description !== "string" ||
      typeof image !== "string" ||
      Number.isFinite(Number(basePrice)) === false ||
      Number(basePrice) <= 0
    ) {
      return res.status(400).send({ message: "Invalid service information" });
    }

    const service = {
      title,
      category,
      description,
      image,
      basePrice: Number(basePrice),
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
  } catch (error) {
    res.status(500).send({ message: "Failed to add service" });
  }
});

router.patch("/:id", verifyToken, verifyTechnician, async (req, res) => {
  try {
    if (ObjectId.isValid(req.params.id) === false) {
      return res.status(404).send({ message: "Service not found" });
    }

    const {
      title,
      category,
      description,
      image,
      basePrice,
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

    if (image !== undefined) {
      updateData.image = image;
    }

    if (basePrice !== undefined) {
      if (
        Number.isFinite(Number(basePrice)) === false ||
        Number(basePrice) <= 0
      ) {
        return res.status(400).send({ message: "Invalid service price" });
      }

      updateData.basePrice = Number(basePrice);
    }

    if (serviceMode !== undefined) {
      updateData.serviceMode = serviceMode;
    }

    if (serviceArea !== undefined) {
      updateData.serviceArea = serviceArea;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).send({ message: "No information to update" });
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
      return res.status(404).send({ message: "Service not found" });
    }

    res.send({ message: "Service updated successfully" });
  } catch (error) {
    res.status(500).send({ message: "Failed to update service" });
  }
});

router.delete("/:id", verifyToken, verifyTechnician, async (req, res) => {
  try {
    if (ObjectId.isValid(req.params.id) === false) {
      return res.status(404).send({ message: "Service not found" });
    }

    const result = await servicesCollection.deleteOne({
      _id: new ObjectId(req.params.id),
      technicianEmail: req.user.email
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({ message: "Service not found" });
    }

    res.send({ message: "Service deleted successfully" });
  } catch (error) {
    res.status(500).send({ message: "Failed to delete service" });
  }
});

export default router;